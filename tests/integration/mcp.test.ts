import { buildServer } from "@garbro-mcp/mcp/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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

async function connect() {
	const root = await mkdtemp(resolve(tmpdir(), "garbro-mcp-input-"));
	const output = await mkdtemp(resolve(tmpdir(), "garbro-mcp-output-"));
	temporaryDirectories.push(root, output);
	await copyFile(resolve("fixtures/xp3/basic.xp3"), resolve(root, "basic.xp3"));
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const server = buildServer({
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

describe("MCP server", () => {
	it("exposes the automation-oriented tools and support catalog", async () => {
		const { client, root, output } = await connect();
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
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

		const info = await client.callTool({ name: "get_server_info" });
		expect(info.structuredContent).toMatchObject({
			inputRoots: [{ id: "games", path: root }],
			outputRoot: output,
			capabilities: { archiveCreation: false },
		});

		const formats = await client.callTool({
			name: "list_formats",
			arguments: { resourceType: "archive", extension: "xp3" },
		});
		expect(formats.structuredContent).toMatchObject({
			total: 1,
			formats: [
				{
					id: "xp3",
					support: {
						reference: { type: "archive", tag: "XP3" },
						status: "partial",
					},
				},
			],
		});
	});

	it("scans, inspects, filters, and previews by logical path", async () => {
		const { client } = await connect();
		const source = { rootId: "games", path: "basic.xp3" };

		const scanned = await client.callTool({
			name: "scan_archives",
			arguments: { rootId: "games", path: "." },
		});
		expect(scanned.structuredContent).toMatchObject({
			scanned: 1,
			archives: [{ source, format: { id: "xp3" } }],
			complete: true,
		});

		const inspected = await client.callTool({
			name: "inspect_archive",
			arguments: { source },
		});
		expect(inspected.structuredContent).toMatchObject({
			recognized: true,
			format: { id: "xp3" },
			summary: { entryCount: 3 },
		});

		const entries = await client.callTool({
			name: "list_entries",
			arguments: { source, includeGlobs: ["**/*.tjs"] },
		});
		expect(entries.structuredContent).toMatchObject({
			archiveTotal: 3,
			matchedTotal: 1,
			entries: [{ id: "1", path: "scripts/startup.tjs", size: "26" }],
		});

		const preview = await client.callTool({
			name: "read_entry",
			arguments: { source, entryId: "0", maxBytes: 5 },
		});
		expect(preview.structuredContent).toMatchObject({
			entry: { id: "0" },
			preview: { kind: "text", bytesRead: 5, truncated: true },
		});
	});

	it("batch extracts per item and confines writes", async () => {
		const { client, output } = await connect();
		const source = { rootId: "games", path: "basic.xp3" };
		const progress: number[] = [];
		const extracted = await client.callTool(
			{
				name: "extract_entries",
				arguments: {
					source,
					selection: { mode: "ids", entryIds: ["0", "missing"] },
				},
			},
			{ onprogress: (update) => progress.push(update.progress) },
		);
		expect(extracted.isError).not.toBe(true);
		expect(extracted.structuredContent).toMatchObject({
			status: "partial",
			extracted: 1,
			failed: 1,
			bytesWritten: "10",
			items: [
				{ entryId: "0", status: "extracted" },
				{
					entryId: "missing",
					status: "failed",
					error: { code: "ENTRY_NOT_FOUND" },
				},
			],
		});
		expect(progress).toEqual([1, 2]);
		expect(
			await readFile(
				resolve(output, "games/basic.xp3.extracted/hello.txt"),
				"utf8",
			),
		).toHaveLength(10);

		const unsafe = await client.callTool({
			name: "inspect_archive",
			arguments: {
				source: {
					rootId: "games",
					path: resolve("fixtures/xp3/basic.xp3"),
				},
			},
		});
		expect(unsafe).toMatchObject({
			isError: true,
			structuredContent: { error: { code: "UNSAFE_PATH" } },
		});
	});
});
