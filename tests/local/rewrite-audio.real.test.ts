import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { buildServer } from "@garbro-mcp/mcp/server";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

interface AudioExpectation {
	compression: number;
	channels: number;
	sampleRate: number;
	bitsPerSample: number;
	decodedBytes: number;
	durationSeconds: number;
}

interface PrivateSample {
	path: string;
	size: number;
	sha256: string;
	expectedFormatId: string | null;
	audio?: AudioExpectation;
	extraction?: { bytesWritten: number; sha256: string; codec: string };
}

interface PrivateManifest {
	schemaVersion: 1;
	gameRoot: string;
	expectedNwaCount: number;
	samples: PrivateSample[];
}

const run = promisify(execFile);
const manifestPath = resolve("fixtures/private/rewrite-audio.json");
const manifest = existsSync(manifestPath)
	? (JSON.parse(readFileSync(manifestPath, "utf8")) as PrivateManifest)
	: undefined;
const corpusAvailable =
	manifest !== undefined && existsSync(resolve(manifest.gameRoot));
const ffmpegAvailable = ["ffprobe", "ffmpeg"].every(
	(command) =>
		spawnSync(command, ["-version"], { stdio: "ignore" }).status === 0,
);

async function sha256(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

async function withClient<T>(
	runWithClient: (client: Client, output: string) => Promise<T>,
): Promise<T> {
	if (!manifest) throw new Error("private manifest is unavailable");
	const output = await mkdtemp(resolve(tmpdir(), "garbro-rewrite-private-"));
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const server = buildServer({
		inputRoots: { rewrite: manifest.gameRoot },
		outputRoot: output,
	});
	const client = new Client({ name: "rewrite-private-test", version: "0" });
	try {
		await server.connect(serverTransport);
		await client.connect(clientTransport);
		return await runWithClient(client, output);
	} finally {
		await client.close();
		await server.close();
		await rm(output, { recursive: true, force: true });
	}
}

async function extractSample(client: Client, sample: PrivateSample) {
	if (!sample.extraction) {
		throw new Error(`no extraction expectation for ${sample.path}`);
	}
	const budgets = {
		maxResources: 1,
		maxInputBytes: sample.size.toString(),
		maxOutputBytes: sample.extraction.bytesWritten.toString(),
		...(sample.audio === undefined
			? {}
			: { maxDecodedBytesPerResource: sample.audio.decodedBytes.toString() }),
	};
	const planned = await client.callTool({
		name: "plan_extraction",
		arguments: {
			source: { rootId: "rewrite", path: sample.path },
			budgets,
			inline: "all",
		},
	});
	expect(planned.isError).not.toBe(true);
	const plan = planned.structuredContent as {
		selected: number;
		ready: number;
		budgetViolations: unknown[];
		budgetUnknowns: unknown[];
		planDigest: string;
	};
	expect(plan).toMatchObject({
		selected: 1,
		ready: 1,
		budgetViolations: [],
		budgetUnknowns: [],
	});
	const response = await client.callTool({
		name: "extract_entries",
		arguments: {
			source: { rootId: "rewrite", path: sample.path },
			expectedPlanDigest: plan.planDigest,
			budgets,
			inline: "all",
		},
	});
	expect(response.isError).not.toBe(true);
	const payload = response.structuredContent as {
		status: string;
		hasFailures: boolean;
		items: Array<{
			status: string;
			artifact?: {
				outputRootId: string;
				relativePath: string;
				absolutePath: string;
				bytesWritten: string;
				sha256: string;
			};
		}>;
	};
	expect(payload).toMatchObject({
		status: "completed",
		hasFailures: false,
	});
	const artifact = payload.items[0]?.artifact;
	if (!artifact) throw new Error(`no extracted artifact for ${sample.path}`);
	const verified = await client.callTool({
		name: "verify_artifacts",
		arguments: {
			artifacts: [
				{
					outputRootId: artifact.outputRootId,
					path: artifact.relativePath,
					expected: {
						sha256: sample.extraction.sha256,
						bytes: sample.extraction.bytesWritten.toString(),
					},
				},
			],
		},
	});
	expect(verified.isError).not.toBe(true);
	expect(verified.structuredContent).toMatchObject({
		status: "completed",
		verified: 1,
		mismatched: 0,
		invalid: 0,
		results: [
			{
				status: "verified",
				level: "manifest",
				matched: true,
				format: sample.extraction.codec === "vorbis" ? "ogg" : "wav",
				structuralValid: true,
			},
		],
	});
	return artifact;
}

describe.skipIf(!corpusAvailable)("Rewrite private audio validation", () => {
	it("keeps corpus hashes stable and rejects known collisions", async () => {
		if (!manifest) throw new Error("private manifest is unavailable");
		await withClient(async (client) => {
			for (const sample of manifest.samples) {
				const source = resolve(manifest.gameRoot, ...sample.path.split("/"));
				expect((await stat(source)).size).toBe(sample.size);
				expect(await sha256(source)).toBe(sample.sha256);
				const inspected = await client.callTool({
					name: "inspect_archive",
					arguments: {
						source: { rootId: "rewrite", path: sample.path },
						detail: "full",
					},
				});
				const payload = inspected.structuredContent as Record<string, unknown>;
				if (sample.expectedFormatId === null) {
					expect(payload).toMatchObject({ recognized: false });
					continue;
				}
				expect(payload).toMatchObject({
					recognized: true,
					format: { id: sample.expectedFormatId },
					validation: "structural",
					...(sample.audio === undefined ? {} : { metadata: sample.audio }),
				});
			}
		});
	}, 120_000);

	it("recognizes every NWA and reproduces pinned artifacts", async () => {
		if (!manifest) throw new Error("private manifest is unavailable");
		await withClient(async (client) => {
			const seen = new Set<string>();
			let cursor: string | undefined;
			for (;;) {
				const response = await client.callTool({
					name: "scan_resources",
					arguments: {
						rootId: "rewrite",
						includeGlobs: ["**/*.nwa"],
						formatIds: ["reallive-nwa-audio"],
						limit: 500,
						maxResponseBytes: 65536,
						...(cursor === undefined ? {} : { cursor }),
					},
				});
				expect(response.isError).not.toBe(true);
				const page = response.structuredContent as {
					archives: Array<{ source: { path: string } }>;
					nextCursor: string | null;
					complete: boolean;
				};
				for (const item of page.archives) seen.add(item.source.path);
				if (page.complete) break;
				if (!page.nextCursor) throw new Error("incomplete scan has no cursor");
				cursor = page.nextCursor;
			}
			expect(seen.size).toBe(manifest.expectedNwaCount);

			for (const sample of manifest.samples.filter(
				(candidate) => candidate.extraction !== undefined,
			)) {
				const before = await sha256(
					resolve(manifest.gameRoot, ...sample.path.split("/")),
				);
				const artifact = await extractSample(client, sample);
				expect(artifact).toMatchObject({
					bytesWritten: sample.extraction?.bytesWritten.toString(),
					sha256: sample.extraction?.sha256,
				});
				expect(await sha256(artifact.absolutePath)).toBe(
					sample.extraction?.sha256,
				);
				expect(
					await sha256(resolve(manifest.gameRoot, ...sample.path.split("/"))),
				).toBe(before);
			}
		});
	}, 120_000);

	it.skipIf(!ffmpegAvailable)(
		"passes independent FFprobe metadata and FFmpeg decoding",
		async () => {
			if (!manifest) throw new Error("private manifest is unavailable");
			await withClient(async (client) => {
				for (const sample of manifest.samples.filter(
					(candidate) => candidate.extraction !== undefined,
				)) {
					const artifact = await extractSample(client, sample);
					const { stdout } = await run("ffprobe", [
						"-v",
						"error",
						"-select_streams",
						"a:0",
						"-show_entries",
						"stream=codec_name,sample_rate,channels,bits_per_sample,duration",
						"-of",
						"json",
						artifact.absolutePath,
					]);
					const stream = JSON.parse(stdout).streams?.[0];
					expect(stream?.codec_name).toBe(sample.extraction?.codec);
					if (sample.audio) {
						expect(Number(stream.sample_rate)).toBe(sample.audio.sampleRate);
						expect(stream.channels).toBe(sample.audio.channels);
						expect(stream.bits_per_sample).toBe(sample.audio.bitsPerSample);
						expect(Number(stream.duration)).toBeCloseTo(
							sample.audio.durationSeconds,
							5,
						);
					}
					await run("ffmpeg", [
						"-v",
						"error",
						"-xerror",
						"-i",
						artifact.absolutePath,
						"-f",
						"null",
						"-",
					]);
				}
			});
		},
		120_000,
	);
});
