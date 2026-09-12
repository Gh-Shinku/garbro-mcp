import { buildServer } from "@garbro-mcp/mcp/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
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

describe("MCP server", () => {
	it("registers the stable tools and returns structured archive metadata", async () => {
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const server = buildServer();
		const client = new Client({ name: "garbro-mcp-test", version: "0.0.0" });
		closers.push(
			async () => client.close(),
			async () => server.close(),
		);
		await server.connect(serverTransport);
		await client.connect(clientTransport);

		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
			[
				"detect_archive",
				"extract_archive",
				"extract_entry",
				"list_entries",
				"list_formats",
			].sort(),
		);

		const result = await client.callTool({
			name: "list_entries",
			arguments: { archivePath: resolve("fixtures/xp3/basic.xp3"), limit: 2 },
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			total: 3,
			nextOffset: 2,
			format: { id: "xp3" },
		});

		const formats = await client.callTool({ name: "list_formats" });
		expect(formats.structuredContent).toMatchObject({
			formats: [
				{ id: "xp3" },
				{ id: "adpack32" },
				{ id: "afs" },
				{ id: "cpk" },
				{ id: "ami" },
				{ id: "bgi-arc" },
				{ id: "buriko-arc" },
				{ id: "drs" },
				{ id: "ikura-gdl" },
				{ id: "escude-bin" },
				{ id: "gsp" },
				{ id: "cat-system-int" },
				{ id: "favorite-acpx" },
				{ id: "favorite-bin" },
			],
		});

		const detected = await client.callTool({
			name: "detect_archive",
			arguments: { archivePath: resolve("fixtures/xp3/basic.xp3") },
		});
		expect(detected.structuredContent).toMatchObject({
			detected: true,
			format: { id: "xp3" },
		});

		const entryOutput = await mkdtemp(resolve(tmpdir(), "garbro-mcp-entry-"));
		const archiveOutput = await mkdtemp(
			resolve(tmpdir(), "garbro-mcp-archive-"),
		);
		temporaryDirectories.push(entryOutput, archiveOutput);
		const extractedEntry = await client.callTool({
			name: "extract_entry",
			arguments: {
				archivePath: resolve("fixtures/xp3/basic.xp3"),
				entryId: "0",
				outputDirectory: entryOutput,
			},
		});
		expect(extractedEntry.structuredContent).toMatchObject({
			bytesWritten: "10",
		});

		const extractedArchive = await client.callTool({
			name: "extract_archive",
			arguments: {
				archivePath: resolve("fixtures/xp3/basic.xp3"),
				outputDirectory: archiveOutput,
			},
		});
		expect(extractedArchive.structuredContent).toMatchObject({
			extractedEntries: 3,
			bytesWritten: "42",
		});

		const unsupported = await client.callTool({
			name: "extract_entry",
			arguments: {
				archivePath: resolve("fixtures/xp3/protected.xp3"),
				entryId: "0",
				outputDirectory: entryOutput,
				overwrite: true,
			},
		});
		expect(unsupported).toMatchObject({
			isError: true,
			structuredContent: {
				error: { code: "UNSUPPORTED_FEATURE" },
			},
		});
	});
});
