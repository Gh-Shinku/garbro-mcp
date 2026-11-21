import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { unzipSync } from "fflate";
import {
	releaseDirectory,
	repositoryRoot,
	run,
	validateVersion,
} from "./release-common.mjs";

const { values } = parseArgs({ options: { version: { type: "string" } } });
const manifest = JSON.parse(
	await readFile(resolve(repositoryRoot, "distribution/package.json"), "utf8"),
);
const version = validateVersion(values.version ?? manifest.version);
const prefix = `garbro-mcp-${version}`;
const buildManifest = JSON.parse(
	await readFile(resolve(releaseDirectory, `${prefix}-build.json`), "utf8"),
);
const checksums = (
	await readFile(resolve(releaseDirectory, `${prefix}-SHA256SUMS`), "utf8")
)
	.trim()
	.split("\n");
const remaining = new Set([
	`${prefix}-portable.zip`,
	`${prefix}.tgz`,
	`${prefix}-build.json`,
]);
for (const line of checksums) {
	const [hash, name] = line.split("  ");
	assert(
		remaining.delete(name),
		`Unexpected or duplicate checksum for ${name}`,
	);
	assert.equal(
		createHash("sha256")
			.update(await readFile(resolve(releaseDirectory, name)))
			.digest("hex"),
		hash,
	);
}
assert.equal(remaining.size, 0);
assert.equal(buildManifest.version, version);
if (process.env.GITHUB_SHA)
	assert.equal(buildManifest.commit, process.env.GITHUB_SHA);

const sandbox = await mkdtemp(resolve(tmpdir(), "garbro-release-test-"));
const cwd = resolve(sandbox, "unrelated-working-directory");
const portable = resolve(sandbox, "portable");
const installation = resolve(sandbox, "installation");
const expectedFiles = [
	"LICENSE",
	"README.md",
	"THIRD_PARTY_NOTICES.md",
	"garbro-mcp.cjs",
	"package.json",
];

async function smoke(bundlePath, outputRoot) {
	assert.equal(
		run(process.execPath, [bundlePath, "--version"], { cwd }).trim(),
		version,
	);
	const versionJson = JSON.parse(
		run(process.execPath, [bundlePath, "--version", "--json"], { cwd }),
	);
	assert.equal(versionJson.buildId, buildManifest.buildId);
	assert.equal(versionJson.gitCommit, buildManifest.commit);
	const doctor = JSON.parse(
		run(
			process.execPath,
			[
				bundlePath,
				"--temp-dir",
				outputRoot,
				"--expected-build-id",
				buildManifest.buildId,
				"--doctor",
				"--json",
			],
			{ cwd },
		),
	);
	assert.equal(doctor.status, "ok");
	assert.equal(doctor.build.buildId, buildManifest.buildId);

	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [bundlePath, "--temp-dir", outputRoot],
		cwd,
		env: { ...process.env, NODE_PATH: "" },
		stderr: "pipe",
	});
	let stderr = "";
	transport.stderr?.on("data", (value) => {
		stderr += value.toString();
	});
	const client = new Client({ name: "release-smoke", version: "1.0.0" });
	try {
		await client.connect(transport);
		assert.deepEqual(
			(await client.listTools()).tools.map((tool) => tool.name).sort(),
			["cancel_task", "get_task", "submit_task"],
		);

		const infoResource = await client.readResource({
			uri: "garbro://server/info",
		});
		const serverInfo = JSON.parse(infoResource.contents[0].text);
		assert.equal(serverInfo.server.version, version);
		assert.equal(serverInfo.server.buildId, buildManifest.buildId);
		assert.equal(
			serverInfo.server.formatCatalogSha256,
			buildManifest.formatCatalogSha256,
		);
	} catch (error) {
		throw new Error(`Release smoke failed:\n${stderr}`, { cause: error });
	} finally {
		await client.close();
	}
}

try {
	await Promise.all([cwd, portable, installation].map((path) => mkdir(path)));
	const files = unzipSync(
		await readFile(resolve(releaseDirectory, `${prefix}-portable.zip`)),
	);
	assert.deepEqual(
		Object.keys(files).sort(),
		expectedFiles.map((file) => `garbro-mcp/${file}`).sort(),
	);
	for (const file of expectedFiles)
		await writeFile(resolve(portable, file), files[`garbro-mcp/${file}`]);
	const portableManifest = JSON.parse(
		await readFile(resolve(portable, "package.json"), "utf8"),
	);
	assert.equal(portableManifest.name, "garbro-mcp");
	assert.equal(portableManifest.version, version);
	assert.equal(portableManifest.private, undefined);
	assert.equal(portableManifest.dependencies, undefined);
	assert.deepEqual(portableManifest.bin, {
		"garbro-mcp": "./garbro-mcp.cjs",
	});
	await smoke(
		resolve(portable, "garbro-mcp.cjs"),
		resolve(sandbox, "portable-output"),
	);
	run(
		"npm",
		[
			"install",
			"--offline",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--package-lock=false",
			"--prefix",
			installation,
			resolve(releaseDirectory, `${prefix}.tgz`),
		],
		{
			cwd,
			env: { ...process.env, npm_config_cache: resolve(sandbox, "npm-cache") },
		},
	);
	const installed = resolve(installation, "node_modules/garbro-mcp");
	const executable = resolve(
		installation,
		`node_modules/.bin/garbro-mcp${process.platform === "win32" ? ".cmd" : ""}`,
	);
	assert.equal(run(executable, ["--version"], { cwd }).trim(), version);
	for (const file of expectedFiles)
		assert.deepEqual(
			await readFile(resolve(installed, file)),
			await readFile(resolve(portable, file)),
		);
	console.log(
		`Release ${version}: ZIP and offline npm installation passed bundle, stdio startup and executable checks.`,
	);
} finally {
	await rm(sandbox, { recursive: true, force: true });
}
