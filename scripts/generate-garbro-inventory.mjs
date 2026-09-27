import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const garbroRoot = resolve(root, process.argv[2] ?? "GARbro");
const outputPath = resolve(root, "docs/garbro-inventory.json");
const resourceKinds = {
	ArchiveFormat: "archive",
	ImageFormat: "image",
	AudioFormat: "audio",
	ScriptFormat: "script",
};

// Runtime-computed catalogue values that cannot be recovered as literals. Keep this table small and
// keyed by source/class so an upstream change fails visibly instead of silently weakening the inventory.
const inventoryOverrides = new Map([
	[
		"ArcFormats/Bishop/ImageGSA.cs:GsaFormat",
		{
			extensions: [
				"gsa",
				...Array.from(
					{ length: 12 },
					(_, index) => `g${String(index + 1).padStart(2, "0")}`,
				),
				...Array.from({ length: 9 }, (_, index) => `gs${index + 1}`),
			],
		},
	],
	["ArcFormats/rUGP/ArcRIO.cs:RioOpener", { signatures: [0x596e32cd, 0] }],
]);

async function sourceFiles(directory) {
	const result = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.name === "bin" || entry.name === "obj" || entry.name === ".git")
			continue;
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) result.push(...(await sourceFiles(path)));
		else if (entry.isFile() && entry.name.endsWith(".cs")) result.push(path);
	}
	return result;
}

function git(args) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn("git", ["-C", garbroRoot, ...args], {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolvePromise(stdout.trim());
			else reject(new Error(stderr.trim() || `git exited with code ${code}`));
		});
	});
}

function classBody(source, start) {
	const opening = source.indexOf("{", start);
	if (opening === -1) return "";
	let depth = 0;
	let state = "code";
	let verbatimString = false;
	for (let index = opening; index < source.length; index += 1) {
		const current = source[index];
		const next = source[index + 1];
		if (state === "line-comment") {
			if (current === "\n") state = "code";
			continue;
		}
		if (state === "block-comment") {
			if (current === "*" && next === "/") {
				state = "code";
				index += 1;
			}
			continue;
		}
		if (state === "string") {
			if (verbatimString && current === '"' && next === '"') index += 1;
			else if (!verbatimString && current === "\\") index += 1;
			else if (current === '"') state = "code";
			continue;
		}
		if (state === "character") {
			if (current === "\\") index += 1;
			else if (current === "'") state = "code";
			continue;
		}
		if (current === "/" && next === "/") {
			state = "line-comment";
			index += 1;
		} else if (current === "/" && next === "*") {
			state = "block-comment";
			index += 1;
		} else if (current === '"') {
			state = "string";
			verbatimString = source[index - 1] === "@";
		} else if (current === "'") state = "character";
		else if (current === "{") depth += 1;
		else if (current === "}" && --depth === 0)
			return source.slice(opening, index + 1);
	}
	const nextExport = source.indexOf("[Export", opening + 1);
	return source.slice(opening, nextExport === -1 ? source.length : nextExport);
}

function literalProperty(body, property) {
	for (const pattern of [
		`(?:override\\s+)?string\\s+${property}\\s*\\{\\s*get\\s*\\{\\s*return\\s+"([^"\\r\\n]*)"`,
		`(?:override\\s+)?string\\s+${property}\\s*\\{\\s*get\\s*=>\\s*"([^"\\r\\n]*)"`,
		`(?:override\\s+)?string\\s+${property}\\s*=>\\s*"([^"\\r\\n]*)"`,
	]) {
		const match = body.match(new RegExp(pattern));
		if (match) return match[1];
	}
	return null;
}

function stringArray(body, property) {
	const assignment = body.match(
		new RegExp(`(?<![A-Za-z0-9_])${property}\\s*=\\s*([^;]+);`),
	);
	if (!assignment) return undefined;
	const expression = assignment[1].trim();
	if (/^(?:Array|Enumerable)\.Empty<string>\(\)$/.test(expression)) return [];
	if (/^new\s+string\s*\[\s*0\s*\]$/.test(expression)) return [];
	let initializer = expression.match(
		/new(?:\s+string)?\s*\[\]\s*\{([\s\S]*)\}/,
	)?.[1];
	if (initializer === undefined) {
		const named = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
		if (named)
			initializer = body.match(
				new RegExp(
					`${named}\\s*=\\s*(?:new(?:\\s+string)?\\s*\\[\\]\\s*)?\\{([\\s\\S]*?)\\}`,
				),
			)?.[1];
	}
	if (initializer === undefined)
		throw new Error(`cannot resolve ${property} assignment: ${expression}`);
	return [...initializer.matchAll(/"([^"\r\n]*)"/g)].map((match) => match[1]);
}

