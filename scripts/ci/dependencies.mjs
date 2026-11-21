import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { parseSync } from "rolldown/utils";

// Workspace packages resolve to dist in the test runner. Follow their TypeScript
// sources here and retain the imported name through export-star barrels.
export function affectedTests(files, changed, previousSource) {
	const sources = new Set(
		files.filter((p) => /^(packages|tests)\/.*\.ts$/.test(p)),
	);
	const modules = new Map();
	const registryBodies = new Map();
	const readers = new Map();
	const platformFiles = new Set();
	function edge(input, consumer) {
		if (!readers.has(input)) readers.set(input, new Set());
		readers.get(input).add(consumer);
	}
	function resolve(from, specifier) {
		let target;
		if (specifier.startsWith(".")) {
			target = posix.join(
				posix.dirname(from),
				specifier.replace(/\.js$/, ".ts"),
			);
		} else if (specifier.startsWith("@garbro-mcp/")) {
			const [pkg, entry = "index"] = specifier
				.slice("@garbro-mcp/".length)
				.split("/");
			target = `packages/${pkg}/src/${entry}.ts`;
		} else return;
		if (sources.has(target)) return target;
		if (!files.includes(target))
			throw Error(`Unknown dependency ${specifier} in ${from}`);
	}
	for (const file of sources) {
		const source = readFileSync(file, "utf8");
		if (/\bprocess\.(platform|arch)\b/.test(source)) platformFiles.add(file);
		const parsed = parseSync(file, source);
		if (parsed.errors.length) throw Error(`Cannot parse ${file}`);
		const { staticImports, staticExports, dynamicImports } = parsed.module;
		// Adding a registration changes consumers of the registry factory. Existing
		// named re-exports still point to their original implementations.
		if (
			previousSource &&
			changed.includes(file) &&
			file.endsWith("/index.ts")
		) {
			const previous = previousSource(file);
			if (previous !== undefined) {
				const declarations = (text, exports) =>
					exports
						.filter((d) => d.entries.some((e) => e.moduleRequest))
						.map((d) => text.slice(d.start, d.end));
				const before = parseSync(file, previous);
				const current = new Set(declarations(source, staticExports));
				if (
					!before.errors.length &&
					declarations(previous, before.module.staticExports).every((d) =>
						current.has(d),
					) &&
					!/export\s*\{[^}]*\}\s*;/s.test(source)
				) {
					const old = new Set(
						declarations(previous, before.module.staticExports),
					);
					const added = staticExports
						.filter((d) => !old.has(source.slice(d.start, d.end)))
						.flatMap((d) => d.entries)
						.filter((e) => e.moduleRequest);
					registryBodies.set(file, added);
				}
			}
		}
		const imports = [];
		const exports = new Map();
		const stars = [];
		for (const item of staticImports) {
			const specifier = item.moduleRequest.value;
			if (/^node:(fs|path|os|child_process)(\/|$)/.test(specifier))
				platformFiles.add(file);
			const target = resolve(file, specifier);
			if (target) {
				const names = item.entries.map((entry) => entry.importName.name ?? "*");
				for (const name of names.length ? names : ["*"])
					imports.push([target, name]);
			}
		}
		for (const { moduleRequest } of dynamicImports) {
			const expr = source.slice(moduleRequest.start, moduleRequest.end).trim();
			const literal = /^(["'])([^"'\n]+)\1$/.exec(expr);
			if (!literal) throw Error(`Computed import in ${file}`);
			if (/^node:(fs|path|os|child_process)(\/|$)/.test(literal[2]))
				platformFiles.add(file);
			const target = resolve(file, literal[2]);
			if (target) imports.push([target, "*"]);
		}
		for (const declaration of staticExports) {
			for (const entry of declaration.entries) {
				const target =
					entry.moduleRequest && resolve(file, entry.moduleRequest.value);
				if (target && entry.importName.kind === "AllButDefault")
					stars.push(target);
				else if (entry.exportName.name)
					exports.set(
						entry.exportName.name,
						target ? [target, entry.importName.name ?? "*"] : null,
					);
			}
		}
		modules.set(file, { imports, exports, stars });
	}
	const exportMaps = new Map();
	function exported(file, visiting = new Set()) {
		if (exportMaps.has(file)) return exportMaps.get(file);
		if (visiting.has(file)) throw Error(`Cyclic export-star in ${file}`);
		visiting.add(file);
		const { exports, stars } = modules.get(file);
		const names = new Map(exports);
		for (const star of stars) {
			for (const name of exported(star, visiting).keys()) {
				if (name !== "default" && !names.has(name))
					names.set(name, [star, name]);
			}
		}
		visiting.delete(file);
		exportMaps.set(file, names);
		return names;
	}
	const symbol = (file, name) => `${file}#${name}`;
	for (const [file, { imports }] of modules) {
		const body = symbol(file, "<body>");
		edge(file, body);
		for (const [target, name] of imports) edge(symbol(target, name), body);
		edge(body, symbol(file, "*"));
		for (const [name, origin] of exported(file)) {
			const binding = symbol(file, name);
			edge(file, binding);
			edge(origin ? symbol(...origin) : body, binding);
			edge(binding, symbol(file, "*"));
		}
	}
	// The CLI and differential tests spawn built code. Cover the MCP executable with its server integration suite as well.
	for (const [input, test] of [
		["packages/cli/src/index.ts", "tests/integration/cli.test.ts"],
		["packages/mcp/src/index.ts", "tests/integration/mcp.test.ts"],
		["packages/cli/src/index.ts", "tests/integration/differential.test.ts"],
	])
		edge(symbol(input, "<body>"), symbol(test, "<body>"));
	const testFiles = [...sources].filter((p) => p.endsWith(".test.ts"));
	const affected = new Map();
	for (const path of changed) {
		const reached = new Set();
		if (registryBodies.has(path)) {
			reached.add(symbol(path, "<body>"));
			for (const entry of registryBodies.get(path)) {
				if (entry.exportName.name)
					reached.add(symbol(path, entry.exportName.name));
				else {
					const target = resolve(path, entry.moduleRequest.value);
					if (target)
						for (const name of exported(target).keys())
							reached.add(symbol(path, name));
				}
			}
		} else reached.add(path);
		for (const item of reached)
			for (const reader of readers.get(item) ?? []) reached.add(reader);
		affected.set(path, {
			tests: testFiles.filter((p) => reached.has(symbol(p, "<body>"))),
			platformSensitive:
				platformFiles.has(path) || /^packages\/(cli|mcp)\//.test(path),
		});
	}
	return affected;
}
