import { BufferByteSource } from "@garbro-mcp/core";
import { lzBmpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x53, 0x5a, 0x44, 0x44]);
const STREAM_OFFSET = 0x0e;
const BMP_HEADER_SIZE = 54;

/** A token whose match count is three, which is all the fixture needs. */
type Item = number | "match";

/**
 * Emits a GARbro LZSS stream: one control byte per eight items, a set bit meaning a literal byte that follows
 * and a clear bit meaning a two byte match token. A match token's offset is `((high & 0xF0) << 4) | low` and
 * its count is `3 + (high & 0x0F)`, so the token below reads three bytes from ring buffer index `0x800`.
 *
 * That index is deliberately far from both ends: the frame is `0x1000` bytes and only a little over fifty are
 * written, so index `0x800` still holds the pre-fill. The pixel bytes therefore come out as the reference's
 * fill byte, which is what makes the non-default settings observable — the default fill of zero would produce
 * zeros here. Index zero does *not* work: the write position starts at `0xFF0`, so the first sixteen literals
 * wrap around and overwrite the low addresses.
 */
function emit(items: Item[]): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < items.length; i += 8) {
		const chunk = items.slice(i, i + 8);
		let control = 0;
		const body: Buffer[] = [];
		chunk.forEach((item, bit) => {
			// Offset 0x800, count 3: low byte zero, high nibble 0x8 in the high byte.
			if (item === "match") body.push(Buffer.from([0x00, 0x80]));
			else {
				control |= 1 << bit;
				body.push(Buffer.from([item]));
			}
		});
		parts.push(Buffer.from([control]), ...body);
	}
	return Buffer.concat(parts);
}

/** A twenty four bit bitmap of three two-pixel rows, the shape the fixture compresses. */
function buildBmp(): Buffer {
	const stride = 8;
	const fileSize = BMP_HEADER_SIZE + stride * 3;
	const bmp: Buffer = Buffer.alloc(fileSize, 0x00);
	bmp.write("BM", 0, "latin1");
	bmp.writeUInt32LE(fileSize, 2);
	bmp.writeUInt32LE(BMP_HEADER_SIZE, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(2, 18);
	bmp.writeInt32LE(3, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(24, 28);
	bmp.writeUInt32LE(stride * 3, 34);
	return bmp;
}

/** The header as literals, then the twenty four pixel bytes as eight three byte matches. */
function buildSzdd(junkHeader = false): Buffer {
	const header = buildBmp();
	const items: Item[] = [...header.subarray(0, BMP_HEADER_SIZE)];
	for (let i = 0; i < 8; i += 1) items.push("match");
	const szdd: Buffer = Buffer.alloc(STREAM_OFFSET, 0x00);
	SIGNATURE.copy(szdd, 0);
	if (junkHeader) szdd.fill(0xa5, 4, STREAM_OFFSET);
	return Buffer.concat([szdd, emit(items)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("misc lz bmp image", () => {
	it("declares the SZDD signature and four extensions", () => {
		expect(lzBmpImageFormat.descriptor.extensions).toEqual([
			"bm_",
			"gpp",
			"meh",
			"gr_",
		]);
	});

	it("decompresses a bitmap", async () => {
		const stored = buildSzdd();
		const source = sourceOf(stored);
		expect(await lzBmpImageFormat.detect(source, "CG01.BM_")).toBe(true);
		const archive = await lzBmpImageFormat.open(source, "CG01.BM_");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "szdd-lzss",
				width: 2,
				height: 3,
				bitsPerPixel: 24,
				frameFill: 0x20,
				frameInitPosition: 0xff0,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(buildBmp().length);
			expect(output.subarray(0, BMP_HEADER_SIZE)).toEqual(
				buildBmp().subarray(0, BMP_HEADER_SIZE),
			);
			// The pixel bytes come from an untouched part of the ring buffer, so they are the reference's
			// pre-fill byte rather than zeros.
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(Buffer.alloc(24, 0x20));
		} finally {
			await archive.close();
		}
	});

	it("ignores every field of the SZDD header", async () => {
		// The reference skips all fourteen bytes without reading them.
		const stored = buildSzdd(true);
		expect(stored.subarray(4, STREAM_OFFSET)).toEqual(Buffer.alloc(10, 0xa5));
		const archive = await lzBmpImageFormat.open(sourceOf(stored), "CG01.BM_");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				await (async () => {
					const other = await lzBmpImageFormat.open(
						sourceOf(buildSzdd()),
						"CG01.BM_",
					);
					try {
						const inner = other.entries[0];
						if (!inner) throw new Error("missing entry");
						return consumeBuffer(await other.openEntry(inner.id));
					} finally {
						await other.close();
					}
				})(),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a stream that is not a bitmap", async () => {
		const items: Item[] = [
			...Buffer.from("this is not a bitmap at all", "latin1"),
		];
		const stored = Buffer.concat([
			Buffer.concat([SIGNATURE, Buffer.alloc(STREAM_OFFSET - 4)]),
			emit(items),
		]);
		expect(await lzBmpImageFormat.detect(sourceOf(stored), "CG01.BM_")).toBe(
			false,
		);
	});

	it("declines a wrong signature and a short file", async () => {
		const wrong = buildSzdd();
		wrong[3] = 0x45;
		expect(await lzBmpImageFormat.detect(sourceOf(wrong), "CG01.BM_")).toBe(
			false,
		);
		expect(
			await lzBmpImageFormat.detect(
				sourceOf(buildSzdd().subarray(0, STREAM_OFFSET - 1)),
				"CG01.BM_",
			),
		).toBe(false);
	});

	it("declines zero dimensions", async () => {
		const header = buildBmp();
		header.writeInt32LE(0, 22);
		const items: Item[] = [...header.subarray(0, BMP_HEADER_SIZE)];
		const stored = Buffer.concat([
			Buffer.concat([SIGNATURE, Buffer.alloc(STREAM_OFFSET - 4)]),
			emit(items),
		]);
		expect(await lzBmpImageFormat.detect(sourceOf(stored), "CG01.BM_")).toBe(
			false,
		);
	});
});
