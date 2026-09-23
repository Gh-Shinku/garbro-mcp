import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
	type BatchExtractionResult,
	verifyArtifact,
	verifyExtractionResult,
	WorkspacePolicy,
} from "@garbro-mcp/core";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

function pcmWave(): Buffer {
	const data = Buffer.from([0, 0, 1, 0]);
	const wave = Buffer.alloc(44 + data.length);
	wave.write("RIFF", 0, "ascii");
	wave.writeUInt32LE(wave.length - 8, 4);
	wave.write("WAVEfmt ", 8, "ascii");
	wave.writeUInt32LE(16, 16);
	wave.writeUInt16LE(1, 20);
	wave.writeUInt16LE(1, 22);
	wave.writeUInt32LE(8000, 24);
	wave.writeUInt32LE(16000, 28);
	wave.writeUInt16LE(2, 32);
	wave.writeUInt16LE(16, 34);
	wave.write("data", 36, "ascii");
	wave.writeUInt32LE(data.length, 40);
	data.copy(wave, 44);
	return wave;
}

describe("artifact verification", () => {
	it("hashes and structurally validates WAV artifacts inside an output root", async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "garbro-verify-test-"));
		temporaryDirectories.push(directory);
		const input = resolve(directory, "input");
		const output = resolve(directory, "output");
		await mkdir(input);
		await mkdir(output);
		const wave = pcmWave();
		await writeFile(resolve(output, "track.wav"), wave);
		const workspace = new WorkspacePolicy({
			inputRoots: { games: input },
			outputRoot: output,
		});
		const sha256 = createHash("sha256").update(wave).digest("hex");

		await expect(
			verifyArtifact(
				workspace,
				{ path: "track.wav" },
				{ sha256, bytes: BigInt(wave.length) },
			),
		).resolves.toMatchObject({
			status: "verified",
			level: "manifest",
			matched: true,
			format: "wav",
			structuralValid: true,
			metadata: {
				channels: 1,
				sampleRate: 8000,
				bitsPerSample: 16,
				dataBytes: 4,
			},
		});
		await expect(
			verifyArtifact(
				workspace,
				{ path: "track.wav" },
				{ sha256: "0".repeat(64) },
			),
		).resolves.toMatchObject({ status: "mismatch", matched: false });
		await expect(
			verifyArtifact(workspace, { path: "../track.wav" }),
		).rejects.toMatchObject({ code: "UNSAFE_PATH" });
	});

	it("marks an extraction partial when a written artifact no longer matches", async () => {
		const directory = await mkdtemp(resolve(tmpdir(), "garbro-verify-test-"));
		temporaryDirectories.push(directory);
		const input = resolve(directory, "input");
		const output = resolve(directory, "output");
		await mkdir(input);
		await mkdir(output);
		await writeFile(resolve(output, "changed.bin"), "changed");
		const workspace = new WorkspacePolicy({
			inputRoots: { games: input },
			outputRoot: output,
		});
		const extraction: BatchExtractionResult = {
			status: "completed",
			hasFailures: false,
			outputRootId: "default",
			outputDirectory: output,
			selected: 1,
			extracted: 1,
			skipped: 0,
			failed: 0,
			bytesWritten: 8n,
			items: [
				{
					entryId: "0",
					entryPath: "changed.bin",
					status: "extracted",
					artifact: {
						outputRootId: "default",
						relativePath: "changed.bin",
						absolutePath: resolve(output, "changed.bin"),
						bytesWritten: 8n,
						sha256: "0".repeat(64),
					},
				},
			],
		};

		await expect(
			verifyExtractionResult(workspace, extraction),
		).resolves.toMatchObject({
			status: "partial",
			hasFailures: true,
			verification: {
				mismatched: 1,
				items: [{ status: "mismatch" }],
			},
		});
	});
});
