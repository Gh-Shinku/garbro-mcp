import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { unzipSync } from "fflate";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
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
const checksums = (
	await readFile(resolve(releaseDirectory, `${prefix}-SHA256SUMS`), "utf8")
)
	.trim()
	.split("\n");
for (const line of checksums) {
	const [hash, name] = line.split("  ");
	assert(
		[
			`${prefix}-portable.zip`,
			`${prefix}.tgz`,
			`${prefix}-build.json`,
		].includes(name),
	);
	assert.equal(
		createHash("sha256")
			.update(await readFile(resolve(releaseDirectory, name)))
			.digest("hex"),
		hash,
	);
}
assert.equal(checksums.length, 3);

const sandbox = await mkdtemp(resolve(tmpdir(), "garbro-release-test-"));
const input = resolve(sandbox, "input");
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
	const transport = new StdioClientTransport({
		command: process.execPath,
		args: [
			bundlePath,
			"--input-root",
			`samples=${input}`,
			"--output-root",
			outputRoot,
		],
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
		const names = (await client.listTools()).tools
			.map((tool) => tool.name)
			.sort();
		assert.deepEqual(
			names,
			[
				"get_server_info",
				"list_formats",
				"scan_archives",
				"inspect_archive",
				"list_entries",
				"read_entry",
				"extract_entries",
			].sort(),
		);
		async function call(name, arguments_ = {}, options) {
			const result = await client.callTool(
				{ name, arguments: arguments_ },
				options,
			);
			assert.notEqual(result.isError, true, JSON.stringify(result));
			return result.structuredContent;
		}
		const source = { rootId: "samples", path: "basic.xp3" };
		assert.equal((await call("get_server_info")).server.version, version);
		assert.equal(
			(await call("list_formats", { extension: "xp3" })).formats[0].id,
			"xp3",
		);
		assert.equal(
			(await call("scan_archives", { rootId: "samples" })).archives[0].format
				.id,
			"xp3",
		);
		assert.equal(
			(await call("inspect_archive", { source })).summary.entryCount,
			3,
		);
		assert.equal((await call("list_entries", { source })).entries.length, 3);
		assert.equal(
			(
				await call("read_entry", {
					source,
					entryId: "0",
					mode: "text",
					encoding: "cp932",
				})
			).preview.encoding,
			"cp932",
		);
		const progress = [];
		const extracted = await call(
			"extract_entries",
			{ source },
			{
				onprogress: (update) => {
					progress.push(update.progress);
				},
			},
		);
		assert.equal(extracted.status, "completed");
		assert.equal(extracted.extracted, 3);
		assert.deepEqual(progress, [1, 2, 3]);
		for (const item of extracted.items) {
			const bytes = await readFile(item.artifact.absolutePath);
			assert.equal(BigInt(bytes.length).toString(), item.artifact.bytesWritten);
			assert.equal(
				createHash("sha256").update(bytes).digest("hex"),
				item.artifact.sha256,
			);
		}
		assert.equal(
			(await call("extract_entries", { source, conflictPolicy: "skip" }))
				.skipped,
			3,
		);
		const unsafe = await client.callTool({
			name: "inspect_archive",
			arguments: { source: { rootId: "samples", path: "../escape" } },
		});
		assert.equal(unsafe.isError, true);
		assert.equal(unsafe.structuredContent.error.code, "UNSAFE_PATH");
	} catch (error) {
		throw new Error(`Release smoke failed:\n${stderr}`, { cause: error });
	} finally {
		await client.close();
	}
}

try {
	await Promise.all(
		[input, cwd, portable, installation].map((path) => mkdir(path)),
	);
	await copyFile(
		resolve(repositoryRoot, "fixtures/xp3/basic.xp3"),
		resolve(input, "basic.xp3"),
	);
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
	assert.equal(portableManifest.version, version);
	assert.equal(portableManifest.dependencies, undefined);
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
		`node_modules/.bin/garbro-mcp-server${process.platform === "win32" ? ".cmd" : ""}`,
	);
	assert.equal(run(executable, ["--version"], { cwd }).trim(), version);
	for (const file of expectedFiles)
		assert.deepEqual(
			await readFile(resolve(installed, file)),
			await readFile(resolve(portable, file)),
		);
	await smoke(
		resolve(installed, "garbro-mcp.cjs"),
		resolve(sandbox, "installed-output"),
	);
	console.log(
		`Release ${version}: ZIP and offline npm installation passed independent stdio smoke tests.`,
	);
} finally {
	await rm(sandbox, { recursive: true, force: true });
}
