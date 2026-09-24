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

		async function call(name, arguments_ = {}) {
			const result = await client.callTool({ name, arguments: arguments_ });
			assert.notEqual(result.isError, true, JSON.stringify(result));
			return result.structuredContent;
		}
		async function submit(task, idempotencyKey) {
			return await call("submit_task", {
				task,
				waitMs: 0,
				...(idempotencyKey === undefined ? {} : { idempotencyKey }),
			});
		}
		async function waitForTask(taskId) {
			return await call("get_task", {
				taskId,
				waitUntil: "terminal",
				timeoutMs: 30_000,
			});
		}

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
		assert.equal(serverInfo.capabilities.mandatoryExtractionVerification, true);
		assert.equal(serverInfo.capabilities.dynamicAbsolutePaths, true);
		assert.equal(serverInfo.temporaryWorkspace.path, outputRoot);
		assert(serverInfo.notSupported.includes("game logic reverse engineering"));
		const formatsResource = await client.readResource({
			uri: "garbro://formats",
		});
		const formats = JSON.parse(formatsResource.contents[0].text);
		assert(formats.some((format) => format.id === "xp3"));

		const source = { path: resolve(input, "basic.xp3") };
		const scan = await waitForTask(
			(
				await submit({
					type: "scan",
					path: input,
					formatIds: ["xp3"],
				})
			).taskId,
		);
		assert.equal(scan.result.archives[0].formatId, "xp3");
		const inspected = await waitForTask(
			(
				await submit({
					type: "inspect",
					source,
					resourceTypes: ["script"],
				})
			).taskId,
		);
		assert.equal(inspected.result.summary.entryCount, 3);
		assert.equal(inspected.result.entries.matchedTotal, 2);

		const extractionInput = {
			type: "extract",
			sources: [{ source }],
			budgets: { maxResources: 3, maxOutputBytes: "1024" },
		};
		const extraction = await submit(
			extractionInput,
			"release-smoke-extraction",
		);
		assert.equal(
			(await submit(extractionInput, "release-smoke-extraction")).taskId,
			extraction.taskId,
		);
		const extracted = await waitForTask(extraction.taskId);
		assert.equal(extracted.state, "completed");
		assert.equal(extracted.result.temporary, true);
		assert.equal(
			extracted.result.artifactDirectory,
			resolve(outputRoot, extraction.taskId, "artifacts"),
		);
		assert.equal(extracted.result.extracted, 3);
		assert.equal(extracted.result.sources[0].verification.verified, 3);
		const reportArtifact = extracted.result.sources[0].report;
		const reportBytes = await readFile(reportArtifact.absolutePath);
		assert.equal(
			createHash("sha256").update(reportBytes).digest("hex"),
			reportArtifact.sha256,
		);
		const report = JSON.parse(reportBytes.toString());
		assert.equal(report.items.length, 3);
		assert.equal(report.verification.verified, 3);
		for (const item of report.items) {
			const bytes = await readFile(item.artifact.absolutePath);
			assert.equal(BigInt(bytes.length).toString(), item.artifact.bytesWritten);
			assert.equal(
				createHash("sha256").update(bytes).digest("hex"),
				item.artifact.sha256,
			);
		}

		const unsafe = await client.callTool({
			name: "submit_task",
			arguments: {
				task: { type: "inspect", source: { path: "../escape" } },
			},
		});
		assert.equal(unsafe.isError, true);
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
