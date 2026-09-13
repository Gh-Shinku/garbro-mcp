import { BufferByteSource } from "@garbro-mcp/core";
import { animeGameSystemAniFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface Frame {
	type: number;
	payload?: Buffer;
}

/** A frame's stored bytes are its type byte followed by the payload. */
function frameBytes(frame: Frame): Buffer {
	return Buffer.concat([
		Buffer.from([frame.type]),
		frame.payload ?? Buffer.alloc(0),
	]);
}

/**
 * Builds an ANI file. The first word is the payload offset and the frame table size at once: the table
 * holds one offset per frame after the first, so the payload area starts at `4 + 4 * (count - 1)`.
 */
function buildAni(frames: readonly Frame[]): Buffer {
	const tableLength = Math.max(0, frames.length - 1) * 4;
	const firstOffset = 4 + tableLength;
	const bodies = frames.map(frameBytes);
	const offsets: number[] = [];
	let running = firstOffset;
	for (const body of bodies) {
		offsets.push(running);
		running += body.length;
	}
	const header = Buffer.alloc(4);
	header.writeUInt32LE(firstOffset, 0);
	const table = Buffer.alloc(tableLength);
	for (let index = 1; index < offsets.length; index += 1)
		table.writeUInt32LE(offsets[index] ?? 0, (index - 1) * 4);
	return Buffer.concat([header, table, ...bodies]);
}

/** An archive whose two frames share one payload, as the reference's offset map allows. */
function buildSharedOffsetAni(bodies: readonly Buffer[]): Buffer {
	const header = Buffer.alloc(4);
	header.writeUInt32LE(8, 0);
	const table = Buffer.alloc(4);
	table.writeUInt32LE(8, 0);
	return Buffer.concat([header, table, ...bodies]);
}

describe("Anime Game System ANI animation resource", () => {
	it("lists frames in table order and skips type one", async () => {
		const first = Buffer.from([0, 1, 2, 3]);
		const second = Buffer.from([2, 9, 9]);
		const skipped = Buffer.from([1, 7, 7, 7]);
		await expectArchive({
			format: animeGameSystemAniFormat,
			archive: buildAni([
				{ type: 0, payload: first },
				{ type: 2, payload: second },
				{ type: 1, payload: skipped },
			]),
			sourcePath: "sample.ani",
			entries: [
				{
					path: "0000",
					size: 1 + first.length,
					content: frameBytes({ type: 0, payload: first }),
				},
				{
					// Skipped frames are not listed, so the last listed frame's extent runs over them to
					// the end of the file.
					path: "0001",
					size: 1 + second.length + 1 + skipped.length,
					content: Buffer.concat([
						frameBytes({ type: 2, payload: second }),
						frameBytes({ type: 1, payload: skipped }),
					]),
				},
			],
		});
	});

	it("tracks the key frame of every listed frame", async () => {
		const archive = buildAni([
			{ type: 0, payload: Buffer.from([1, 2]) },
			{ type: 3, payload: Buffer.from([1, 2]) },
			{ type: 0xa, payload: Buffer.from([1, 2]) },
			{ type: 4, payload: Buffer.from([1, 2]) },
			{ type: 1, payload: Buffer.from([1, 2]) },
			{ type: 5, payload: Buffer.from([1, 2]) },
		]);
		const source = new BufferByteSource(archive);
		const handle = await animeGameSystemAniFormat.open(source, "sample.ani");
		expect(
			handle.entries.map((entry) => ({
				path: entry.path,
				frameType: entry.metadata?.frameType,
				keyFrame: entry.metadata?.keyFrame,
				frameIndex: entry.metadata?.frameIndex,
				type: entry.metadata?.type,
			})),
		).toEqual([
			{ path: "0000", frameType: 0, keyFrame: 0, frameIndex: 0, type: "image" },
			{ path: "0001", frameType: 3, keyFrame: 0, frameIndex: 1, type: "image" },
			{
				path: "0002",
				frameType: 0xa,
				keyFrame: 2,
				frameIndex: 2,
				type: "image",
			},
			{ path: "0003", frameType: 4, keyFrame: 2, frameIndex: 3, type: "image" },
			{ path: "0005", frameType: 5, keyFrame: 2, frameIndex: 4, type: "image" },
		]);
	});

	it("extends the last frame to the end of the file", async () => {
		const payload = Buffer.from([3, 1, 1, 1]);
		const archive = buildAni([
			{ type: 1, payload: Buffer.from([9]) },
			{ type: 0, payload },
		]);
		await expectArchive({
			format: animeGameSystemAniFormat,
			archive,
			sourcePath: "sample.ani",
			entries: [
				{
					path: "0001",
					size: 1 + payload.length,
					content: frameBytes({ type: 0, payload }),
				},
			],
		});
	});

	it("gives frames that share an offset one shared extent", async () => {
		const body = frameBytes({ type: 0, payload: Buffer.from([5, 5]) });
		const archive = buildSharedOffsetAni([body, Buffer.alloc(0)]);
		const source = new BufferByteSource(archive);
		const handle = await animeGameSystemAniFormat.open(source, "sample.ani");
		expect(
			handle.entries.map((entry) => ({
				path: entry.path,
				size: entry.size,
				keyFrame: entry.metadata?.keyFrame,
			})),
		).toEqual([
			{ path: "0000", size: BigInt(body.length), keyFrame: 0 },
			{ path: "0001", size: BigInt(body.length), keyFrame: 1 },
		]);
	});

	it("rejects a name without the ani extension", async () => {
		const archive = buildAni([{ type: 0, payload: Buffer.from([1, 2, 3]) }]);
		const source = new BufferByteSource(archive);
		expect(await animeGameSystemAniFormat.detect(source, "sample.bin")).toBe(
			false,
		);
		expect(await animeGameSystemAniFormat.detect(source, "SAMPLE.ANI")).toBe(
			true,
		);
	});

	it("rejects a first offset that is not word aligned", async () => {
		const archive = buildAni([{ type: 0, payload: Buffer.from([1, 2, 3]) }]);
		archive.writeUInt32LE(6, 0);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});

	it("rejects a first offset inside the header", async () => {
		const archive = buildAni([{ type: 0, payload: Buffer.from([1, 2, 3]) }]);
		archive.writeUInt32LE(0, 0);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});

	it("rejects a first offset past the end of the file", async () => {
		const archive = buildAni([{ type: 0, payload: Buffer.from([1, 2, 3]) }]);
		archive.writeUInt32LE(0x1000, 0);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});

	it("rejects a table offset before the payload area", async () => {
		const archive = buildAni([
			{ type: 0, payload: Buffer.from([1, 2, 3]) },
			{ type: 0, payload: Buffer.from([4, 5, 6]) },
		]);
		archive.writeUInt32LE(4, 4);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});

	it("rejects a frame type at or above 0x20", async () => {
		const archive = buildAni([{ type: 0x20, payload: Buffer.from([1, 2, 3]) }]);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});

	it("rejects an archive whose frames are all skipped", async () => {
		const archive = buildAni([
			{ type: 1, payload: Buffer.from([1, 2, 3]) },
			{ type: 1, payload: Buffer.from([4, 5, 6]) },
		]);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});

	it("rejects more frames than the reference allows", async () => {
		const archive = Buffer.alloc(4 * 10001);
		archive.writeUInt32LE(archive.length, 0);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});

	it("rejects a file that is too small for its header", async () => {
		const archive = Buffer.from([1, 0]);
		expect(
			await animeGameSystemAniFormat.detect(
				new BufferByteSource(archive),
				"sample.ani",
			),
		).toBe(false);
	});
});
