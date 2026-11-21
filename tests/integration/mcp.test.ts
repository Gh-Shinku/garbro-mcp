import {
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { BuildServerOptions } from "@garbro-mcp/mcp/server";
import { buildServer } from "@garbro-mcp/mcp/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
		tempDirectory: output,
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
			waitMs: 0,
			...(idempotencyKey === undefined ? {} : { idempotencyKey }),
		},
	});
	const taskId = structured(response).taskId;
	if (typeof taskId !== "string") throw new Error("Expected a task ID");
	return taskId;
}

async function waitForTask(client: Client, taskId: string) {
	const response = await client.callTool({
		name: "get_task",
		arguments: { taskId, waitUntil: "terminal", timeoutMs: 30_000 },
	});
	return structured(response);
}

describe("MCP task server", () => {
	it("exposes only the task control tools and publishes metadata as resources", async () => {
		const { client, output } = await connect();
		const tools = await client.listTools();
		expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
			"cancel_task",
			"get_task",
			"submit_task",
		]);
		expect(
			tools.tools.find((tool) => tool.name === "submit_task")?.description,
		).toContain("cursors");
		expect(
			tools.tools.find((tool) => tool.name === "submit_task")?.description,
		).toContain("0–5000");

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
			temporaryWorkspace: { path: output },
			capabilities: {
				taskTypes: ["scan", "search", "inspect", "extract"],
				mandatoryExtractionVerification: true,
				dynamicAbsolutePaths: true,
				temporaryExtraction: true,
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
			"Extraction writes only to an isolated expiring task directory",
		);
		expect(client.getInstructions()).toContain(
			"Prefer this tool over local GARBro executables, libraries, or custom extraction scripts",
		);
		expect(client.getInstructions()).toContain(
			"Never call sleep or guess a polling interval",
		);
	});

	it("runs scan and entry inspection through the same asynchronous interface", async () => {
		const { client, root } = await connect();
		const scanId = await submit(client, {
			type: "scan",
			path: root,
			resourceTypes: ["archive"],
		});
		const scan = await waitForTask(client, scanId);
		expect(scan).toMatchObject({
			type: "scan",
			state: "completed",
			result: {
				archives: [
					{
						source: { path: resolve(root, "basic.xp3") },
						formatId: "xp3",
					},
				],
			},
		});

		const inspectId = await submit(client, {
			type: "inspect",
			source: { path: resolve(root, "basic.xp3") },
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

	it("reads a saved scan window after its source directory changes", async () => {
		const { client, root } = await connect();
		const path = resolve(root, "basic.xp3");
		for (let i = 0; i < 9; i++)
			await copyFile(path, resolve(root, `資源-${i}.xp3`));
		await writeFile(resolve(root, "a.dat"), "unknown");
		const taskId = await submit(client, {
			type: "scan",
			path: root,
			limit: 10,
			includeUnrecognized: true,
			maxResponseBytes: 3072,
		});
		const read = (options: Record<string, unknown>) =>
			client.callTool({ name: "get_task", arguments: { taskId, ...options } });
		const full = structured(await read({ maxResponseBytes: 65536 })).result as {
			archives: unknown[];
		};
		await writeFile(path, "changed");
		let cursor: string | null = null;
		const archives: unknown[] = [],
			unknown: unknown[] = [];
		do {
			const r = await read(cursor ? { resultCursor: cursor } : {});
			expect(r.content).toEqual([
				{ type: "text", text: JSON.stringify(r.structuredContent) },
			]);
			expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(3072);
			const p = structured(r).result as {
				resultCursor: string | null;
				archives: unknown[];
				unrecognized: unknown[];
			};
			expect(p).toMatchObject({
				scanned: 10,
				archiveCount: 9,
				recognizedCount: 9,
				unrecognizedCount: 1,
				nextCursor: expect.any(String),
			});
			if (!cursor) {
				expect(p.archives.length).toBeGreaterThan(0);
				expect(p.resultCursor).toBeTruthy();
			}
			archives.push(...p.archives);
			unknown.push(...p.unrecognized);
			cursor = p.resultCursor;
		} while (cursor);
		expect(archives).toEqual(full.archives);
		expect(unknown).toHaveLength(1);
		const { diagnosis } = unknown[0] as {
			diagnosis: {
				candidateFormatIds: string[];
				candidateFormatIdCount: number;
			};
		};
		expect(diagnosis.candidateFormatIds).toHaveLength(8);
		expect(diagnosis.candidateFormatIdCount).toBeGreaterThan(8);
	});

	it("searches the full archive index by literal, glob or regex with optional types", async () => {
		const { client, root } = await connect();
		async function search(filters: Record<string, unknown>) {
			return waitForTask(
				client,
				await submit(client, {
					type: "search",
					path: root,
					samplesPerArchive: 1,
					...filters,
				}),
			);
		}
		for (const entryPath of [
			{ mode: "literal", pattern: "SCRIPTS\\START" },
			{ mode: "glob", pattern: "**/*.TJS" },
			{ mode: "regex", pattern: "(^|/)start(up|menu)[.]tjs$" },
		]) {
			expect(await search({ entryPath })).toMatchObject({
				state: "completed",
				result: {
					archives: [
						{
							matchedTotal: 1,
							entries: [
								{
									path: "scripts/startup.tjs",
									extractSource: {
										selection: { mode: "ids", entryIds: ["1"] },
									},
								},
							],
						},
					],
				},
			});
		}
		for (const filters of [
			{ entryPath: { mode: "literal", pattern: "START", caseSensitive: true } },
			{ entryPath: { mode: "glob", pattern: "**/*.TJS", caseSensitive: true } },
			{
				entryPath: { mode: "regex", pattern: "startup" },
				resourceTypes: ["audio"],
			},
		])
			expect(await search(filters)).toMatchObject({
				state: "completed",
				result: { archives: [] },
			});
		for (const filters of [{}, { entryPath: { mode: "regex", pattern: "(" } }])
			expect(await search(filters)).toMatchObject({
				state: "failed",
				error: { code: "INVALID_ARGUMENT" },
			});
	});

	it("pages saved samples within the wire budget independently of the directory cursor", async () => {
		const { client, root } = await connect();
		const fixture = await readFile(resolve(root, "basic.xp3"));
		const paths: string[] = [];
		for (let i = 0; i < 12; i++) {
			const path = resolve(root, `日本語-${i}.xp3`);
			await writeFile(path, Buffer.concat([fixture, Buffer.from([i])]));
			paths.push(path);
		}
		const search = {
			type: "search",
			path: root,
			resourceTypes: ["script"],
			limit: 10,
			samplesPerArchive: 2,
			maxResponseBytes: 3072,
		};
		const response = await client.callTool({
			name: "submit_task",
			arguments: { task: search, waitMs: 5000 },
		});
		const taskId = structured(response).taskId as string;
		function page(r: typeof response) {
			expect(r.content).toEqual([
				{ type: "text", text: JSON.stringify(r.structuredContent) },
			]);
			expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(3072);
			return structured(r).result as {
				resultCursor: string | null;
				nextCursor: string;
				archives: Array<{
					entries: Array<{
						id: string;
						extractSource: { source: { path: string } };
					}>;
				}>;
			};
		}
		const first = page(response);
		expect(first).toMatchObject({
			archiveCount: 10,
			matchedTotal: 20,
			sampleCount: 20,
			complete: false,
		});
		expect(
			first.archives[0]?.entries[0]?.extractSource.source.path,
		).toBeTruthy();
		const cursor = first.resultCursor;
		if (!cursor) throw new Error("Expected a saved-result cursor");
		expect(first.nextCursor).toBeTruthy();
		async function read(id: string, cursor: string, limit = 1) {
			return client.callTool({
				name: "get_task",
				arguments: { taskId: id, resultCursor: cursor, limit },
			});
		}
		const secondTask = await submit(client, search);
		await waitForTask(client, secondTask);
		expect(structured(await read(secondTask, cursor))).toMatchObject({
			error: { code: "INVALID_ARGUMENT" },
		});
		expect(structured(await read(taskId, first.nextCursor))).toMatchObject({
			error: { code: "INVALID_ARGUMENT" },
		});
		const badDirectoryCursor = await submit(client, {
			...search,
			cursor: first.resultCursor,
		});
		expect(await waitForTask(client, badDirectoryCursor)).toMatchObject({
			state: "failed",
			error: { code: "INVALID_ARGUMENT" },
		});
		// A saved page must survive changes to the scanned directory.
		for (const path of paths) await writeFile(path, "changed");
		expect(page(await read(taskId, cursor))).toEqual(
			page(await read(taskId, cursor)),
		);
		const seen = new Set<string>();
		let current = first;
		for (;;) {
			for (const archive of current.archives)
				for (const entry of archive.entries) {
					const key = JSON.stringify([
						entry.extractSource.source.path,
						entry.id,
					]);
					expect(seen.has(key)).toBe(false);
					seen.add(key);
				}
			if (!current.resultCursor) break;
			current = page(await read(taskId, current.resultCursor));
			expect(current.archives.flatMap((a) => a.entries)).toHaveLength(1);
			expect(current.nextCursor).toBe(first.nextCursor);
		}
		expect(seen.size).toBe(20);
	});

	it("pages through files and extracts an entry directly from search results", async () => {
		const { client, root } = await connect();
		await writeFile(resolve(root, "00.bin"), "unrecognized");
		await mkdir(resolve(root, "sys"));
		const nested = resolve(root, "sys", "resources");
		await copyFile(resolve(root, "basic.xp3"), nested);
		const distinct = await readFile(nested);
		const payload = distinct.indexOf("hello xp3");
		expect(payload).toBeGreaterThan(0);
		distinct[payload] = 0x48;
		await writeFile(resolve(root, "basic.xp3"), distinct);
		await writeFile(resolve(root, "sys", "backup.xp3"), distinct);
		const search = {
			type: "search",
			path: root,
			resourceTypes: ["script"],
			limit: 1,
		};
		const page = async (options: Record<string, unknown> = {}) => {
			const task = await waitForTask(
				client,
				await submit(client, { ...search, ...options }),
			);
			expect(task.state).toBe("completed");
			return task.result as {
				nextCursor: string | null;
				archives: Array<{ entries: Array<{ extractSource: unknown }> }>;
			};
		};
		const first = await page();
		expect(first).toMatchObject({
			scanned: 1,
			archives: [],
			nextCursor: expect.any(String),
			complete: false,
		});
		const second = await page({ cursor: first.nextCursor });
		expect(second).toMatchObject({
			archives: [{ source: { path: resolve(root, "basic.xp3") } }],
			nextCursor: expect.any(String),
		});
		const backup = await page({ cursor: second.nextCursor });
		expect(backup).toMatchObject({
			archives: [],
			complete: false,
			nextCursor: expect.any(String),
		});
		const last = await page({ cursor: backup.nextCursor });
		expect(last).toMatchObject({
			complete: true,
			nextCursor: null,
			archives: [
				{
					source: { path: nested },
					formatId: "xp3",
					matchedTotal: 2,
					entries: [{ path: "hello.txt", resourceType: "script" }],
				},
			],
		});
		const extracted = await waitForTask(
			client,
			await submit(client, {
				type: "extract",
				sources: [last.archives[0]?.entries[0]?.extractSource],
			}),
		);
		expect(extracted).toMatchObject({
			state: "completed",
			result: {
				extracted: 1,
				sources: [{ source: { path: nested }, verification: { verified: 1 } }],
			},
		});
		expect(await page({ resourceTypes: ["audio"], limit: 10 })).toMatchObject({
			archives: [],
			complete: true,
		});
		expect((await page({ limit: 10 })).archives).toHaveLength(2);
	});

	it("browses filtered groups beyond the flat entry page and extracts a returned sample", async () => {
		const { client, root } = await connect();
		const task = {
			type: "inspect",
			source: { path: resolve(root, "basic.xp3") },
			resourceTypes: ["script"],
			limit: 1,
		};
		const first = await waitForTask(client, await submit(client, task));
		const { entries } = first.result as {
			entries: { overview: { groups: Array<{ browse: unknown }> } };
		};
		expect(entries).toMatchObject({
			matchedTotal: 2,
			nextOffset: 1,
			overview: {
				groups: [
					{ browse: { by: "directory", key: "" }, count: 1 },
					{ browse: { by: "directory", key: "scripts" }, count: 1 },
				],
				samples: [{ id: "0" }, { id: "1" }],
			},
		});
		const selected = await waitForTask(
			client,
			await submit(client, {
				...task,
				browse: entries.overview.groups[1]?.browse,
			}),
		);
		const group = selected.result as {
			entries: { overview: { samples: Array<{ extractSource: unknown }> } };
		};
		expect(group.entries).toMatchObject({
			matchedTotal: 1,
			entries: [{ path: "scripts/startup.tjs" }],
		});
		const extracted = await waitForTask(
			client,
			await submit(client, {
				type: "extract",
				sources: [group.entries.overview.samples[0]?.extractSource],
			}),
		);
		expect(extracted).toMatchObject({
			state: "completed",
			result: { extracted: 1, sources: [{ verification: { verified: 1 } }] },
		});
	});

	it("reads the saved inspect window without reopening the archive or advancing its offsets", async () => {
		const { client, root } = await connect();
		const path = resolve(root, "basic.xp3");
		const response = await client.callTool({
			name: "submit_task",
			arguments: {
				task: {
					type: "inspect",
					source: { path },
					limit: 2,
					browse: { by: "directory" },
					includeMetadata: true,
					maxResponseBytes: 3072,
				},
				waitMs: 5000,
			},
		});
		const taskId = structured(response).taskId;
		function page(r: typeof response, budget: number) {
			expect(r.content).toEqual([
				{ type: "text", text: JSON.stringify(r.structuredContent) },
			]);
			expect(Buffer.byteLength(JSON.stringify(r))).toBeLessThanOrEqual(budget);
			return structured(r).result as {
				resultCursor: string | null;
				metadata: Record<string, unknown>;
				entries: {
					nextOffset: number;
					entries: unknown[];
					overview: {
						samples: { extractSource: unknown }[];
						groups: unknown[];
						nextGroupOffset: number | null;
					};
				};
			};
		}
		const first = page(response, 3072);
		const sample = first.entries.overview.samples[0];
		if (!sample || !first.resultCursor)
			throw new Error("Expected an extractable first page and a saved cursor");
		const extracted = await waitForTask(
			client,
			await submit(client, {
				type: "extract",
				sources: [sample.extractSource],
			}),
		);
		expect(extracted).toMatchObject({
			state: "completed",
			result: { samples: [{ verificationStatus: "verified" }] },
		});
		await writeFile(path, "source changed after inspection");
		const read = (options: Record<string, unknown>) =>
			client.callTool({ name: "get_task", arguments: { taskId, ...options } });
		const full = page(await read({ maxResponseBytes: 65536 }), 65536);
		expect(full.resultCursor).toBeNull();
		expect(full.entries.nextOffset).toBe(2);
		const pages = [first];
		let cursor: string | null = first.resultCursor;
		const visited = new Set<string>();
		while (cursor) {
			expect(visited.has(cursor)).toBe(false);
			visited.add(cursor);
			const next = page(await read({ resultCursor: cursor, limit: 1 }), 3072);
			expect(next.entries.nextOffset).toBe(2);
			expect(next.entries.overview.nextGroupOffset).toBe(
				full.entries.overview.nextGroupOffset,
			);
			pages.push(next);
			cursor = next.resultCursor;
		}
		expect(pages.flatMap((p) => p.entries.entries)).toEqual(
			full.entries.entries,
		);
		expect(pages.flatMap((p) => p.entries.overview.groups)).toEqual(
			full.entries.overview.groups,
		);
		expect(pages.flatMap((p) => p.entries.overview.samples)).toEqual(
			full.entries.overview.samples,
		);
		expect(Object.assign({}, ...pages.map((p) => p.metadata))).toEqual(
			full.metadata,
		);
	});

	it("keeps unrecognized inspect diagnoses and paginates their candidate readers", async () => {
		const { client, root } = await connect();
		const path = resolve(root, "unknown.dat");
		await writeFile(path, "unrecognized data");
		const taskId = await submit(client, { type: "inspect", source: { path } });
		const read = (options: Record<string, unknown>) =>
			client.callTool({ name: "get_task", arguments: { taskId, ...options } });
		const snapshot = structured(await read({ maxResponseBytes: 65536 }));
		expect(snapshot).toMatchObject({
			state: "failed",
			result: { recognized: false, resultCursor: null },
		});
		const expected = (
			snapshot.result as { diagnosis: { candidateFormatIds: string[] } }
		).diagnosis.candidateFormatIds;
		expect(expected.length).toBeGreaterThan(1);
		const response = await read({ limit: 1 });
		expect(response.content).toEqual([
			{ type: "text", text: JSON.stringify(response.structuredContent) },
		]);
		const page = structured(response).result as {
			resultCursor: string;
			diagnosis: { candidateFormatIds: string[] };
		};
		expect(page.diagnosis.candidateFormatIds).toEqual(expected.slice(0, 1));
		expect(
			structured(
				await read({
					resultCursor: page.resultCursor,
					maxResponseBytes: 65536,
				}),
			),
		).toMatchObject({
			result: {
				resultCursor: null,
				diagnosis: { candidateFormatIds: expected.slice(1) },
			},
		});
	});

	it("completes fast work during the submission window", async () => {
		const { client, root } = await connect();
		const response = await client.callTool({
			name: "submit_task",
			arguments: {
				task: { type: "scan", path: root, resourceTypes: ["archive"] },
				waitMs: 5_000,
			},
		});
		expect(structured(response)).toMatchObject({
			state: "completed",
			waitOutcome: "terminal",
			revision: expect.any(Number),
			result: { archives: [{ formatId: "xp3" }] },
		});
	});

	it("preflights, extracts, verifies, and reports artifacts inside one task", async () => {
		const { client, root, output } = await connect();
		const taskId = await submit(client, {
			type: "extract",
			sources: [
				{
					source: { path: resolve(root, "basic.xp3") },
					selection: { mode: "ids", entryIds: ["0", "1"] },
				},
			],
		});
		const task = await waitForTask(client, taskId);
		expect(task).toMatchObject({
			type: "extract",
			state: "completed",
			result: {
				status: "completed",
				hasFailures: false,
				temporary: true,
				artifactDirectory: resolve(output, taskId, "artifacts"),
				expiresAt: expect.any(String),
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
			stat(resolve(output, taskId, "artifacts/0001/hello.txt")),
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

	it("shows bounded artifact details in text on submission and subsequent task reads", async () => {
		const { client, root, output } = await connect();
		const source = { source: { path: resolve(root, "basic.xp3") } };
		const response = await client.callTool({
			name: "submit_task",
			arguments: {
				task: { type: "extract", sources: [source, source] },
				waitMs: 5000,
			},
		});
		const { taskId, result } = structured(response);
		expect(structured(response)).toMatchObject({
			state: "completed",
			result: { extracted: 6 },
		});
		const { samples, expiresAt } = result as {
			samples: Array<{
				absolutePath: string;
				bytesWritten: string;
				verificationStatus: string;
			}>;
			expiresAt: string;
		};
		expect(samples).toHaveLength(3);
		expect(samples[0]).toMatchObject({
			absolutePath: resolve(output, String(taskId), "artifacts/0001/hello.txt"),
			bytesWritten: "10",
			verificationStatus: "verified",
		});
		expect(
			Buffer.byteLength(JSON.stringify(response.structuredContent)),
		).toBeGreaterThan(1024);
		const text = response.content[0];
		if (text?.type !== "text")
			throw new Error("Expected a plain-text extraction summary");
		expect(text.text).toContain("Showing 3 of 6 files");
		expect(text.text).toContain(expiresAt);
		for (const sample of samples) {
			expect(text.text).toContain(sample.absolutePath);
			expect(text.text).toContain(
				`${sample.bytesWritten} bytes | verification: ${sample.verificationStatus}`,
			);
		}
		const read = await client.callTool({
			name: "get_task",
			arguments: { taskId },
		});
		expect(read.content).toEqual(response.content);
		expect(structured(read).result).toEqual(result);
	});

	it("extracts and verifies an XP3 under an aliased OS temp directory", async () => {
		const parent = await mkdtemp(resolve(tmpdir(), "garbro-temp-alias-"));
		const alias = resolve(parent, "alias");
		try {
			const target = await mkdtemp(resolve(parent, "physical-"));
			await symlink(target, alias, "junction");
			for (const name of ["TMPDIR", "TEMP", "TMP"]) vi.stubEnv(name, alias);
			const { client, root, output } = await connect();
			const id = await submit(client, {
				type: "extract",
				sources: [{ source: { path: resolve(root, "basic.xp3") } }],
			});
			const task = await waitForTask(client, id);
			expect(task).toMatchObject({
				state: "completed",
				result: { extracted: 3, sources: [{ verification: { verified: 3 } }] },
			});
			expect(
				await readFile(resolve(output, id, "artifacts/0001/hello.txt"), "utf8"),
			).toBe("hello xp3\n");
		} finally {
			vi.unstubAllEnvs();
			await rm(parent, { recursive: true, force: true });
		}
	});

	it("deduplicates retried submissions by idempotency key", async () => {
		const { client, root } = await connect();
		const task = { type: "scan", path: root };
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
			source: { path: resolve(root, "voice.cpz") },
		});
		await expect(waitForTask(client, taskId)).resolves.toMatchObject({
			state: "failed",
			result: {
				recognized: false,
				diagnosis: {
					kind: "registered-extension-no-match",
					extension: "cpz",
					candidateFormatIds: ["cmvs-cpz1", "cmvs-cpz2", "cmvs-cpz-archive"],
				},
			},
		});
	});

	it.each(["scan", "search"])(
		"groups detection issues per %s page alongside successful matches",
		async (type) => {
			const { client, root } = await connect();
			await writeFile(resolve(root, "bg.paz"), "unknown");
			await writeFile(resolve(root, "voice.paz"), "unknown");
			const id = await submit(client, {
				type,
				path: root,
				...(type === "search" ? { resourceTypes: ["script"] } : {}),
			});
			const response = await client.callTool({
				name: "get_task",
				arguments: { taskId: id },
			});
			expect(structured(response)).toMatchObject({
				state: "completed",
				result: {
					archives: [{ formatId: "xp3" }],
					diagnostics: [
						{
							kind: "no-registered-format",
							stage: "detection",
							extension: "paz",
							count: 2,
							nextAction: expect.any(String),
							exampleSource: { path: resolve(root, "bg.paz") },
						},
					],
				},
			});
			expect(response.content).toEqual([
				{ type: "text", text: JSON.stringify(response.structuredContent) },
			]);
		},
	);
});