function uintLiteral(expression) {
	const normalized = expression.trim().replace(/^\(uint\)\s*/, "");
	const complement = normalized.startsWith("~");
	const literal = (complement ? normalized.slice(1) : normalized).replace(
		/[uUlL]+$/,
		"",
	);
	if (!/^(?:0x[0-9a-f]+|\d+)$/i.test(literal)) return undefined;
	const value = Number.parseInt(literal, literal.startsWith("0x") ? 16 : 10);
	return (complement ? ~value : value) >>> 0;
}

function uintProperty(body, property) {
	for (const pattern of [
		`(?:override\\s+)?uint\\s+${property}\\s*\\{\\s*get\\s*\\{\\s*return\\s+([^;]+);`,
		`(?:override\\s+)?uint\\s+${property}\\s*\\{\\s*get\\s*=>\\s*([^;]+);`,
		`(?:override\\s+)?uint\\s+${property}\\s*=>\\s*([^;]+);`,
	]) {
		const expression = body.match(new RegExp(pattern))?.[1];
		if (expression === undefined) continue;
		const identifier = expression.trim().match(/^[A-Za-z_][A-Za-z0-9_]*$/)?.[0];
		const constantExpression = identifier
			? body.match(
					new RegExp(`const\\s+uint\\s+${identifier}\\s*=\\s*([^;]+);`),
				)?.[1]
			: undefined;
		const value = uintLiteral(constantExpression ?? expression);
		if (value === undefined)
			throw new Error(`cannot resolve ${property}: ${expression.trim()}`);
		return value;
	}
	return undefined;
}

function uintArray(body, property, fallback) {
	const assignment = body.match(
		new RegExp(
			`(?<![A-Za-z0-9_])${property}\\s*=\\s*new(?:\\s+uint)?\\s*\\[\\]\\s*\\{([\\s\\S]*?)\\}`,
		),
	);
	if (!assignment) return fallback === undefined ? [] : [fallback];
	const constants = new Map(
		[
			...body.matchAll(
				/const\s+uint\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/g,
			),
		].map((match) => [match[1], uintLiteral(match[2])]),
	);
	const initializer = assignment[1]
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "");
	return initializer
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean)
		.map((expression) => {
			if (expression === "this.Signature" && fallback !== undefined)
				return fallback;
			const value = uintLiteral(expression) ?? constants.get(expression);
			if (value === undefined)
				throw new Error(`cannot resolve ${property} item: ${expression}`);
			return value;
		});
}

const formats = [];
const exportPattern =
	/\[Export\s*\(\s*typeof\s*\(\s*(ArchiveFormat|ImageFormat|AudioFormat|ScriptFormat)\s*\)\s*\)\s*\]/g;

for (const path of await sourceFiles(garbroRoot)) {
	const source = await readFile(path, "utf8");
	for (const exported of source.matchAll(exportPattern)) {
		const afterExport = exported.index + exported[0].length;
		const declaration = source
			.slice(afterExport)
			.match(
				/(?:public|internal)\s+(?:(?:sealed|partial|abstract)\s+)*class\s+([A-Za-z_][A-Za-z0-9_]*)/,
			);
		if (!declaration) continue;
		const declarationStart = afterExport + declaration.index;
		const body = classBody(source, declarationStart);
		const tag = literalProperty(body, "Tag");
		const relativeSource = relative(garbroRoot, path).replaceAll("\\", "/");
		const overrides = inventoryOverrides.get(
			`${relativeSource}:${declaration[1]}`,
		);
		const explicitExtensions =
			overrides?.extensions ?? stringArray(body, "Extensions");
		const signature = uintProperty(body, "Signature");
		formats.push({
			type: resourceKinds[exported[1]],
			tag,
			class: declaration[1],
			source: relativeSource,
			extensions:
				explicitExtensions ??
				(tag === null ? [] : [tag.split("/", 1)[0].toLowerCase()]),
			signatures:
				overrides?.signatures ?? uintArray(body, "Signatures", signature),
		});
	}
}

formats.sort(
	(left, right) =>
		left.type.localeCompare(right.type) ||
		(left.tag ?? "").localeCompare(right.tag ?? "") ||
		left.source.localeCompare(right.source) ||
		left.class.localeCompare(right.class),
);

const counts = Object.fromEntries(
	["archive", "image", "audio", "script"].map((type) => [
		type,
		formats.filter((format) => format.type === type).length,
	]),
);

const inventory = {
	schemaVersion: 2,
	generatedFrom: {
		project: "GARbro",
		repository: await git(["remote", "get-url", "origin"]),
		commit: await git(["rev-parse", "HEAD"]),
	},
	counts: { ...counts, total: formats.length },
	formats,
};

await writeFile(outputPath, `${JSON.stringify(inventory, null, "\t")}\n`);
console.log(`Wrote ${formats.length} exported formats to ${outputPath}`);
