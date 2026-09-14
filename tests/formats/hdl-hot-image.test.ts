import { BufferByteSource } from "@garbro-mcp/core";
import { hotImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x20;
/** A sixteen bit bitmap with `BI_BITFIELDS` starts its pixels at sixty six. */
const BMP_16_DATA_OFFSET = 66;
const REPEAT_FLAG = 0x8000;

type Token = { colour: number; run?: number };

function emit(tokens: Token[]): Buffer {
	const parts: Buffer[] = [];
	for (const token of tokens) {
		if (token.run === undefined) {
			const word: Buffer = Buffer.alloc(2);
			word.writeUInt16LE(token.colour & 0xffff, 0);
			parts.push(word);
			continue;
		}
		const word: Buffer = Buffer.alloc(2);
		word.writeUInt16LE((token.colour & 0x7fff) | REPEAT_FLAG, 0);
		parts.push(word, Buffer.from([token.run & 0xff]));
	}
	return Buffer.concat(parts);
}

function buildHot(options: {
	width: number;
	height: number;
	tokens: Buffer;
	flagByte?: number;
	tail?: number;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("HOT", 0, "latin1");
	header[7] = options.flagByte ?? 0x21;
	header.writeUInt16LE(options.width, 0x0c);
	header.writeUInt16LE(options.height, 0x0e);
	return Buffer.concat([
		header,
		options.tokens,
		Buffer.alloc(options.tail ?? 0, 0x5a),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await hotImageFormat.open(sourceOf(stored), "CG01.HOT");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("hdl hot image", () => {
	it("declares the HOT signature and no extension", () => {
		expect(hotImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("HOT\0", "latin1") },
		]);
		expect(hotImageFormat.descriptor.extensions).toEqual([]);
	});

	it("writes a 555 bitmap of literal words", async () => {
		const tokens = emit([
			{ colour: 0x7c00 },
			{ colour: 0x03e0 },
			{ colour: 0x001f },
			{ colour: 0x0000 },
		]);
		const stored = buildHot({ width: 2, height: 2, tokens });
		const source = sourceOf(stored);
		expect(await hotImageFormat.detect(source, "CG01.HOT")).toBe(true);
		const archive = await hotImageFormat.open(source, "CG01.HOT");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "hot-rle",
				width: 2,
				height: 2,
				bitsPerPixel: 15,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(16);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.readUInt32LE(10)).toBe(BMP_16_DATA_OFFSET);
		// Fifteen bit words: the masks say 555, not 565.
		expect(output.readUInt32LE(54)).toBe(0x7c00);
		expect(output.readUInt32LE(58)).toBe(0x03e0);
		expect(output.readUInt32LE(62)).toBe(0x001f);
		expect(output.subarray(BMP_16_DATA_OFFSET)).toEqual(
			Buffer.from([0x00, 0x7c, 0xe0, 0x03, 0x1f, 0x00, 0x00, 0x00]),
		);
	});

	it("repeats a colour marked by the top bit", async () => {
		// The high bit is the repeat flag and is not part of the colour, which the mask strips.
		const tokens = emit([{ colour: 0x1234 }, { colour: 0x7abc, run: 3 }]);
		const stored = buildHot({ width: 4, height: 1, tokens });
		const output = await extract(stored);
		const body = output.subarray(BMP_16_DATA_OFFSET);
		expect(body.readUInt16LE(0)).toBe(0x1234);
		for (let i = 1; i < 4; i += 1)
			expect(body.readUInt16LE(i * 2)).toBe(0x7abc);
	});

	it("stops at the end of a truncated stream", async () => {
		// Two of four pixels are stored; the rest stay zero because the outer loop ends at the stream.
		const tokens = emit([{ colour: 0x1111 }, { colour: 0x2222 }]);
		const stored = buildHot({ width: 2, height: 2, tokens });
		const output = await extract(stored);
		expect(output.subarray(BMP_16_DATA_OFFSET)).toEqual(
			Buffer.from([0x11, 0x11, 0x22, 0x22, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("fails when a repeat passes the end of the image", async () => {
		// One literal and then four more pixels in a two by two image, so the inner loop indexes past the end
		// of the pixel array. A repeat that merely fills the image exactly is fine; the outer loop is what
		// keeps it from starting when there is no room left.
		const tokens = emit([{ colour: 0x0101 }, { colour: 0x0202, run: 4 }]);
		const stored = buildHot({ width: 2, height: 2, tokens });
		const source = sourceOf(stored);
		expect(await hotImageFormat.detect(source, "CG01.HOT")).toBe(true);
		const archive = await hotImageFormat.open(source, "CG01.HOT");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("fails on an odd trailing byte", async () => {
		// The loop asks only whether one byte remains before reading a word.
		const tokens = Buffer.concat([
			emit([{ colour: 0x0202 }, { colour: 0x0303 }]),
			Buffer.from([0x44]),
		]);
		const stored = buildHot({ width: 4, height: 1, tokens });
		// Two pixels are stored, the third word is cut short by the trailing byte.

		const archive = await hotImageFormat.open(sourceOf(stored), "CG01.HOT");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a header whose flag bits are not both set", async () => {
		const tokens = emit([{ colour: 0x0001 }]);
		for (const flag of [0x20, 0x01, 0x00, 0x41]) {
			const stored = buildHot({ width: 1, height: 1, tokens, flagByte: flag });
			expect(await hotImageFormat.detect(sourceOf(stored), "CG01.HOT")).toBe(
				false,
			);
		}
		const accepted = buildHot({ width: 1, height: 1, tokens, flagByte: 0x31 });
		expect(await hotImageFormat.detect(sourceOf(accepted), "CG01.HOT")).toBe(
			true,
		);
	});

	it("declines a short file, a wrong signature and zero dimensions", async () => {
		const tokens = emit([{ colour: 0x0001 }]);
		const stored = buildHot({ width: 1, height: 1, tokens });
		expect(
			await hotImageFormat.detect(sourceOf(stored.subarray(0, 31)), "CG01.HOT"),
		).toBe(false);
		const wrong = buildHot({ width: 1, height: 1, tokens });
		wrong[2] = 0x58;
		expect(await hotImageFormat.detect(sourceOf(wrong), "CG01.HOT")).toBe(
			false,
		);
		const zero = buildHot({ width: 0, height: 1, tokens });
		expect(await hotImageFormat.detect(sourceOf(zero), "CG01.HOT")).toBe(false);
		// The reference's signature is the word 0x00544F48, so the fourth byte has to be a null too.
		const wrongNull = buildHot({ width: 1, height: 1, tokens });
		wrongNull[3] = 0x58;
		expect(await hotImageFormat.detect(sourceOf(wrongNull), "CG01.HOT")).toBe(
			false,
		);
	});
});
