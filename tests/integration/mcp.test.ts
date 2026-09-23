import { createHash } from "node:crypto";
import {
	copyFile,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { type ArchiveEntry, FormatRegistry } from "@garbro-mcp/core";
import { type BuildServerOptions, buildServer } from "@garbro-mcp/mcp/server";
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

async function connect(
	overrides: Pick<BuildServerOptions, "registry"> = {},
	withMusicRoot = false,
) {
	const root = await mkdtemp(resolve(tmpdir(), "garbro-mcp-input-"));
	const output = await mkdtemp(resolve(tmpdir(), "garbro-mcp-output-"));
	const music = withMusicRoot
		? await mkdtemp(resolve(tmpdir(), "garbro-mcp-music-"))
		: undefined;
	temporaryDirectories.push(
		root,
		output,
		...(music === undefined ? [] : [music]),
	);
	await copyFile(resolve("fixtures/xp3/basic.xp3"), resolve(root, "basic.xp3"));
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const server = buildServer({
		...overrides,
		inputRoots: { games: root },
		...(music === undefined
			? { outputRoot: output }
			: { outputRoots: { default: output, music } }),
	});
	const client = new Client({ name: "garbro-mcp-test", version: "0.0.0" });
	closers.push(
		async () => client.close(),
		async () => server.close(),
	);
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return { client, root, output, music };
}

describe("MCP server", () => {
	it("exposes the automation-oriented tools and support catalog", async () => {
		const { client, root, output } = await connect();
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual(
			[
				"get_server_info",
				"list_formats",
				"scan_resources",
				"inspect_archive",
				"list_entries",
				"plan_extraction",
				"extract_entries",
				"extract_resources",
				"start_extraction",
				"get_extraction_status",
				"cancel_extraction",
				"verify_artifacts",
			].sort(),
		);

		const info = await client.callTool({ name: "get_server_info" });
		expect(info.structuredContent).toMatchObject({
			outcome: { status: "ok", warnings: [] },
			server: {
				buildId: "development",
				protocolVersion: "6",
				dirty: true,
			},
			inputRoots: [{ id: "games", path: root }],
			outputRoot: output,
			limits: { decodedResourceMaxBytes: 256 * 1024 * 1024 },
			purpose: expect.stringContaining("extract"),
			notSupported: expect.arrayContaining([
				"game logic reverse engineering",
				"automatic semantic mapping",
			]),
			capabilities: { archiveCreation: false },
		});
		expect(client.getInstructions()).toContain(
			"Do not delegate game-logic reverse engineering",
		);

		const formats = await client.callTool({
			name: "list_formats",
			arguments: { resourceType: "archive", extension: "xp3" },
		});
		expect(formats.structuredContent).toMatchObject({
			total: 1,
			formats: [
				{
					id: "xp3",
					resourceType: "archive",
					status: "partial",
				},
			],
		});
	});

	it("scans resources with filters and detection evidence", async () => {
		const { client } = await connect();
		const scanned = await client.callTool({
			name: "scan_resources",
			arguments: {
				rootId: "games",
				resourceTypes: ["archive"],
				formatIds: ["xp3"],
			},
		});
		expect(scanned.isError).not.toBe(true);
		expect(scanned.structuredContent).toMatchObject({
			complete: true,
			counts: {
				recognized: 1,
				byResourceType: { archive: 1 },
				byFormat: { xp3: 1 },
			},
			archives: [
				{
					formatId: "xp3",
					format: {
						id: "xp3",
						resourceType: "archive",
						status: expect.any(String),
						verification: expect.any(String),
					},
					validation: "structural",
					confidence: "high",
					warnings: [],
				},
			],
		});

		const excluded = await client.callTool({
			name: "scan_resources",
			arguments: { rootId: "games", formatIds: ["reallive-nwa-audio"] },
		});
		expect(excluded.structuredContent).toMatchObject({
			complete: true,
			archives: [],
			counts: { recognized: 0, byFormat: {} },
		});
	});

	it("extracts and reads reports through an explicitly named output root", async () => {
		const { client, music } = await connect({}, true);
		expect(music).toBeDefined();
		const source = { rootId: "games", path: "basic.xp3" };
		const extracted = await client.callTool({
			name: "extract_entries",
			arguments: {
				source,
				outputRootId: "music",
				outputSubdirectory: "Rewrite",
				inline: "all",
			},
		});
		expect(extracted.isError).not.toBe(true);
		expect(extracted.structuredContent).toMatchObject({
			outputRootId: "music",
			outputDirectory: resolve(music ?? "", "Rewrite"),
			extracted: 3,
			report: { outputRootId: "music" },
		});
		const reportPath = (
			extracted.structuredContent as {
				report: { relativePath: string };
			}
		).report.relativePath;
		const report = await client.callTool({
			name: "extract_entries",
			arguments: { reportPath, outputRootId: "music", inline: "summary" },
		});
		expect(report.isError).not.toBe(true);
		expect(report.structuredContent).toMatchObject({
			outputRootId: "music",
			extracted: 3,
		});

		const rejected = await client.callTool({
			name: "extract_entries",
			arguments: { source, outputRootId: "missing" },
		});
		expect(rejected.isError).toBe(true);
		expect(rejected.structuredContent).toMatchObject({
			error: {
				code: "INVALID_ARGUMENT",
				details: { allowedRoots: ["default", "music"] },
			},
		});
	});

	it("plans extraction costs and requires an unchanged plan before writing", async () => {
		const { client, output } = await connect();
		const source = { rootId: "games", path: "basic.xp3" };
		const planned = await client.callTool({
			name: "plan_extraction",
			arguments: {
				source,
				outputSubdirectory: "planned",
				budgets: { maxResources: 3, maxOutputBytes: "1024" },
				inline: "all",
			},
		});
		expect(planned.isError).not.toBe(true);
		expect(planned.structuredContent).toMatchObject({
			selected: 3,
			ready: 3,
			unknownOutputSizes: 0,
			budgetViolations: [],
			budgetUnknowns: [],
		});
		expect(
			(planned.structuredContent as { items: Array<{ status: string }> }).items,
		).toHaveLength(3);
		expect(
			(
				planned.structuredContent as { items: Array<{ status: string }> }
			).items.every((item) => item.status === "ready"),
		).toBe(true);
		await expect(stat(resolve(output, "planned"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		const planDigest = (planned.structuredContent as { planDigest: string })
			.planDigest;
		const extracted = await client.callTool({
			name: "extract_entries",
			arguments: {
				source,
				outputSubdirectory: "planned",
				expectedPlanDigest: planDigest,
				budgets: { maxResources: 3, maxOutputBytes: "1024" },
				inline: "all",
			},
		});
		expect(extracted.isError).not.toBe(true);
		expect(extracted.structuredContent).toMatchObject({ extracted: 3 });
		const artifact = (
			extracted.structuredContent as {
				items: Array<{
					artifact: {
						outputRootId: string;
						relativePath: string;
						sha256: string;
						bytesWritten: string;
					};
				}>;
			}
		).items[0]?.artifact;
		expect(artifact).toBeDefined();
		const verified = await client.callTool({
			name: "verify_artifacts",
			arguments: {
				artifacts: [
					{
						outputRootId: artifact?.outputRootId,
						path: artifact?.relativePath,
						expected: {
							sha256: artifact?.sha256,
							bytes: artifact?.bytesWritten,
						},
					},
				],
			},
		});
		expect(verified.isError).not.toBe(true);
		expect(verified.structuredContent).toMatchObject({
			status: "completed",
			verified: 1,
			results: [{ status: "verified", level: "manifest", matched: true }],
		});
	});

	it("scans, inspects, and filters by logical path", async () => {
		const { client } = await connect();
		const source = { rootId: "games", path: "basic.xp3" };

		const scanned = await client.callTool({
			name: "scan_resources",
			arguments: { rootId: "games", path: "." },
		});
		expect(scanned.structuredContent).toMatchObject({
			scanned: 1,
			archives: [{ source, formatId: "xp3" }],
			complete: true,
		});

		const inspected = await client.callTool({
			name: "inspect_archive",
			arguments: { source },
		});
		expect(inspected.structuredContent).toMatchObject({
			recognized: true,
			validation: "structural",
			confidence: "high",
			warnings: [],
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
			entries: [
				{
					id: "1",
					path: "scripts/startup.tjs",
					size: "26",
					resourceType: "script",
				},
			],
		});
		const scripts = await client.callTool({
			name: "list_entries",
			arguments: { source, resourceTypes: ["script"] },
		});
		expect(scripts.structuredContent).toMatchObject({
			matchedTotal: 2,
			entries: [{ resourceType: "script" }, { resourceType: "script" }],
		});
	});

	it("runs extraction in a background job with pollable progress", async () => {
		const { client, output } = await connect();
		const started = await client.callTool({
			name: "start_extraction",
			arguments: {
				source: { rootId: "games", path: "basic.xp3" },
				outputSubdirectory: "async-output",
				selection: { mode: "all", resourceTypes: ["script"] },
			},
		});
		expect(started.isError).not.toBe(true);
		const jobId = (started.structuredContent as { jobId: string }).jobId;
		let status:
			| {
					state: string;
					status?: string;
					selected?: number;
					extracted?: number;
			  }
			| undefined;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const polled = await client.callTool({
				name: "get_extraction_status",
				arguments: { jobId, inline: "all" },
			});
			status = polled.structuredContent as typeof status;
			if (
				status !== undefined &&
				["completed", "partial", "failed", "cancelled"].includes(status.state)
			)
				break;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(status).toMatchObject({
			state: "completed",
			status: "completed",
			selected: 2,
			extracted: 2,
		});
		expect(
			await stat(resolve(output, "async-output/scripts/startup.tjs")),
		).toBeTruthy();
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
			outcome: {
				status: "partial",
				nextAction: { code: "review_failures" },
			},
			hasFailures: true,
			extracted: 1,
			failed: 1,
			bytesWritten: "10",
			itemsOmitted: 1,
			items: [
				{
					entryId: "missing",
					status: "failed",
					formatId: "xp3",
					decoderId: "xp3",
					error: { code: "ENTRY_NOT_FOUND" },
				},
			],
		});
		const payload = extracted.structuredContent as {
			report: { absolutePath: string };
		};
		const report = JSON.parse(
			await readFile(payload.report.absolutePath, "utf8"),
		);
		expect(report.items.map((item: { status: string }) => item.status)).toEqual(
			["extracted", "failed"],
		);
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
			structuredContent: {
				outcome: { status: "failed" },
				error: { code: "UNSAFE_PATH" },
			},
		});
	});

	it("batch extracts multiple sources with per-source failures", async () => {
		const { client } = await connect();
		const result = await client.callTool({
			name: "extract_resources",
			arguments: {
				sources: [
					{ rootId: "games", path: "basic.xp3" },
					{ rootId: "games", path: "missing.xp3" },
				],
				inline: "all",
			},
		});
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toMatchObject({
			status: "partial",
			hasFailures: true,
			selected: 3,
			extracted: 3,
			failed: 1,
			sources: [
				{ source: { path: "basic.xp3" }, status: "completed" },
				{
					source: { path: "missing.xp3" },
					status: "failed",
					reportError: { code: "IO_ERROR" },
				},
			],
		});
	});

	it("preflights total resource-batch budgets before writing", async () => {
		const { client, output } = await connect();
		const result = await client.callTool({
			name: "extract_resources",
			arguments: {
				sources: [
					{ rootId: "games", path: "basic.xp3" },
					{ rootId: "games", path: "basic.xp3" },
				],
				budgets: { maxResources: 5, maxOutputBytes: "2048" },
			},
		});
		expect(result).toMatchObject({
			isError: true,
			structuredContent: {
				outcome: { status: "failed" },
				error: {
					code: "LIMIT_EXCEEDED",
					details: {
						violations: [{ budget: "maxResources", actual: "6", limit: "5" }],
					},
				},
			},
		});
		await expect(stat(resolve(output, "games"))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("bounds default catalog responses and retains opt-in details", async () => {
		const { client } = await connect();
		const result = await client.callTool({ name: "list_formats" });
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
			16384,
		);
		const payload = result.structuredContent as {
			formats: { details?: unknown }[];
		};
		expect(payload.formats.length).toBeLessThanOrEqual(20);
		expect(payload.formats.every((item) => item.details === undefined)).toBe(
			true,
		);
		const detailed = await client.callTool({
			name: "list_formats",
			arguments: { formatId: "xp3", detail: "full" },
		});
		expect(detailed.structuredContent).toMatchObject({
			formats: [
				{
					details: {
						attribution: expect.any(Array),
						support: { reference: { tag: "XP3" } },
					},
				},
			],
		});
	});

	it("resumes catalog and scan pages without losing budget-truncated items", async () => {
		const { client, root } = await connect();
		const first = await client.callTool({
			name: "list_formats",
			arguments: { limit: 1000, maxResponseBytes: 2048 },
		});
		expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(2048);
		const page = first.structuredContent as {
			nextOffset: number;
			responseTruncated: boolean;
			formats: { id: string }[];
		};
		expect(page.responseTruncated).toBe(true);
		expect(page.nextOffset).toBe(page.formats.length);
		const second = await client.callTool({
			name: "list_formats",
			arguments: { offset: page.nextOffset, maxResponseBytes: 2048 },
		});
		const next = second.structuredContent as typeof page;
		expect(next.formats[0]?.id).not.toBe(page.formats[0]?.id);

		const names = [
			"A.xp3",
			"a.xp3",
			"Z.xp3",
			"z.xp3",
			"あ.xp3",
			"画像.xp3",
			"b.xp3",
			"c.xp3",
		];
		const archiveBytes = await readFile(resolve(root, "basic.xp3"));
		await Promise.all(
			names.map((name) => writeFile(resolve(root, name), archiveBytes)),
		);
		const createdNames = await readdir(root);
		const seen: string[] = [];
		let cursor: string | null = null;
		for (let iteration = 0; iteration < 20; iteration += 1) {
			const result = await client.callTool({
				name: "scan_resources",
				arguments: {
					rootId: "games",
					limit: 500,
					maxResponseBytes: 2048,
					...(cursor ? { cursor } : {}),
				},
			});
			expect(result.isError).not.toBe(true);
			expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
				2048,
			);
			const response = result.structuredContent as {
				archives: { source: { path: string } }[];
				nextCursor: string | null;
				complete: boolean;
			};
			seen.push(...response.archives.map((item) => item.source.path));
			cursor = response.nextCursor;
			if (response.complete) break;
		}
		expect(cursor).toBeNull();
		expect(seen).toEqual(createdNames.sort());
	});

	it("keeps large extraction results in a complete hashed report", async () => {
		const { client } = await connect();
		const result = await client.callTool({
			name: "extract_entries",
			arguments: {
				source: { rootId: "games", path: "basic.xp3" },
				selection: {
					mode: "ids",
					entryIds: [
						"0",
						...Array.from({ length: 300 }, (_, i) => `missing-${i}`),
					],
				},
			},
		});
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
			16384,
		);
		const response = result.structuredContent as {
			items: unknown[];
			itemsOmitted: number;
			report: {
				absolutePath: string;
				relativePath: string;
				sha256: string;
				bytesWritten: string;
			};
		};
		expect(response.items).toHaveLength(10);
		expect(response.itemsOmitted).toBe(291);
		const bytes = await readFile(response.report.absolutePath);
		expect(bytes.length.toString()).toBe(response.report.bytesWritten);
		expect(createHash("sha256").update(bytes).digest("hex")).toBe(
			response.report.sha256,
		);
		expect(JSON.parse(bytes.toString()).items).toHaveLength(301);
		const collected: unknown[] = [];
		let offset: number | null = 0;
		while (offset !== null) {
			const page = await client.callTool({
				name: "extract_entries",
				arguments: {
					reportPath: response.report.relativePath,
					inline: "all",
					offset,
					itemLimit: 40,
					maxResponseBytes: 2048,
				},
			});
			expect(page.isError).not.toBe(true);
			expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(2048);
			const payload = page.structuredContent as {
				items: unknown[];
				nextOffset: number | null;
			};
			const serialized = JSON.stringify(payload);
			expect(page.content).toEqual([
				{
					type: "text",
					text:
						Buffer.byteLength(serialized) <= 1024
							? serialized
							: JSON.stringify({
									notice: "Full result is available in structuredContent.",
								}),
				},
			]);
			collected.push(...payload.items);
			if (payload.nextOffset !== null)
				expect(payload.nextOffset).toBeGreaterThan(offset);
			offset = payload.nextOffset;
		}
		expect(collected).toEqual(JSON.parse(bytes.toString()).items);
		expect(await readFile(response.report.absolutePath)).toEqual(bytes);
		const invalid = await client.callTool({
			name: "extract_entries",
			arguments: {
				source: { rootId: "games", path: "basic.xp3" },
				reportPath: response.report.relativePath,
			},
		});
		expect(invalid.structuredContent).toMatchObject({
			error: { code: "INVALID_ARGUMENT" },
		});
	});

	it("reports report-file errors without losing completed extraction counts", async () => {
		const { client, output, root } = await connect();
		await symlink(root, resolve(output, ".garbro-reports"));
		const result = await client.callTool({
			name: "extract_entries",
			arguments: { source: { rootId: "games", path: "basic.xp3" } },
		});
		expect(result.structuredContent).toMatchObject({
			status: "completed",
			hasFailures: false,
			extracted: 3,
			reportError: { code: "UNSAFE_PATH" },
		});
	});

	it("omits metadata by default and enforces response budgets", async () => {
		const bytes = Buffer.alloc(65536, 0);
		const entry: ArchiveEntry = {
			id: "0",
			path: "large.bin",
			size: BigInt(bytes.length),
			packedSize: BigInt(bytes.length),
			compressed: false,
			encrypted: false,
			metadata: { large: "x".repeat(100000) },
		};
		const registry = new FormatRegistry([
			{
				descriptor: {
					id: "xp3",
					name: "Test",
					extensions: ["xp3"],
					attribution: [],
					capabilities: {
						detect: true,
						list: true,
						extract: true,
						create: false,
						encryption: false,
					},
				},
				async detect() {
					return true;
				},
				async open(source, sourcePath) {
					return {
						sourcePath,
						format: this.descriptor,
						size: source.size,
						metadata: entry.metadata ?? {},
						entries: [entry],
						async openEntry() {
							return Readable.from([bytes]);
						},
						async close() {
							await source.close();
						},
					};
				},
			},
		]);
		const { client } = await connect({ registry });
		const source = { rootId: "games", path: "basic.xp3" };
		const entries = await client.callTool({
			name: "list_entries",
			arguments: { source },
		});
		expect(entries.structuredContent).toMatchObject({ entries: [{ id: "0" }] });
		expect(JSON.stringify(entries)).not.toContain('"metadata"');
		const full = await client.callTool({
			name: "list_entries",
			arguments: { source, detail: "full", maxResponseBytes: 2048 },
		});
		expect(full.structuredContent).toMatchObject({
			error: { code: "LIMIT_EXCEEDED" },
		});
	});
});
