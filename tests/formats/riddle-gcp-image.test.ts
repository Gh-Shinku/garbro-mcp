import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import {
	riddleGcpImageFormat,
	unpackGcp,
} from "../../packages/formats/src/riddle/gcp-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

/**
 * The stream the reference reads: the top bit of the byte comes first, a set bit is a literal byte, and a clear
 * bit is a run named by a place in a ring of two thousand and forty eight bytes.
 */
class GcpWriter {
	private readonly bits: number[] = [];

	literal(byte: number): this {
		this.bit(1);
		this.field(byte, 8);
		return this;
	}

	run(offset: number, count: number): this {
		this.bit(0);
		this.field(offset, 11);
		this.field(count - 2, 4);
		return this;
	}

	private bit(value: number): void {
		this.bits.push(value & 1);
	}

	private field(value: number, count: number): void {
		for (let i = count - 1; i >= 0; i -= 1) this.bit((value >>> i) & 1);
	}

	done(): Buffer {
		const bytes: Buffer = Buffer.alloc(Math.ceil(this.bits.length / 8), 0);
		for (const [index, bit] of this.bits.entries()) {
			if (bit)
				bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
		}
		return bytes;
	}
}

/** A file: the word, the length of the picture, the length of the stream, and the stream. */
function gcpFile(dataSize: number, packedSize: number, body: Buffer): Buffer {
	const header = Buffer.alloc(12, 0);
	header.write("CMP1", 0, "latin1");
	header.writeInt32LE(dataSize, 4);
	header.writeInt32LE(packedSize, 8);
	return Buffer.concat([header, body]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await riddleGcpImageFormat.open(sourceOf(data), "cg.gcp");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe("Riddle Soft compressed bitmap", () => {
	it("finds a picture under its word", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new GcpWriter();
		for (const byte of bmp) writer.literal(byte);
		const body = writer.done();
		expect(
			await riddleGcpImageFormat.detect(
				sourceOf(gcpFile(bmp.length, body.length, body)),
			),
		).toBe(true);
		// A picture shorter than a bitmap header, and one whose stream is not a bitmap.
		expect(
			await riddleGcpImageFormat.detect(
				sourceOf(gcpFile(20, body.length, body)),
			),
		).toBe(false);
		const other = new GcpWriter();
		for (const byte of Buffer.alloc(62, 0x41)) other.literal(byte);
		expect(
			await riddleGcpImageFormat.detect(
				sourceOf(gcpFile(62, other.done().length, other.done())),
			),
		).toBe(false);
	});

	it("lists the bitmap the picture holds", async () => {
		const bmp = writeBmp24(3, 2, Buffer.alloc(18, 0x55));
		const writer = new GcpWriter();
		for (const byte of bmp) writer.literal(byte);
		const body = writer.done();
		const handle = await riddleGcpImageFormat.open(
			sourceOf(gcpFile(bmp.length, body.length, body)),
			"dir/cg.gcp",
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
			dataSize: bmp.length,
			packedSize: body.length,
		});
	});

	it("unfolds a picture written a byte at a time", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new GcpWriter();
		for (const byte of bmp) writer.literal(byte);
		const body = writer.done();
		const out = await extract(gcpFile(bmp.length, body.length, body));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("repeats a run from a place in the ring", async () => {
		// The first byte written stands at place two thousand and thirty one, so the first pixel of the bitmap,
		// which is at offset fifty four of the picture, is reached at place thirty seven of the ring.
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 1, 2, 3]));
		const writer = new GcpWriter();
		for (const byte of bmp.subarray(0, 57)) writer.literal(byte);
		writer.run(0x25, 5);
		const body = writer.done();
		const out = await extract(gcpFile(bmp.length, body.length, body));
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 1, 2, 3]));
	});

	it("reads the ring full of spaces before anything is written", () => {
		// A run of nothing but zero bits names place zero and a length of two, which the ring holds as spaces.
		const out = unpackGcp(Buffer.from([0x00, 0x00, 0x00, 0x00]), 0, 4, 3);
		expect(out).toEqual(Buffer.from([0x20, 0x20, 0x20]));
	});

	it("unpads a bitmap whose rows the writer left without it", async () => {
		// A picture five pixels wide keeps fifteen bytes to a row, which a bitmap of the usual padding would
		// make sixteen; the reference reads such a picture row by row and turns it the right way up.
		// The rows of such a picture are stored the other way up, which its header records with a height that
		// is positive.
		const padded = writeBmp24(5, 1, Buffer.alloc(15, 0x66), true);
		const pixels = Buffer.alloc(15, 0x00);
		for (let i = 0; i < 5; i += 1) pixels.set([i + 1, i + 11, i + 21], i * 3);
		const data = Buffer.concat([padded.subarray(0, 54), pixels]);
		expect(data.length).toBe(5 * 1 * 3 + 54);
		const writer = new GcpWriter();
		for (const byte of data) writer.literal(byte);
		const body = writer.done();
		const out = await extract(gcpFile(data.length, body.length, body));
		expect(out.readUInt32LE(18)).toBe(5);
		// The rows of such a picture are stored the other way up, so a single row comes back as it stands.
		expect(out.subarray(54, 69)).toEqual(pixels);
	});

	it("stops where its stream says it does", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new GcpWriter();
		for (const byte of bmp) writer.literal(byte);
		const body = writer.done();
		// A stream length that covers the measurements but not the row behind them.
		const out = await extract(gcpFile(bmp.length, 40, body));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 62)).toEqual(Buffer.alloc(8, 0x00));
	});
});
