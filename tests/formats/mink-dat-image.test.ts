import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { minkDatImageFormat } from "../../packages/formats/src/mink/dat-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

/** A stream of bits, most significant first, holding the two kinds of op the format carries. */
class MinkWriter {
	readonly #bits: number[] = [];

	get length(): number {
		return this.#bits.length;
	}

	#bit(value: number): void {
		this.#bits.push(value & 1);
	}

	#write(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.#bit((value >> index) & 1);
		}
	}

	/** A bit of ones and then the byte behind it. */
	literal(byte: number): this {
		this.#bit(1);
		this.#write(byte, 8);
		return this;
	}

	/** A bit of nothing, then the place the run starts at and the count it carries. */
	run(
		source: number,
		count: number,
		offsetBits: number,
		countBits: number,
	): this {
		this.#bit(0);
		this.#write(source, offsetBits);
		this.#write(count, countBits);
		return this;
	}

	done(): Buffer {
		const bytes: Buffer = Buffer.alloc(Math.ceil(this.#bits.length / 8), 0);
		for (const [index, bit] of this.#bits.entries()) {
			if (bit === 0) continue;
			bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
		}
		return bytes;
	}
}

/**
 * A stream of this format: a marker, the length of everything behind the marker — the two counts of bits
 * included — and the length the picture unfolds to.
 */
function minkFile(
	stream: Buffer,
	unpackedSize: number,
	offsetBits = 8,
	countBits = 8,
): Buffer {
	const header: Buffer = Buffer.alloc(9, 0);
	header[0] = 3;
	header.writeInt32LE(stream.length + 2, 1);
	header.writeInt32LE(unpackedSize, 5);
	return Buffer.concat([header, Buffer.from([offsetBits, countBits]), stream]);
}

/** A stream of nothing but literals, which unpacks to the bytes it carries. */
function literalsOf(data: Buffer): Buffer {
	const writer = new MinkWriter();
	for (const byte of data) writer.literal(byte);
	return writer.done();
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.dat"): Promise<Buffer> {
	const handle = await minkDatImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Mink compressed bitmap", () => {
	const picture = writeBmp24(4, 2, Buffer.alloc(24, 0x22));

	it("finds a stream whose lengths agree with what follows them", async () => {
		const stream = literalsOf(picture);
		expect(
			await minkDatImageFormat.detect(
				sourceOf(minkFile(stream, picture.length)),
			),
		).toBe(true);
		// The marker and the packed length are both checked; the length the picture unfolds to is not.
		const wrongMarker = Buffer.from(minkFile(stream, picture.length));
		wrongMarker[0] = 4;
		expect(await minkDatImageFormat.detect(sourceOf(wrongMarker))).toBe(false);
		const wrongLength = Buffer.from(minkFile(stream, picture.length));
		wrongLength.writeInt32LE(stream.length + 3, 1);
		expect(await minkDatImageFormat.detect(sourceOf(wrongLength))).toBe(false);
		expect(
			await minkDatImageFormat.detect(
				sourceOf(minkFile(stream, picture.length - 1)),
			),
		).toBe(true);
	});

	it("refuses a picture shorter than the bitmap it unfolds to", async () => {
		const stream = literalsOf(picture);
		await expect(
			extract(minkFile(stream, picture.length - 24)),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("declines a stream that does not unfold to a bitmap", async () => {
		const stream = literalsOf(Buffer.alloc(56, 0x11));
		expect(
			await minkDatImageFormat.detect(sourceOf(minkFile(stream, 56))),
		).toBe(false);
	});

	it("reports what the bitmap it unfolds to says about itself", async () => {
		const stream = literalsOf(picture);
		const handle = await minkDatImageFormat.open(
			sourceOf(minkFile(stream, picture.length)),
			"dir/cg.dat",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 2,
			bitsPerPixel: 24,
			unpackedSize: picture.length,
		});
	});

	it("writes the picture the stream carries a byte at a time", async () => {
		const stream = literalsOf(picture);
		expect(await extract(minkFile(stream, picture.length))).toEqual(picture);
	});

	it("repeats what the picture already holds", async () => {
		// The header, one pixel, and then a run of that pixel counted from the start of the picture.
		const writer = new MinkWriter();
		for (const byte of picture.subarray(0, 54)) writer.literal(byte);
		writer.literal(1).literal(2).literal(3);
		writer.run(54, 23, 8, 8);
		const out = await extract(minkFile(writer.done(), picture.length));
		const expected: Buffer = Buffer.from(picture);
		for (let pixel = 0; pixel < 8; pixel += 1) {
			expected[54 + pixel * 3] = 1;
			expected[54 + pixel * 3 + 1] = 2;
			expected[54 + pixel * 3 + 2] = 3;
		}
		expect(out).toEqual(expected);
	});

	it("leaves the rest of the picture as it was when the stream stops", async () => {
		const writer = new MinkWriter();
		for (const byte of picture.subarray(0, 54)) writer.literal(byte);
		const out = await extract(minkFile(writer.done(), picture.length));
		expect(out.subarray(54)).toEqual(Buffer.alloc(24, 0x00));
	});

	it("refuses a run that reaches outside its picture", async () => {
		const writer = new MinkWriter();
		for (const byte of picture.subarray(0, 54)) writer.literal(byte);
		writer.run(0xff, 23, 8, 8);
		await expect(
			extract(minkFile(writer.done(), picture.length)),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
