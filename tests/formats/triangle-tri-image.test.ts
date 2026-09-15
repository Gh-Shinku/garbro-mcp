import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { triangleTriImageFormat } from "../../packages/formats/src/triangle/tri-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const SIZE_KEY = 0x65641538;

/**
 * The reference's own stream: every opcode stands behind a control word of its own, so the bits the decoder
 * reads are easy to follow.
 */
class TriWriter {
	private readonly parts: Buffer[] = [];
	private key = 0x7f;
	private previousKey = 0;

	literals(bytes: Buffer | number[]): this {
		for (const byte of bytes) {
			const input = this.key ^ byte;
			this.previousKey = this.key;
			this.key = byte & 0xff;
			this.parts.push(Buffer.from([0, 0, 0, 0]), Buffer.from([input & 0xff]));
		}
		return this;
	}

	/** A run of three to seventeen bytes, the length of which rides in the word of the opcode. */
	run(distance: number, count: number): this {
		const offset = ((count - 2) << 12) | ((distance - 1) & 0xfff);
		const word = Buffer.alloc(2);
		word.writeUInt16LE(offset & 0xffff, 0);
		this.parts.push(Buffer.from([0, 0, 0, 0x80]), word);
		return this;
	}

	/** A longer run, where the byte behind the word is what the previous key leaves of the length. */
	longRun(distance: number, count: number): this {
		const word = Buffer.alloc(3);
		word.writeUInt16LE((distance - 1) & 0xfff, 0);
		word.writeUInt8((count - 15 - this.previousKey) & 0xff, 2);
		this.parts.push(Buffer.from([0, 0, 0, 0x80]), word);
		return this;
	}

	done(): Buffer {
		return Buffer.concat(this.parts);
	}
}

/** A `TRIz` file whose header declares the length of the picture the body unfolds into. */
function triFile(unpackedSize: number, body: Buffer): Buffer {
	const header = Buffer.alloc(8, 0);
	header.write("TRIz", 0, "latin1");
	header.writeUInt32LE((unpackedSize ^ SIZE_KEY) >>> 0, 4);
	return Buffer.concat([header, body]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await triangleTriImageFormat.open(sourceOf(data), "cg.tri");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe("Triangle image", () => {
	it("finds a picture under its word", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new TriWriter();
		writer.literals(bmp);
		expect(
			await triangleTriImageFormat.detect(
				sourceOf(triFile(bmp.length, writer.done())),
			),
		).toBe(true);
		// Another word, and a body that ends before the bitmap header it should hold.
		expect(
			await triangleTriImageFormat.detect(
				sourceOf(Buffer.from("TRIa....", "latin1")),
			),
		).toBe(false);
		const short = triFile(
			4096,
			new TriWriter().literals(Buffer.alloc(20)).done(),
		);
		expect(await triangleTriImageFormat.detect(sourceOf(short))).toBe(false);
	});

	it("lists the bitmap the picture holds", async () => {
		const bmp = writeBmp24(3, 2, Buffer.alloc(3 * 3 * 2, 0x11));
		const writer = new TriWriter();
		writer.literals(bmp);
		const data = triFile(bmp.length, writer.done());
		const handle = await triangleTriImageFormat.open(
			sourceOf(data),
			"dir/cg.tri",
		);
		expect(handle.entries).toHaveLength(1);
		const entry = handle.entries[0];
		expect(entry?.path).toBe("cg.bmp");
		expect(entry?.size).toBe(BigInt(data.length));
		expect(entry?.compressed).toBe(true);
		expect(entry?.metadata).toMatchObject({
			type: "image",
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			unpackedSize: bmp.length,
		});
	});

	it("unfolds a picture written a byte at a time", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new TriWriter();
		writer.literals(bmp);
		const out = await extract(triFile(bmp.length, writer.done()));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("repeats what the picture already holds", async () => {
		// The last pixel of a row that repeats the first one is a run three bytes back.
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 1, 2, 3]));
		const writer = new TriWriter();
		writer.literals(bmp.subarray(0, 57));
		writer.run(3, 5);
		const out = await extract(triFile(bmp.length, writer.done()));
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 1, 2, 3]));
	});

	it("repeats a run long enough to need its own length byte", async () => {
		const pixels = Buffer.alloc(24, 0);
		for (let i = 0; i < 8; i += 1) pixels.set([1, 2, 3], i * 3);
		const bmp = writeBmp24(8, 1, pixels);
		const writer = new TriWriter();
		writer.literals(bmp.subarray(0, 57));
		writer.longRun(3, 21);
		const out = await extract(triFile(bmp.length, writer.done()));
		expect(out.subarray(54, 78)).toEqual(pixels);
	});

	it("stops at a run that names no length at all", async () => {
		// The long form with a count word of zero ends the stream, so the picture stops where it stopped.
		const bmp = writeBmp24(8, 1, Buffer.alloc(24, 0x22));
		const writer = new TriWriter();
		writer.literals(bmp.subarray(0, 57));
		// A long run whose length byte cancels the previous key leaves a count of zero, which ends the stream:
		// the picture stops there and the rest of it stays the zeroes the buffer came with.
		const word = Buffer.alloc(3);
		word.writeUInt16LE(2, 0);
		// The key the last literal left behind is that literal's own byte, so this cancels it.
		word.writeUInt8((0x100 - 0x22) & 0xff, 2);
		const body = Buffer.concat([
			writer.done(),
			Buffer.from([0, 0, 0, 0x80]),
			word,
		]);
		const out = await extract(triFile(bmp.length, body));
		expect(out.subarray(54, 57)).toEqual(Buffer.from([0x22, 0x22, 0x22]));
		expect(out.subarray(57)).toEqual(Buffer.alloc(21, 0));
	});

	it("refuses a run that reaches behind the picture", async () => {
		const writer = new TriWriter();
		writer.run(0x100, 3);
		const bmp = writeBmp24(8, 1, Buffer.alloc(24, 0));
		const data = triFile(
			bmp.length,
			Buffer.concat([
				writer.literals(bmp.subarray(0, 54)).done(),
				writer.done(),
			]),
		);
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses a picture whose stream ends early", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new TriWriter();
		writer.literals(bmp.subarray(0, 20));
		await expect(
			extract(triFile(bmp.length, writer.done())),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a picture that declares more than it can hold", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new TriWriter();
		writer.literals(bmp);
		const huge = triFile(0x20000000, writer.done());
		await expect(extract(huge)).rejects.toMatchObject({
			code: "LIMIT_EXCEEDED",
		});
		const empty = triFile(0, writer.done());
		await expect(extract(empty)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
