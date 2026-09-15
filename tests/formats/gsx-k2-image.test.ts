import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { gsxK2ImageFormat } from "../../packages/formats/src/gsx/k2-image.js";
import {
	readBmpImage,
	writeBmp24,
	writeBmpImage,
} from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x16;
const UNPACKED_SIZE_FIELD = 6;
const DATA_POSITION_FIELD = 0x12;
const CONTROL_BASE = 0x10;

/** A stream of bits, most significant first, holding the two planes of the format. */
class K2Writer {
	readonly #controls: number[] = [];
	readonly #stream: number[] = [];

	get controlBitCount(): number {
		return this.#controls.length;
	}

	#bit(bits: number[], value: number): void {
		bits.push(value & 1);
	}

	#write(bits: number[], value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.#bit(bits, (value >> index) & 1);
		}
	}

	/** A control bit of ones and then the byte of the picture behind it. */
	literal(byte: number): this {
		this.#bit(this.#controls, 1);
		this.#write(this.#stream, byte, 8);
		return this;
	}

	/** A run: a control bit of nothing, a bit naming the form, and then its place and its count. */
	run(offset: number, count: number, long: boolean): this {
		this.#bit(this.#controls, 0);
		this.#bit(this.#controls, long ? 1 : 0);
		if (long) {
			this.#write(this.#stream, offset, 14);
			this.#write(this.#stream, count - 3, 4);
		} else {
			this.#write(this.#stream, offset, 9);
			this.#write(this.#stream, count - 2, 3);
		}
		return this;
	}

	#bytes(bits: number[]): Buffer {
		const bytes: Buffer = Buffer.alloc(Math.ceil(bits.length / 8), 0);
		for (const [index, bit] of bits.entries()) {
			if (bit === 0) continue;
			bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
		}
		return bytes;
	}

	/** The file: `K2`, the length the picture unfolds to, where the stream starts, and both planes. */
	file(unpackedSize: number, magic = 0x18): Buffer {
		const controls = this.#bytes(this.#controls);
		const dataPosition = CONTROL_BASE + controls.length;
		const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
		header.write("K2", 0, "latin1");
		header[2] = magic;
		header.writeInt32LE(unpackedSize, UNPACKED_SIZE_FIELD);
		header.writeInt32LE(dataPosition, DATA_POSITION_FIELD);
		return Buffer.concat([header, controls, this.#bytes(this.#stream)]);
	}
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.k2"): Promise<Buffer> {
	const handle = await gsxK2ImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** A writer that carries every byte of the picture as a literal of its own. */
function literalsOf(picture: Buffer): K2Writer {
	const writer = new K2Writer();
	for (const byte of picture) writer.literal(byte);
	return writer;
}

describe("Toyo GSX image", () => {
	const pixels: Buffer = Buffer.alloc(4 * 2 * 3, 0);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 3) & 0xff;
	const picture = writeBmp24(4, 2, pixels);

	it("finds a picture behind a word of its own", async () => {
		const data = literalsOf(picture).file(picture.length);
		expect(await gsxK2ImageFormat.detect(sourceOf(data), "cg.k2")).toBe(true);
		// Every one of the seven words the reference registers is read.
		for (const magic of [0x18, 0x20, 0x10, 0x0f, 0x08, 0x04, 0x01]) {
			expect(
				await gsxK2ImageFormat.detect(
					sourceOf(literalsOf(picture).file(picture.length, magic)),
				),
			).toBe(true);
		}
	});

	it("declines a word the reference does not read", async () => {
		const magic: Buffer = literalsOf(picture).file(picture.length);
		magic[2] = 0x19;
		expect(await gsxK2ImageFormat.detect(sourceOf(magic))).toBe(false);
		const fourth: Buffer = literalsOf(picture).file(picture.length);
		fourth[3] = 0x01;
		expect(await gsxK2ImageFormat.detect(sourceOf(fourth))).toBe(false);
	});

	it("reports what the bitmap it unfolds to says about itself", async () => {
		const handle = await gsxK2ImageFormat.open(
			sourceOf(literalsOf(picture).file(picture.length)),
			"dir/cg.k2",
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
		const image = readBmpImage(picture);
		if (!image) throw new Error("the fixture is not a bitmap");
		expect(await extract(literalsOf(picture).file(picture.length))).toEqual(
			writeBmpImage(image),
		);
	});

	it("repeats what the picture already holds with a run of either form", async () => {
		// The header, one pixel of its own, and then a run of that pixel — written with the wide place and the
		// short one, which carry the same run either way.
		for (const [count, long] of [
			[9, true],
			[9, false],
		] as const) {
			const writer = new K2Writer();
			for (const byte of picture.subarray(0, 54)) writer.literal(byte);
			writer.literal(1).literal(2).literal(3);
			writer.run(2, count, long);
			for (let at = 57 + count; at < picture.length; at += 1) {
				writer.literal(picture[at] ?? 0);
			}
			const expected: Buffer = Buffer.from(picture);
			expected[54] = 1;
			expected[55] = 2;
			expected[56] = 3;
			for (let at = 57; at < 57 + count; at += 1) {
				expected[at] = expected[at - 3] ?? 0;
			}
			const image = readBmpImage(expected);
			if (!image) throw new Error("the fixture is not a bitmap");
			expect(await extract(writer.file(picture.length))).toEqual(
				writeBmpImage(image),
			);
		}
	});

	it("leaves the rest of the picture as it was when the control bits end", async () => {
		const writer = new K2Writer();
		for (const byte of picture.subarray(0, 54)) writer.literal(byte);
		const out = await extract(writer.file(picture.length));
		expect(out.subarray(54)).toEqual(Buffer.alloc(picture.length - 54, 0x00));
	});

	it("refuses a run that reaches before its picture", async () => {
		const writer = new K2Writer();
		for (const byte of picture.subarray(0, 54)) writer.literal(byte);
		writer.run(0x2000, 9, true);
		await expect(extract(writer.file(picture.length))).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
