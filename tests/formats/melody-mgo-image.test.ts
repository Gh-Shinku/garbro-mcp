import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { melodyMgoImageFormat } from "../../packages/formats/src/melody/mgo-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

/**
 * The stream the reference reads: bits are taken from the lowest bit of each byte up, and a field is gathered
 * from its lowest bit up as well.
 */
class MelodyWriter {
	private readonly bits: number[] = [];

	literal(byte: number): this {
		this.bit(1);
		this.field(byte, 8);
		return this;
	}

	/** A run named by an absolute place in the ring, which the decoder wraps at four thousand and ninety six. */
	match(offset: number, length: number): this {
		this.bit(0);
		this.field(offset, 12);
		this.field(length - 2, 4);
		return this;
	}

	private bit(value: number): void {
		this.bits.push(value & 1);
	}

	private field(value: number, count: number): void {
		for (let i = 0; i < count; i += 1) this.bit((value >>> i) & 1);
	}

	done(): Buffer {
		const bytes: Buffer = Buffer.alloc(Math.ceil(this.bits.length / 8), 0);
		for (const [index, bit] of this.bits.entries()) {
			if (bit)
				bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (index & 7));
		}
		return bytes;
	}
}

/**
 * The place the reference reads the table of entries from: the terminator of the name counts towards the four
 * byte alignment, so a name of five bytes leaves the table at eight.
 */
function tableOffset(nameLength: number): number {
	return (((nameLength - 1) & ~3) + 4) | 0;
}

/** The picture the reference unfolds: a name, a table it walks past, then the bitmap. */
function picture(name: string, entries: number, bmp: Buffer): Buffer {
	const head = Buffer.from(`${name}\0`, "latin1");
	const at = tableOffset(name.length);
	const count: Buffer = Buffer.alloc(4);
	count.writeInt32LE(entries, 0);
	const table = Buffer.concat([
		Buffer.alloc(at - head.length, 0),
		count,
		Buffer.alloc(entries * 0x10, 0),
	]);
	return Buffer.concat([head, table, bmp]);
}

function mgoFile(unpacked: Buffer, body: Buffer): Buffer {
	const header = Buffer.alloc(12, 0);
	header.write("MGOB", 0, "latin1");
	header.writeInt32LE(5, 4);
	header.writeInt32LE(unpacked.length, 8);
	return Buffer.concat([header, body]);
}

/** A picture written a byte at a time. */
function literalFile(unpacked: Buffer): Buffer {
	const writer = new MelodyWriter();
	for (const byte of unpacked) writer.literal(byte);
	return mgoFile(unpacked, writer.done());
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await melodyMgoImageFormat.open(sourceOf(data), "cg.mgo");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe("Melody compressed bitmap", () => {
	it("finds a picture under its word", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const data = literalFile(picture("cg", 2, bmp));
		expect(await melodyMgoImageFormat.detect(sourceOf(data))).toBe(true);
		// The word at offset four has to be five.
		const wrong = Buffer.from(data);
		wrong.writeInt32LE(4, 4);
		expect(await melodyMgoImageFormat.detect(sourceOf(wrong))).toBe(false);
		// And the stream has to carry a bitmap.
		const other = literalFile(picture("cg", 2, Buffer.alloc(0x36, 0x41)));
		expect(await melodyMgoImageFormat.detect(sourceOf(other))).toBe(false);
	});

	it("lists the bitmap the picture holds", async () => {
		const bmp = writeBmp24(3, 2, Buffer.alloc(18, 0x22));
		const data = literalFile(picture("cg", 2, bmp));
		const handle = await melodyMgoImageFormat.open(
			sourceOf(data),
			"dir/cg.mgo",
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
			name: "cg",
		});
	});

	it("unfolds a picture written a byte at a time", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const out = await extract(literalFile(picture("cg", 2, bmp)));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("repeats a run from a named place in the ring", async () => {
		// The first byte the stream writes stands one place into the ring, so the first pixel of the bitmap,
		// which begins at offset sixty two of the picture, is reached at ring place sixty three.
		const pixels = Buffer.alloc(12, 0);
		for (let i = 0; i < 4; i += 1) pixels.set([1, 2, 3], i * 3);
		const bmp = writeBmp24(4, 1, pixels);
		const unpacked = picture("cg", 0, bmp);
		const writer = new MelodyWriter();
		for (const byte of unpacked.subarray(0, 8 + 54 + 3)) writer.literal(byte);
		writer.match(63, 9);
		const out = await extract(mgoFile(unpacked, writer.done()));
		expect(out.subarray(54, 66)).toEqual(pixels);
	});

	it("reads the table where a name of five bytes leaves it", async () => {
		// The terminator of the name counts towards the alignment the reference uses, so a five byte name has
		// two bytes of filler behind it before the table.
		const pixels = Buffer.alloc(12, 0);
		for (let i = 0; i < 4; i += 1) pixels.set([7, 8, 9], i * 3);
		const bmp = writeBmp24(4, 1, pixels);
		const data = literalFile(picture("abcde", 3, bmp));
		const out = await extract(data);
		expect(out.subarray(54, 66)).toEqual(pixels);
		const handle = await melodyMgoImageFormat.open(sourceOf(data), "cg.mgo");
		expect(handle.entries[0]?.metadata).toMatchObject({ name: "abcde" });
	});

	it("refuses a stream that stops before its bitmap", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const unpacked = picture("cg", 2, bmp);
		const writer = new MelodyWriter();
		for (const byte of unpacked.subarray(0, 40)) writer.literal(byte);
		const data = mgoFile(unpacked, writer.done());
		expect(await melodyMgoImageFormat.detect(sourceOf(data))).toBe(false);
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses a picture that declares more than it can hold", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const writer = new MelodyWriter();
		for (const byte of picture("cg", 2, bmp)) writer.literal(byte);
		const header = Buffer.alloc(12, 0);
		header.write("MGOB", 0, "latin1");
		header.writeInt32LE(5, 4);
		header.writeInt32LE(0x20000000, 8);
		const data = Buffer.concat([header, writer.done()]);
		expect(await melodyMgoImageFormat.detect(sourceOf(data))).toBe(false);
		await expect(extract(data)).rejects.toMatchObject({
			code: "LIMIT_EXCEEDED",
		});
	});
});
