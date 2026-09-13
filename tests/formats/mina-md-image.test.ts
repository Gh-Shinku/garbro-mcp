import { inflateLzss } from "@garbro-mcp/codecs";
import { BufferByteSource } from "@garbro-mcp/core";
import { mdImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PREFIX_SIZE = 0xa;
const BMP_HEADER_SIZE = 54;

interface Built {
	file: Buffer;
	bitmap: Buffer;
	width: number;
	height: number;
}

/** A minimal 24 bit bitmap: header, then the pixel rows verbatim. */
function buildBmp(width = 0x10, height = 0x8): Buffer {
	const pixels: Buffer = Buffer.alloc(width * 3 * height, 0x7e);
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BMP_HEADER_SIZE + pixels.length, 2);
	header.writeUInt32LE(BMP_HEADER_SIZE, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(24, 28);
	header.writeUInt32LE(0, 30);
	header.writeUInt32LE(pixels.length, 34);
	return Buffer.concat([header, pixels]);
}

/** One encoder decision; each one consumes exactly one control bit. */
type Item = { literal: number } | { match: { count: number; offset: number } };

/**
 * Packs items the way the decoder reads them: a control byte whose bits are consumed from the lowest
 * up, then one literal byte per set bit, or a two byte back reference per clear bit. A literal is a
 * single byte, which is what the control bits count, not a group of eight.
 */
function lzssStream(items: Item[]): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < items.length; i += 8) {
		const group = items.slice(i, i + 8);
		let control = 0;
		for (let index = 0; index < group.length; index += 1) {
			const item = group[index];
			if (item && "literal" in item) control |= 1 << index;
		}
		parts.push(Buffer.from([control]));
		for (const item of group) {
			if ("literal" in item) {
				parts.push(Buffer.from([item.literal]));
			} else {
				parts.push(
					Buffer.from([
						item.match.offset & 0xff,
						((((item.match.offset >> 8) & 0x0f) << 4) |
							((item.match.count - 3) & 0x0f)) &
							0xff,
					]),
				);
			}
		}
	}
	return Buffer.concat(parts);
}

/** Encodes bytes as LZSS literals only: the degenerate case of the format. */
function lzssLiterals(data: Buffer): Buffer {
	const items: Item[] = [];
	for (const byte of data) items.push({ literal: byte });
	return lzssStream(items);
}

/** Emits a literal prefix, one back reference, then the remaining literals. */
function lzssWithMatch(
	prefix: Buffer,
	count: number,
	offset: number,
	rest: Buffer,
): Buffer {
	const items: Item[] = [];
	for (const byte of prefix) items.push({ literal: byte });
	items.push({ match: { count, offset } });
	for (const byte of rest) items.push({ literal: byte });
	return lzssStream(items);
}

/** The MD container: the tag, eight skipped bytes and the compressed bitmap. */
function buildMd(bitmap: Buffer, stream?: Buffer): Built {
	const head = Buffer.alloc(PREFIX_SIZE, 0x5a);
	head.write("MD", 0, "latin1");
	const body = stream ?? lzssLiterals(bitmap);
	return {
		file: Buffer.concat([head, body]),
		bitmap,
		width: bitmap.readInt32LE(18),
		height: bitmap.readInt32LE(22),
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("mina md bitmap", () => {
	it("declares the MD signature for the registry", () => {
		expect(mdImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("MD", "ascii") },
		]);
	});

	it("decompresses the bitmap and reports its header", async () => {
		const built = buildMd(buildBmp());
		const source = sourceOf(built.file);
		expect(await mdImageFormat.detect(source, "CG01.MD")).toBe(true);
		const archive = await mdImageFormat.open(source, "CG01.MD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x10,
				height: 0x8,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: 0x10,
				height: 0x8,
				bitsPerPixel: 24,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(built.bitmap);
		} finally {
			await archive.close();
		}
	});

	it("follows a back reference into earlier literals", async () => {
		// The bitmap repeats the first three bytes of the file in its pixel data, which the encoder emits
		// as one match item pointing back at those literals; the ring buffer has wrapped by then, which is
		// exactly the behaviour this exercises.
		const plain: Buffer = Buffer.alloc(BMP_HEADER_SIZE + 0x20, 0x7e);
		plain.write("BM", 0, "latin1");
		plain.writeUInt32LE(plain.length, 2);
		plain.writeUInt32LE(BMP_HEADER_SIZE, 10);
		plain.writeUInt32LE(40, 14);
		plain.writeInt32LE(0x10, 18);
		plain.writeInt32LE(0x8, 22);
		plain.writeUInt16LE(1, 26);
		plain.writeUInt16LE(24, 28);
		plain.writeUInt32LE(0x20, 34);
		plain[BMP_HEADER_SIZE + 8] = 0x42;
		plain[BMP_HEADER_SIZE + 9] = 0x4d;
		plain[BMP_HEADER_SIZE + 10] = 0x56;
		const stream = lzssWithMatch(
			plain.subarray(0, BMP_HEADER_SIZE + 8),
			3,
			0xfee,
			plain.subarray(BMP_HEADER_SIZE + 11),
		);
		// The hand written stream must reproduce the bitmap exactly.
		expect(inflateLzss(stream, { outputLength: plain.length })).toEqual(plain);
		const built = buildMd(plain, stream);
		const archive = await mdImageFormat.open(sourceOf(built.file), "CG02.MD");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("trims the payload to the length the bitmap states", async () => {
		const bitmap = buildBmp(4, 2);
		const stream = lzssLiterals(Buffer.concat([bitmap, Buffer.alloc(8, 0x99)]));
		const built = buildMd(bitmap, stream);
		const archive = await mdImageFormat.open(sourceOf(built.file), "CG03.MD");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(bitmap);
			expect(output.length).toBe(bitmap.length);
		} finally {
			await archive.close();
		}
	});

	it("declines a payload that is not a bitmap", async () => {
		const bmp = buildBmp();
		const notBmp = Buffer.from(bmp);
		notBmp.write("XX", 0, "latin1");
		const built = buildMd(bmp, lzssLiterals(notBmp));
		expect(await mdImageFormat.detect(sourceOf(built.file), "CG01.MD")).toBe(
			false,
		);
	});

	it("declines a file without the tag", async () => {
		const built = buildMd(buildBmp());
		built.file[0] = 0x4e;
		expect(await mdImageFormat.detect(sourceOf(built.file), "CG01.MD")).toBe(
			false,
		);
	});

	it("declines a file that holds nothing but the prefix", async () => {
		const built = buildMd(buildBmp());
		expect(
			await mdImageFormat.detect(
				sourceOf(built.file.subarray(0, PREFIX_SIZE)),
				"CG01.MD",
			),
		).toBe(false);
	});

	it("declines a truncated stream", async () => {
		const built = buildMd(buildBmp());
		expect(
			await mdImageFormat.detect(
				sourceOf(built.file.subarray(0, PREFIX_SIZE + 12)),
				"CG01.MD",
			),
		).toBe(false);
	});
});
