import { BufferByteSource } from "@garbro-mcp/core";
import { unhImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x18;
const DATA_OFFSET = 0x44;

interface UnhOptions {
	width?: number;
	height?: number;
	version?: number;
	marker?: string;
	headerSize?: number;
	/** The word stream, which the builder places at the data offset. */
	stream?: Buffer;
}

function buildUnh(options: UnhOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	header.write(options.marker ?? "UNH0", 0, "latin1");
	if (header.length >= HEADER_SIZE) {
		header.writeInt32LE(options.version ?? 1, 4);
		header.writeUInt32LE(options.width ?? 4, 0x10);
		header.writeUInt32LE(options.height ?? 1, 0x14);
	}
	const body: Buffer = Buffer.alloc(
		Math.max(0, DATA_OFFSET - header.length),
		0x00,
	);
	return Buffer.concat([header, body, options.stream ?? Buffer.alloc(0)]);
}

/** One literal word behind a control byte whose bits are clear. */
function literals(words: number[]): Buffer {
	const parts: Buffer[] = [];
	for (let index = 0; index < words.length; index += 8) {
		const group = words.slice(index, index + 8);
		const words_: Buffer[] = [Buffer.from([0x00])];
		for (const word of group) {
			const bytes: Buffer = Buffer.alloc(2);
			bytes.writeUInt16LE(word, 0);
			words_.push(bytes);
		}
		parts.push(...words_);
	}
	return Buffer.concat(parts);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.unh"): Promise<Buffer> {
	const archive = await unhImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/**
 * The first `count` sixteen bit pixels of a bitmap, which begin behind the header and its masks. Rows are padded
 * to four bytes, so a caller that wants the pixels has to say how many there are.
 */
function pixelsOf(bmp: Buffer, count: number): number[] {
	const values: number[] = [];
	for (let index = 0; index < count; index += 1)
		values.push(bmp.readUInt16LE(66 + index * 2));
	return values;
}

describe("MyHarvest image", () => {
	it("needs the marker and a version word of one", async () => {
		expect(await unhImageFormat.detect(sourceOf(buildUnh()), "A.unh")).toBe(
			true,
		);
		for (const options of [
			{ marker: "UNH1" },
			{ version: 0 },
			{ version: 2 },
			{ headerSize: 0x10 },
		]) {
			expect(
				await unhImageFormat.detect(sourceOf(buildUnh(options)), "A.unh"),
			).toBe(false);
		}
	});

	it("takes the size from the header and reports sixteen bits", async () => {
		const archive = await unhImageFormat.open(
			sourceOf(buildUnh({ width: 7, height: 5 })),
			"A.unh",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 7,
				height: 5,
				bitsPerPixel: 16,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 7,
				height: 5,
			});
		} finally {
			await archive.close();
		}
	});

	it("writes literal words as they are", async () => {
		const words = [0x1234, 0x5678, 0x9abc, 0xdef0];
		const output = await extract(
			buildUnh({ width: 4, height: 1, stream: literals(words) }),
		);
		expect(output.readUInt16LE(28)).toBe(16);
		// The reference hands this image over unflipped, in five six five order.
		expect(output.readInt32LE(22)).toBe(-1);
		// The masks say five six five: red starts at bit eleven, not at the ten a five five five bitmap uses.
		expect(output.readUInt32LE(54)).toBe(0xf800);
		expect(pixelsOf(output, 4)).toEqual(words);
	});

	it("copies a run out of the window the image itself provides", async () => {
		// The first token is a literal and the second a match: a length word of one means an offset of zero and
		// three words to copy. The copy overlaps what it has just written, which is what the reference's own ring
		// does when a match starts a word behind its write position.
		const stream: Buffer = Buffer.concat([
			Buffer.from([0x02]),
			Buffer.from([0x34, 0x12]),
			Buffer.from([0x01, 0x00]),
		]);
		const output = await extract(buildUnh({ width: 4, height: 1, stream }));
		expect(pixelsOf(output, 4)).toEqual([0x1234, 0x1234, 0x1234, 0x1234]);
	});

	it("takes eight tokens from every control byte, least significant bit first", async () => {
		// Nine words: one control byte of eight clear bits and a second whose lowest bit is a literal too.
		const stream: Buffer = Buffer.concat([
			literals([1, 2, 3, 4, 5, 6, 7, 8]),
			Buffer.from([0x00, 0x09, 0x00]),
		]);
		const output = await extract(buildUnh({ width: 9, height: 1, stream }));
		expect(pixelsOf(output, 9)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it("leaves the rest blank when a control byte is missing, but refuses a half read word", async () => {
		// Eight literals fill one control byte; the next control byte is not there, so the ninth pixel stays
		// blank rather than the file being called broken.
		const short = buildUnh({
			width: 9,
			height: 1,
			stream: literals([1, 2, 3, 4, 5, 6, 7, 8]),
		});
		expect(pixelsOf(await extract(short), 9)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 0,
		]);
		// A word the file does not hold is what the reference's own reader fails on.
		const half = buildUnh({
			width: 3,
			height: 1,
			stream: Buffer.from([0x00, 0x11, 0x22, 0x33]),
		});
		await expect(extract(half)).rejects.toThrow();
	});

	it("refuses a run that would not fit in the image", async () => {
		// One match word with the longest length its nibble allows, in a one pixel image.
		const stream: Buffer = Buffer.from([0x01, 0x0f, 0x00]);
		await expect(
			extract(buildUnh({ width: 1, height: 1, stream })),
		).rejects.toThrow();
	});

	it("names the entry after the bitmap and reports its depth", async () => {
		const archive = await unhImageFormat.open(
			sourceOf(buildUnh({ width: 2, height: 2 })),
			"sub/CG_10.unh",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_10.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
