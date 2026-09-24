import {
	copyFile,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { BuildServerOptions } from "@garbro-mcp/mcp/server";
import { buildServer } from "@garbro-mcp/mcp/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

const closers: Array<() => Promise<void>> = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(closers.splice(0).map((close) => close()));
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function connect(overrides: Pick<BuildServerOptions, "registry"> = {}) {
	const root = await mkdtemp(resolve(tmpdir(), "garbro-mcp-input-"));
	const output = await mkdtemp(resolve(tmpdir(), "garbro-mcp-output-"));
	temporaryDirectories.push(root, output);
	await copyFile(resolve("fixtures/xp3/basic.xp3"), resolve(root, "basic.xp3"));
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const server = buildServer({
		...overrides,
		inputRoots: { games: root },
		outputRoot: output,
	});
	const client = new Client({ name: "garbro-mcp-test", version: "0.0.0" });
	closers.push(
		async () => client.close(),
		async () => server.close(),
	);
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return { client, root, output };
}

function structured(value: {
	structuredContent?: unknown;
}): Record<string, unknown> {
	if (
		typeof value.structuredContent !== "object" ||
		value.structuredContent === null
	)
		throw new Error("Expected structured MCP content");
	return value.structuredContent as Record<string, unknown>;
}

async function submit(
	client: Client,
	task: Record<string, unknown>,
	idempotencyKey?: string,
): Promise<string> {
	const response = await client.callTool({
		name: "submit_task",
		arguments: {
			task,
			...(idempotencyKey === undefined ? {} : { idempotencyKey }),
		},
	});
	const taskId = structured(response).taskId;
	if (typeof taskId !== "string") throw new Error("Expected a task ID");
	return taskId;
}

async function waitForTask(client: Client, taskId: string) {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		const response = await client.callTool({
			name: "get_task",
			arguments: { taskId },
		});
		const payload = structured(response);
		if (
			["completed", "partial", "failed", "cancelled"].includes(
				String(payload.state),
			)
		)
			return payload;
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 2));
	}
	throw new Error(`Task ${taskId} did not finish`);
}

describe("MCP task server", () => {
	it("exposes only the task control tools and publishes metadata as resources", async () => {
		const { client, root, output } = await connect();
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
			"cancel_task",
			"get_task",
			"submit_task",
		]);

		const resources = await client.listResources();
		expect(resources.resources.map((resource) => resource.uri).sort()).toEqual([
			"garbro://formats",
			"garbro://server/info",
		]);
		const info = await client.readResource({ uri: "garbro://server/info" });
		const infoContent = info.contents[0];
		if (!infoContent || !("text" in infoContent))
			throw new Error("Missing server info");
		expect(JSON.parse(infoContent.text)).toMatchObject({
			inputRoots: [{ id: "games", path: root }],
			outputRoot: output,
			capabilities: {
				taskTypes: ["scan", "inspect", "extract"],
				mandatoryExtractionVerification: true,
			},
		});
		const formats = await client.readResource({ uri: "garbro://formats" });
		const formatContent = formats.contents[0];
		if (!formatContent || !("text" in formatContent))
			throw new Error("Missing format catalog");
		expect(JSON.parse(formatContent.text)).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "xp3" })]),
		);
		expect(client.getInstructions()).toContain(
			"Extraction always performs an internal preflight",
		);
	});

	it("runs scan and entry inspection through the same asynchronous interface", async () => {
		const { client } = await connect();
		const scanId = await submit(client, {
			type: "scan",
			rootId: "games",
			resourceTypes: ["archive"],
		});
		const scan = await waitForTask(client, scanId);
		expect(scan).toMatchObject({
			type: "scan",
			state: "completed",
			result: {
				archives: [
					{
						source: { rootId: "games", path: "basic.xp3" },
						formatId: "xp3",
					},
				],
			},
		});

		const inspectId = await submit(client, {
			type: "inspect",
			source: { rootId: "games", path: "basic.xp3" },
			includeGlobs: ["**/*.tjs"],
			resourceTypes: ["script"],
		});
		const inspect = await waitForTask(client, inspectId);
		expect(inspect).toMatchObject({
			type: "inspect",
			state: "completed",
			result: {
				recognized: true,
				format: { id: "xp3" },
				entries: {
					matchedTotal: 1,
					entries: [{ path: "scripts/startup.tjs", resourceType: "script" }],
				},
			},
		});
	});

	it("preflights, extracts, verifies, and reports artifacts inside one task", async () => {
		const { client, output } = await connect();
		const taskId = await submit(client, {
			type: "extract",
			sources: [
				{
					source: { rootId: "games", path: "basic.xp3" },
					selection: { mode: "ids", entryIds: ["0", "1"] },
					outputSubdirectory: "result",
				},
			],
			conflictPolicy: "fail",
		});
		const task = await waitForTask(client, taskId);
		expect(task).toMatchObject({
			type: "extract",
			state: "completed",
			result: {
				status: "completed",
				hasFailures: false,
				extracted: 2,
				sources: [
					{
						verification: {
							verified: 2,
							mismatched: 0,
							invalid: 0,
							failed: 0,
						},
						report: {
							relativePath: expect.stringMatching(/^\.garbro-reports\//),
						},
					},
				],
			},
		});
		await expect(
			stat(resolve(output, "result/hello.txt")),
		).resolves.toMatchObject({
			size: 10,
		});
		const result = task.result as {
			sources: Array<{ report: { absolutePath: string } }>;
		};
		const report = JSON.parse(
			await readFile(result.sources[0]?.report.absolutePath ?? "", "utf8"),
		);
		expect(report.status).toBe("completed");
		expect(report.verification.verified).toBe(2);
		expect(report.verification.items).toHaveLength(2);
		expect(report.verification.items[0]).toMatchObject({
			status: "verified",
			verification: { level: "manifest", matched: true },
		});
	});

	it("deduplicates retried submissions by idempotency key", async () => {
		const { client } = await connect();
		const task = { type: "scan", rootId: "games" };
		const first = await submit(client, task, "scan-basic");
		const second = await submit(client, task, "scan-basic");
		expect(second).toBe(first);
	});

	it("returns a structured error for an unknown task", async () => {
		const { client } = await connect();
		const response = await client.callTool({
			name: "get_task",
			arguments: { taskId: "00000000-0000-4000-8000-000000000000" },
		});
		expect(response.isError).toBe(true);
		expect(response.structuredContent).toMatchObject({
			outcome: { status: "failed" },
			error: { code: "INVALID_ARGUMENT" },
		});
	});

	it("explains unsupported variants without claiming recognition", async () => {
		const { client, root } = await connect();
		await writeFile(resolve(root, "voice.cpz"), "CPZ6 unsupported");
		const taskId = await submit(client, {
			type: "inspect",
			source: { rootId: "games", path: "voice.cpz" },
		});
		await expect(waitForTask(client, taskId)).resolves.toMatchObject({
			state: "failed",
			result: {
				recognized: false,
				diagnosis: {
					kind: "registered-extension-no-match",
					extension: "cpz",
					candidateFormatIds: ["cmvs-cpz1", "cmvs-cpz2"],
				},
			},
		});
	});
});
