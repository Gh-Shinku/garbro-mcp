import { BufferByteSource } from "@garbro-mcp/core";
import { tinkerbellTb1ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;
const DATA_OFFSET = 0x18;

/** The stream is held inverted, so an encoder complements every byte it writes. */
function invert(byte: number): number {
	return ~byte & 0xff;
}

function invertWord(word: number): number {
	return ~word & 0xffff;
}

/**
 * Emits tokens, a control byte for every eight of them with its bits read from the most significant one down: a
 * number is a literal and a pair is a match of `[offset, count]`.
 */
function emit(tokens: Array<number | [number, number]>): Buffer {
	const output: number[] = [];
	for (let start = 0; start < tokens.length; start += 8) {
		const group = tokens.slice(start, start + 8);
		let bits = 0;
		const body: number[] = [];
		group.forEach((token, index) => {
			if (typeof token === "number") {
				bits |= 0x80 >> index;
				body.push(invert(token));
				return;
			}
			const word =
				(((token[0] & 0xfff) << 4) | ((token[1] - 3) & 0xf)) & 0xffff;
			bits |= 0;
			body.push(invertWord(word) & 0xff, (invertWord(word) >> 8) & 0xff);
		});
		output.push(invert(bits), ...body);
	}
	return Buffer.from(output);
}

function buildTb1(options: {
	width: number;
	height: number;
	body?: Buffer;
	marker?: string;
	variant?: string;
	bitsPerPixel?: number;
	tail?: number;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "LEAF", 0, "latin1");
	header.write(options.variant ?? "64K", 4, "latin1");
	header.writeUInt16LE(options.width, 0xc);
	header.writeUInt16LE(options.height, 0xe);
	header.writeUInt16LE(options.bitsPerPixel ?? 24, 0x10);
	const body =
		options.body ??
		emit(
			Array.from(
				{ length: options.width * options.height * 3 },
				(_, index) => index & 0xff,
			),
		);
	return Buffer.concat([
		header,
		Buffer.alloc(DATA_OFFSET - HEADER_SIZE, 0x00),
		body,
		Buffer.alloc(options.tail ?? 0, 0x5a),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.TB1"): Promise<Buffer> {
	const archive = await tinkerbellTb1ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("TinkerBell image", () => {
	it("declares the LEAF marker and no extension", async () => {
		expect(tinkerbellTb1ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("LEAF", "latin1") },
		]);
		expect(tinkerbellTb1ImageFormat.descriptor.extensions).toEqual([]);
		expect(
			await tinkerbellTb1ImageFormat.detect(
				sourceOf(buildTb1({ width: 2, height: 1 })),
				"A.TB1",
			),
		).toBe(true);
	});

	it("needs the 64K variant and twenty four bits a pixel", async () => {
		expect(
			await tinkerbellTb1ImageFormat.detect(
				sourceOf(buildTb1({ width: 2, height: 1, variant: "65K" })),
				"A.TB1",
			),
		).toBe(false);
		expect(
			await tinkerbellTb1ImageFormat.detect(
				sourceOf(buildTb1({ width: 2, height: 1, bitsPerPixel: 32 })),
				"A.TB1",
			),
		).toBe(false);
		expect(
			await tinkerbellTb1ImageFormat.detect(
				sourceOf(buildTb1({ width: 2, height: 1, bitsPerPixel: 8 })),
				"A.TB1",
			),
		).toBe(false);
		expect(
			await tinkerbellTb1ImageFormat.detect(
				sourceOf(
					buildTb1({ width: 2, height: 1, marker: "LEAF".replace("F", "G") }),
				),
				"A.TB1",
			),
		).toBe(false);
		expect(
			await tinkerbellTb1ImageFormat.detect(
				sourceOf(
					buildTb1({ width: 2, height: 1 }).subarray(0, HEADER_SIZE - 1),
				),
				"A.TB1",
			),
		).toBe(false);
	});

	it("describes a twenty four bit image", async () => {
		const archive = await tinkerbellTb1ImageFormat.open(
			sourceOf(buildTb1({ width: 3, height: 2 })),
			"CG01.TB1",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "inverted-lzss",
			});
		} finally {
			await archive.close();
		}
	});

	it("reads inverted literals into a bottom up bitmap", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18]);
		const output = await extract(
			buildTb1({ width: 2, height: 2, body: emit([...pixels]) }),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		// `ImageData.CreateFlipped` stores the rows bottom up, so the height is positive.
		expect(output.readInt32LE(22)).toBe(2);
		// Two pixels a row are padded from six bytes to eight.
		expect(output.subarray(54, 62)).toEqual(
			Buffer.concat([pixels.subarray(0, 6), Buffer.alloc(2)]),
		);
		expect(output.subarray(62, 70)).toEqual(
			Buffer.concat([pixels.subarray(6), Buffer.alloc(2)]),
		);
	});

	it("repeats the window a match points at", async () => {
		// One literal, then a match of five bytes at the position the literal was written to.
		const output = await extract(
			buildTb1({ width: 5, height: 1, body: emit([0x41, [0xfee, 5]]) }),
		);
		expect(output.subarray(54, 54 + 5)).toEqual(
			Buffer.from([0x41, 0x41, 0x41, 0x41, 0x41]),
		);
	});

	it("clamps a long match to the buffer it writes into", async () => {
		// A literal and then a match of eighteen bytes, the longest a token can ask for: the image is one row of
		// six bytes, so five of the eighteen are copied and the loop stops at the end of the buffer.
		const body = emit([0x41, [0xfee, 18]]);
		const output = await extract(buildTb1({ width: 2, height: 1, body }));
		expect(output.readInt32LE(22)).toBe(1);
		expect(output.subarray(54, 62)).toEqual(
			Buffer.concat([Buffer.alloc(6, 0x41), Buffer.alloc(2)]),
		);
	});

	it("reads past the end of a short body as the reference does", async () => {
		// A control byte promising eight literals and no body at all: every read answers -1, whose complement is
		// zero, so the image comes out blank rather than failing.
		const blank = await extract(
			buildTb1({ width: 2, height: 1, body: emit([]) }),
		);
		expect(blank.subarray(54, 60)).toEqual(Buffer.alloc(6));
		// One literal and then a match with no word behind it: the missing word complements to zero, which is an
		// offset of zero and a count of three, so the window's zeroes are copied.
		const short = await extract(
			buildTb1({ width: 4, height: 1, body: emit([0x7f]) }),
		);
		expect(short.subarray(54, 58)).toEqual(
			Buffer.from([0x7f, 0x00, 0x00, 0x00]),
		);
	});

	it("names the entry after the image", async () => {
		const archive = await tinkerbellTb1ImageFormat.open(
			sourceOf(buildTb1({ width: 2, height: 1 })),
			"sub/CG07.TB1",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.compressed).toBe(true);
		} finally {
			await archive.close();
		}
	});
});
