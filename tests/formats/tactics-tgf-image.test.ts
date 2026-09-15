import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { tacticsTgfImageFormat } from "../../packages/formats/src/tactics/tgf-image.js";
import {
	writeBmp8,
	writeBmp24,
} from "../../packages/formats/src/shared/bmp.js";

/** A file whose bitmap is written as a stream of chunks, which is what the format carries. */
function tgfFile(bitmap: Buffer, chunkSize: number, body: Buffer): Buffer {
	const header = Buffer.alloc(8, 0);
	header.writeUInt32LE(bitmap.length, 0);
	header.writeInt32LE(chunkSize, 4);
	return Buffer.concat([header, body]);
}

/** A run of bytes the stream carries as they are. */
function literalRun(bytes: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let at = 0; at < bytes.length; at += 255) {
		const slice = bytes.subarray(at, at + 255);
		parts.push(Buffer.from([0, slice.length]), slice);
	}
	return Buffer.concat(parts);
}

/** A run of whole chunks the stream carries as they are. */
function chunkRun(chunkSize: number, chunks: number): Buffer {
	const count: Buffer = Buffer.alloc(1);
	count.writeUInt8(chunks, 0);
	return Buffer.concat([
		Buffer.from([1]),
		count,
		Buffer.alloc(chunks * chunkSize, 0),
	]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await tacticsTgfImageFormat.open(sourceOf(data), "cg.tgf");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe("Tactics graphics file", () => {
	it("finds a picture by its header", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const data = tgfFile(bmp, 54, literalRun(bmp));
		expect(await tacticsTgfImageFormat.detect(sourceOf(data))).toBe(true);
		// A bitmap longer than the word its own length field allows, and a chunk of no length at all.
		const huge = tgfFile(bmp, 54, literalRun(bmp));
		huge.writeUInt32LE(0x1000000, 0);
		expect(await tacticsTgfImageFormat.detect(sourceOf(huge))).toBe(false);
		const noChunk = tgfFile(bmp, 0, literalRun(bmp));
		expect(await tacticsTgfImageFormat.detect(sourceOf(noChunk))).toBe(false);
		// A chunk longer than the bitmap it belongs to.
		const short = tgfFile(bmp, bmp.length + 1, literalRun(bmp));
		expect(await tacticsTgfImageFormat.detect(sourceOf(short))).toBe(false);
		// And a stream whose first bytes are not a bitmap.
		const other = tgfFile(
			Buffer.alloc(62, 0x41),
			54,
			literalRun(Buffer.alloc(62, 0x41)),
		);
		expect(await tacticsTgfImageFormat.detect(sourceOf(other))).toBe(false);
	});

	it("lists the bitmap the picture holds", async () => {
		const bmp = writeBmp24(3, 2, Buffer.alloc(18, 0x44));
		const data = tgfFile(bmp, 54, literalRun(bmp));
		const handle = await tacticsTgfImageFormat.open(
			sourceOf(data),
			"dir/cg.tgf",
		);
		expect(handle.entries).toHaveLength(1);
		const entry = handle.entries[0];
		expect(entry?.path).toBe("cg.bmp");
		expect(entry?.compressed).toBe(true);
		expect(entry?.metadata).toMatchObject({
			type: "image",
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			bitmapSize: bmp.length,
			chunkSize: 54,
		});
	});

	it("unfolds a picture written as runs of bytes", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const out = await extract(tgfFile(bmp, 54, literalRun(bmp)));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("unfolds a picture written as runs of whole chunks", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		// Two chunks of fifty four bytes are more than the picture holds, so the second is cut short.
		const body = Buffer.concat([
			Buffer.from([0, 54]),
			bmp.subarray(0, 54),
			Buffer.from([1, 2]),
			bmp.subarray(54, 62),
			Buffer.alloc(46, 0),
		]);
		const out = await extract(tgfFile(bmp, 54, body));
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("repeats a chunk until the code is used up", async () => {
		// A one pixel bitmap of eight bits to a pixel: its header, a colour map of a thousand and twenty four
		// bytes, and a row padded out to four.
		const bmp = writeBmp8(1, 1, Buffer.from([0x05]));
		const chunkSize = 1024;
		const body = Buffer.concat([
			literalRun(bmp.subarray(0, 54)),
			// One run of whole chunks carries the colour map, and the copy behind it stops where the picture
			// ends, which leaves the row as it was found.
			chunkRun(chunkSize, 1),
			Buffer.from([0, 4, 0x05, 0x00, 0x00, 0x00]),
		]);
		const out = await extract(tgfFile(bmp, chunkSize, body));
		expect(out.readUInt16LE(28)).toBe(8);
		expect(out.readUInt32LE(18)).toBe(1);
		expect(out.subarray(54 + 1024, 54 + 1028)).toEqual(
			Buffer.from([0x05, 0x00, 0x00, 0x00]),
		);
		// The same picture, with the colour map repeated twice rather than carried in whole.
		const repeated = Buffer.concat([
			literalRun(bmp.subarray(0, 54)),
			Buffer.from([2]),
			Buffer.alloc(chunkSize, 0),
			Buffer.from([0, 4, 0x07, 0x00, 0x00, 0x00]),
		]);
		const second = await extract(tgfFile(bmp, chunkSize, repeated));
		expect(second.subarray(54 + 1024, 54 + 1028)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("keeps what it has when the stream ends early", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const body = Buffer.concat([Buffer.from([0, 54]), bmp.subarray(0, 54)]);
		const out = await extract(tgfFile(bmp, 54, body));
		// The header is there and the row behind it is the zeroes the buffer came with.
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 62)).toEqual(Buffer.alloc(8, 0x00));
	});
});
