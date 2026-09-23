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
const buildManifest = JSON.parse(
	await readFile(resolve(releaseDirectory, `${prefix}-build.json`), "utf8"),
);
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

function sceneFixture() {
	const offsets = [92, 100, 108, 110, 118, 126, 128, 136, 138, 146];
	const output = Buffer.alloc(147);
	output.writeUInt32LE(92, 0);
	for (let index = 0; index < offsets.length; index += 1) {
		output.writeUInt32LE(offsets[index] ?? 0, 4 + index * 8);
		output.writeUInt32LE(1, 8 + index * 8);
	}
	output[146] = 1;
	return output;
}

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
	assert.equal(
		versionJson.semanticCatalogSha256,
		buildManifest.semanticCatalogSha256,
	);
	const doctor = JSON.parse(
		run(
			process.execPath,
			[
				bundlePath,
				"--input-root",
				`samples=${input}`,
				"--output-root",
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
				"inspect_game",
				"plan_semantic_analysis",
				"build_semantic_catalog",
				"query_semantics",
				"search_resources",
				"list_formats",
				"scan_resources",
				"scan_archives",
				"inspect_archive",
				"list_entries",
				"read_entry",
				"plan_extraction",
				"extract_entries",
				"extract_resources",
				"verify_artifacts",
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
		const serverInfo = await call("get_server_info");
		assert.equal(serverInfo.outcome.status, "ok");
		assert.equal(serverInfo.server.version, version);
		assert.equal(serverInfo.server.buildId, buildManifest.buildId);
		assert.equal(
			serverInfo.server.formatCatalogSha256,
			buildManifest.formatCatalogSha256,
		);
		assert.equal(
			serverInfo.server.semanticCatalogSha256,
			buildManifest.semanticCatalogSha256,
		);
		const inspection = await call("inspect_game", {
			game: { rootId: "samples", path: "." },
		});
		assert.equal(inspection.status, "resolved");
		assert.equal(inspection.matches[0].engineId, "siglus");
		const semanticPlan = await call("plan_semantic_analysis", {
			game: { rootId: "samples", path: "." },
			goal: {},
		});
		assert.equal(semanticPlan.status, "ready");
		const semanticBuild = await call("build_semantic_catalog", {
			planDigest: semanticPlan.planDigest,
		});
		assert.equal(semanticBuild.summary.records, 0);
		assert.equal((await call("query_semantics", {})).totalRelations, 0);
		assert.equal(
			(await call("list_formats", { extension: "xp3" })).formats[0].id,
			"xp3",
		);
		assert.equal(
			(await call("scan_archives", { rootId: "samples" })).archives[0].formatId,
			"xp3",
		);
		assert.equal(
			(
				await call("scan_resources", {
					rootId: "samples",
					formatIds: ["xp3"],
				})
			).archives[0].formatId,
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
		const plan = await call("plan_extraction", {
			source,
			budgets: { maxResources: 3, maxOutputBytes: "1024" },
		});
		assert.equal(plan.ready, 3);
		assert.equal(plan.budgetViolations.length, 0);
		const extracted = await call(
			"extract_entries",
			{
				source,
				expectedPlanDigest: plan.planDigest,
				budgets: { maxResources: 3, maxOutputBytes: "1024" },
			},
			{
				onprogress: (update) => {
					progress.push(update.progress);
				},
			},
		);
		assert.equal(extracted.status, "completed");
		assert.equal(extracted.extracted, 3);
		assert.deepEqual(progress, [1, 2, 3]);
		assert.equal(extracted.items.length, 0);
		assert.equal(extracted.itemsOmitted, 3);
		const reportBytes = await readFile(extracted.report.absolutePath);
		assert.equal(
			createHash("sha256").update(reportBytes).digest("hex"),
			extracted.report.sha256,
		);
		const report = JSON.parse(reportBytes.toString());
		assert.equal(report.items.length, 3);
		for (const item of report.items) {
			const bytes = await readFile(item.artifact.absolutePath);
			assert.equal(BigInt(bytes.length).toString(), item.artifact.bytesWritten);
			assert.equal(
				createHash("sha256").update(bytes).digest("hex"),
				item.artifact.sha256,
			);
		}
		const firstArtifact = report.items[0].artifact;
		const verification = await call("verify_artifacts", {
			artifacts: [
				{
					outputRootId: firstArtifact.outputRootId,
					path: firstArtifact.relativePath,
					expected: {
						sha256: firstArtifact.sha256,
						bytes: firstArtifact.bytesWritten,
					},
				},
			],
		});
		assert.equal(verification.status, "completed");
		assert.equal(verification.results[0].status, "verified");
		assert.equal(
			(await call("extract_entries", { source, conflictPolicy: "skip" }))
				.skipped,
			3,
		);
		assert.equal(
			(
				await call("extract_resources", {
					sources: [source],
					conflictPolicy: "skip",
				})
			).sources[0].skipped,
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
	await writeFile(resolve(input, "Scene.pck"), sceneFixture());
	const gameexe = Buffer.alloc(16);
	gameexe.writeUInt32LE(1, 4);
	await writeFile(resolve(input, "Gameexe.dat"), gameexe);
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
