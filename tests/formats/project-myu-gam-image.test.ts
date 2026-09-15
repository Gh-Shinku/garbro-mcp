import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	projectMyuGamImageFormat,
	unpackGam,
} from "../../packages/formats/src/project-myu/gam-image.js";
import {
	paletteTriples,
	readBmpImage,
	writeBmp24,
	writeBmp8Palette,
	writeBmpImage,
} from "../../packages/formats/src/shared/bmp.js";

const OPS_PER_WORD = 16;

/** The stream of the format: two byte control words, sixteen ops each, least significant bit first. */
class GamWriter {
	readonly #words: Array<{ word: number; payload: number[] }> = [];
	#pending: Array<{ bit: number; payload: number[] }> = [];

	literal(byte: number): this {
		return this.#op(0, [byte & 0xff]);
	}

	run(offset: number, count: number): this {
		return this.#op(1, [offset & 0xff, count & 0xff]);
	}

	#op(bit: number, payload: number[]): this {
		this.#pending.push({ bit, payload });
		if (this.#pending.length === OPS_PER_WORD) this.#flush();
		return this;
	}

	#flush(): void {
		if (0 === this.#pending.length) return;
		let word = 0;
		for (const [index, op] of this.#pending.entries()) {
			word |= op.bit << index;
		}
		this.#words.push({
			word,
			payload: this.#pending.flatMap((op) => op.payload),
		});
		this.#pending = [];
	}

	/** The file: the four words the signature sits in, then the stream behind them. */
	file(): Buffer {
		this.#flush();
		const bytes: number[] = [0x47, 0x41, 0x4d, 0x00, 0, 0, 0, 0];
		for (const { word, payload } of this.#words) {
			bytes.push(word & 0xff, (word >> 8) & 0xff, ...payload);
		}
		return Buffer.from(bytes);
	}
}

/** A writer carrying every byte of the picture as a byte of its own. */
function literalsOf(picture: Buffer): GamWriter {
	const writer = new GamWriter();
	for (const byte of picture) writer.literal(byte);
	return writer;
}

function sourceOf(picture: Buffer | Buffer[]): BufferByteSource {
	const data = Array.isArray(picture) ? Buffer.concat(picture) : picture;
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.gam"): Promise<Buffer> {
	const handle = await projectMyuGamImageFormat.open(
		sourceOf(data),
		sourcePath,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

function normalised(picture: Buffer): Buffer {
	const image = readBmpImage(picture);
	if (!image) throw new Error("the fixture is not a bitmap");
	return writeBmpImage(image);
}

describe("Project-Myu compressed bitmap", () => {
	const pixels: Buffer = Buffer.alloc(6 * 4 * 3, 0);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (index * 5) & 0xff;
	}
	const picture = writeBmp24(6, 4, pixels);

	it("finds a bitmap behind the words of the format", async () => {
		expect(
			await projectMyuGamImageFormat.detect(
				sourceOf(literalsOf(picture).file()),
			),
		).toBe(true);
		const other: Buffer = literalsOf(picture).file();
		other[3] = 0x01;
		expect(await projectMyuGamImageFormat.detect(sourceOf(other))).toBe(false);
	});

	it("declines a stream that does not unfold to a bitmap", async () => {
		const writer = new GamWriter();
		for (let index = 0; index < 200; index += 1) writer.literal(index & 0xff);
		expect(await projectMyuGamImageFormat.detect(sourceOf(writer.file()))).toBe(
			false,
		);
	});

	it("reports what the bitmap it unfolds to says about itself", async () => {
		const handle = await projectMyuGamImageFormat.open(
			sourceOf(literalsOf(picture).file()),
			"dir/cg.gam",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 6,
			height: 4,
			bitsPerPixel: 24,
		});
	});

	it("writes the picture the stream carries a byte at a time", async () => {
		expect(await extract(literalsOf(picture).file())).toEqual(
			normalised(picture),
		);
	});

	it("carries a colour map of its own", async () => {
		const palette: Buffer = Buffer.alloc(1024, 0);
		for (let index = 0; index < 256; index += 1) {
			palette[index * 4] = index;
			palette[index * 4 + 1] = 255 - index;
			palette[index * 4 + 2] = index ^ 0x5a;
		}
		const indexed = writeBmp8Palette(
			4,
			2,
			Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
			palette,
		);
		expect(await extract(literalsOf(indexed).file())).toEqual(
			normalised(indexed),
		);
	});

	it("copies what it has just written when a run overlaps itself", async () => {
		const writer = new GamWriter();
		for (const byte of picture.subarray(0, 54)) writer.literal(byte);
		writer.literal(1).literal(2).literal(3);
		writer.run(3, 6);
		for (let at = 63; at < picture.length; at += 1) {
			writer.literal(picture[at] ?? 0);
		}
		const expected: Buffer = Buffer.from(picture);
		expected[54] = 1;
		expected[55] = 2;
		expected[56] = 3;
		for (let at = 57; at < 63; at += 1) {
			expected[at] = expected[at - 3] ?? 0;
		}
		expect(await extract(writer.file())).toEqual(normalised(expected));
	});

	it("reaches back a whole window, onto the slot it writes", async () => {
		// A picture whose bytes repeat every window from the three hundred and tenth on, so that a run of a
		// whole window reproduces them exactly.
		const wide: Buffer = Buffer.alloc(16 * 8 * 3, 0);
		for (let index = 0; index < wide.length; index += 1) {
			wide[index] = index & 0xff;
		}
		const repeated = writeBmp24(16, 8, wide);
		const writer = new GamWriter();
		for (const byte of repeated.subarray(0, 310)) writer.literal(byte);
		writer.run(0x100, repeated.length - 310);
		expect(await extract(writer.file())).toEqual(normalised(repeated));
	});

	it("unfolds a stream of its own for the place a window holds", () => {
		// Three bytes of control word and a run of a whole window over nothing but zeroes.
		const writer = new GamWriter();
		writer.literal(0x5a).run(0x100, 4);
		expect(unpackGam(writer.file(), 5).toString("hex")).toBe("5a00000000");
	});

	it("stops where the stream ends and refuses a picture cut short", async () => {
		const whole: Buffer = literalsOf(picture).file();
		const cut: Buffer = whole.subarray(0, whole.length - 40);
		await expect(extract(cut)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("reads a bitmap whose header is longer than the one it writes", async () => {
		// The same picture, with a header of a hundred and eight bytes and the pixels moved behind it, which
		// the reference reaches by unfolding on demand.
		const shorter = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const header: Buffer = Buffer.alloc(14 + 108, 0);
		shorter.copy(header, 0, 0, 14);
		header.writeUInt32LE(14 + 108 + 8, 2);
		header.writeUInt32LE(14 + 108, 10);
		header.writeUInt32LE(108, 14);
		shorter.copy(header, 14, 14, 54);
		const pixels = shorter.subarray(54);
		const longer: Buffer = Buffer.concat([
			header,
			Buffer.alloc(108 - 40, 0),
			pixels,
		]);
		expect(await extract(literalsOf(longer).file())).toEqual(
			normalised(longer),
		);
	});

	it("reports the colour of an indexed bitmap", async () => {
		const palette = paletteTriples(Buffer.alloc(1024, 0x40));
		const indexed = writeBmp8Palette(2, 2, Buffer.from([0, 1, 2, 3]), palette);
		const handle = await projectMyuGamImageFormat.open(
			sourceOf(literalsOf(indexed).file()),
			"cg.gam",
		);
		expect(handle.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 8 });
	});
});
