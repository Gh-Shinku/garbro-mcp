import { build } from "esbuild";
import { zipSync } from "fflate";
import { createHash } from "node:crypto";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { builtinModules } from "node:module";
import { parseArgs } from "node:util";
import {
	releaseDirectory,
	repositoryRoot,
	run,
	validateVersion,
} from "./release-common.mjs";

const { values } = parseArgs({
	options: {
		version: { type: "string" },
		prerelease: { type: "boolean" },
	},
});
const manifest = JSON.parse(
	await readFile(resolve(repositoryRoot, "distribution/package.json"), "utf8"),
);
const version = validateVersion(
	values.version ?? manifest.version,
	values.prerelease,
);
await mkdir(releaseDirectory, { recursive: true });
const staging = await mkdtemp(resolve(releaseDirectory, ".build-"));

async function dependencyNotices(inputs) {
	const packages = new Map();
	for (const input of Object.keys(inputs)) {
		if (!input.includes("node_modules/")) continue;
		let directory = dirname(resolve(repositoryRoot, input));
		while (directory !== dirname(directory)) {
			try {
				const metadata = JSON.parse(
					await readFile(resolve(directory, "package.json"), "utf8"),
				);
				if (metadata.name && metadata.version) {
					packages.set(`${metadata.name}@${metadata.version}`, {
						directory,
						metadata,
					});
					break;
				}
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
			directory = dirname(directory);
		}
	}
	let notices = await readFile(
		resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
		"utf8",
	);
	const dependencies = [];
	for (const [id, { directory, metadata }] of [...packages].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const licenses = (await readdir(directory))
			.filter((name) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(name))
			.sort();
		if (licenses.length === 0)
			throw new Error(`No license text found for bundled dependency ${id}`);
		dependencies.push({
			name: metadata.name,
			version: metadata.version,
			license: metadata.license,
		});
		notices += `\n## Bundled dependency: ${id}\n\nLicense: ${metadata.license ?? "see below"}\n`;
		for (const file of licenses)
			notices += `\n### ${file}\n\n\`\`\`text\n${await readFile(resolve(directory, file), "utf8")}\n\`\`\`\n`;
	}
	return { notices, dependencies };
}

try {
	const bundle = await build({
		absWorkingDir: repositoryRoot,
		entryPoints: ["packages/mcp/dist/index.js"],
		outfile: resolve(staging, "garbro-mcp.cjs"),
		bundle: true,
		platform: "node",
		target: "node24",
		format: "cjs",
		metafile: true,
		legalComments: "eof",
		define: { GARBRO_MCP_VERSION: JSON.stringify(version) },
	});
	for (const output of Object.values(bundle.metafile.outputs))
		for (const imported of output.imports)
			if (
				imported.external &&
				!builtinModules.includes(imported.path) &&
				!builtinModules.includes(imported.path.replace(/^node:/, ""))
			)
				throw new Error(`Unbundled runtime dependency: ${imported.path}`);
	const { notices, dependencies } = await dependencyNotices(
		bundle.metafile.inputs,
	);
	await writeFile(resolve(staging, "THIRD_PARTY_NOTICES.md"), notices);
	await copyFile(
		resolve(repositoryRoot, "LICENSE"),
		resolve(staging, "LICENSE"),
	);
	await copyFile(
		resolve(repositoryRoot, "distribution/README.md"),
		resolve(staging, "README.md"),
	);
	await writeFile(
		resolve(staging, "package.json"),
		`${JSON.stringify({ ...manifest, version }, null, 2)}\n`,
	);
	await chmod(resolve(staging, "garbro-mcp.cjs"), 0o755);
	const packed = JSON.parse(
		run(
			"npm",
			[
				"pack",
				"--json",
				"--ignore-scripts",
				"--pack-destination",
				releaseDirectory,
			],
			{ cwd: staging },
		),
	);
	const zipName = `garbro-mcp-${version}-portable.zip`;
	const zipFiles = {};
	for (const file of (await readdir(staging)).sort())
		zipFiles[`garbro-mcp/${file}`] = [
			await readFile(resolve(staging, file)),
			{ mtime: new Date("2020-01-01T00:00:00Z") },
		];
	await writeFile(
		resolve(releaseDirectory, zipName),
		zipSync(zipFiles, { level: 9 }),
	);
	const metadataName = `garbro-mcp-${version}-build.json`;
	await writeFile(
		resolve(releaseDirectory, metadataName),
		`${JSON.stringify(
			{
				version,
				commit: run("git", ["rev-parse", "HEAD"], {
					cwd: repositoryRoot,
				}).trim(),
				dependencies,
			},
			null,
			2,
		)}\n`,
	);
	const artifacts = [zipName, packed[0].filename, metadataName];
	const checksums = await Promise.all(
		artifacts.map(
			async (name) =>
				`${createHash("sha256")
					.update(await readFile(resolve(releaseDirectory, name)))
					.digest("hex")}  ${name}`,
		),
	);
	await writeFile(
		resolve(releaseDirectory, `garbro-mcp-${version}-SHA256SUMS`),
		`${checksums.join("\n")}\n`,
	);
	console.log(`Built ${version}:\n${artifacts.join("\n")}`);
} finally {
	await rm(staging, { recursive: true, force: true });
}
