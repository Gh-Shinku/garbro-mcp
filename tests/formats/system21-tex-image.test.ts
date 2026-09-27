import { BufferByteSource } from "@garbro-mcp/core";
import { texImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const SIGNATURE = Buffer.from("SZDD", "ascii");
const STREAM_OFFSET = 0x0e;
const DDS_PREFIX = 4;
const DDS_HEADER_SIZE = 128;
const DDS_MARKER = "DDS ";

type Item = number | "match";

/**
 * The SZDD stream the reference's codec reads: one control byte per eight items, a set bit meaning a literal
 * byte and a clear bit a two byte match token. A match token's offset is `((high & 0xF0) << 4) | low` and its
 * count is `3 + (high & 0x0F)`, so `00 80` reads three bytes from ring buffer index 0x800 — far from both the
 * write position at 0xFF0 and the bytes written after it, so those three bytes are whatever the ring buffer was
 * pre-filled with.
 */
function emit(items: Item[]): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < items.length; i += 8) {
		const group = items.slice(i, i + 8);
		let control = 0;
		const body: Buffer[] = [];
		for (let bit = 0; bit < group.length; bit += 1) {
			const item = group[bit];
			if (item === "match") {
				body.push(Buffer.from([0x00, 0x80]));
				continue;
			}
			control |= 1 << bit;
			body.push(Buffer.from([(item ?? 0) & 0xff]));
		}
		parts.push(Buffer.from([control]), ...body);
	}
	return Buffer.concat(parts);
}

function lzssLiterals(data: Buffer): Buffer {
	return emit([...data]);
}

/** An SZDD file: fourteen header bytes, which the reference seeks past, then the stream. */
function buildSzdd(stream: Buffer, header?: Buffer): Buffer {
	const prefix = header ?? Buffer.alloc(STREAM_OFFSET, 0x00);
	SIGNATURE.copy(prefix, 0);
	return Buffer.concat([prefix, stream]);
}

/** A DirectDraw surface header: the magic and a hundred and twenty four byte header. */
function buildDds(options: {
	width: number;
	height: number;
	fourCC?: string;
	bitCount?: number;
}): Buffer {
	const dds: Buffer = Buffer.alloc(DDS_HEADER_SIZE, 0x00);
	dds.write(DDS_MARKER, 0, "latin1");
	dds.writeUInt32LE(DDS_HEADER_SIZE - 4, 4);
	dds.writeUInt32LE(0x0002100f, 8);
	dds.writeUInt32LE(options.height, 12);
	dds.writeUInt32LE(options.width, 16);
	// The flags of the surface and the places of its colour stand where the head of a surface of the engine
	// holds them: four letters of a kind of block stand of the flag of such a kind at 0x50.
	if (options.fourCC) {
		dds.writeUInt32LE(0x4, 0x50);
		dds.write(options.fourCC.padEnd(4, "\0"), 0x54, "latin1");
	} else {
		dds.writeUInt32LE(0x41, 0x50);
		dds.writeUInt32LE(options.bitCount ?? 0, 0x58);
		dds.writeUInt32LE(0x00ff0000, 0x5c);
		dds.writeUInt32LE(0x0000ff00, 0x60);
		dds.writeUInt32LE(0x000000ff, 0x64);
		dds.writeUInt32LE(0xff000000, 0x68);
	}
	return dds;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

/** A surface of the engine whose places stand of four places of a colour to a pixel, blue first. */
function completeDds(width: number, height: number, pixels: Buffer): Buffer {
	return Buffer.concat([buildDds({ width, height, bitCount: 32 }), pixels]);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await texImageFormat.open(sourceOf(stored), "TEX01.TEX");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("system21 tex texture", () => {
	it("declares the SZDD signature and no extension", () => {
		expect(texImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("SZDD");
		expect(texImageFormat.descriptor.extensions).toEqual([]);
	});

	it("unpacks a surface and drops the four byte prefix", async () => {
		const dds = completeDds(2, 1, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
		const surface = Buffer.concat([Buffer.alloc(DDS_PREFIX, 0xee), dds]);
		const stored = buildSzdd(lzssLiterals(surface));
		const source = sourceOf(stored);
		expect(await texImageFormat.detect(source, "TEX01.TEX")).toBe(true);
		const archive = await texImageFormat.open(source, "TEX01.TEX");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["TEX01.dds"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			// The extraction is decompressed, so its length is not the stored length.
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "dds",
				compression: "szdd",
				width: 2,
				height: 1,
			});
		} finally {
			await archive.close();
		}
		// The places of the surface stand behind the four words of the prefix, and the picture stands handed
		// over as a bitmap of four places of a colour.
		const picture = readBmpImage(await extract(stored));
		expect(picture).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		expect([...(picture?.pixels ?? [])]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("reports the depth of an uncompressed surface", async () => {
		const dds = buildDds({ width: 64, height: 32, bitCount: 24 });
		const surface = Buffer.concat([Buffer.alloc(DDS_PREFIX), dds]);
		const stored = buildSzdd(lzssLiterals(surface));
		const archive = await texImageFormat.open(sourceOf(stored), "TEX01.TEX");
		try {
			expect(archive.metadata).toMatchObject({ width: 64, height: 32 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 64,
				height: 32,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});

	it("takes the depth of a block compressed surface from its four character code", async () => {
		// A block compressed surface reports no bit count, so the code has to supply the depth.
		const dds = buildDds({ width: 256, height: 128, fourCC: "DXT1" });
		const surface = Buffer.concat([Buffer.alloc(DDS_PREFIX), dds]);
		const stored = buildSzdd(lzssLiterals(surface));
		const archive = await texImageFormat.open(sourceOf(stored), "TEX01.TEX");
		try {
			expect(archive.metadata).toMatchObject({ fourCC: "DXT1" });
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 4 });
		} finally {
			await archive.close();
		}
	});

	it("declines a stream that does not hold a surface", async () => {
		const surface = Buffer.concat([
			Buffer.alloc(DDS_PREFIX),
			buildDds({ width: 4, height: 4 }),
		]);
		// `DDX ` in place of `DDS ` leaves the window intact but the marker wrong.
		surface[DDS_PREFIX + 2] = 0x58;
		const stored = buildSzdd(lzssLiterals(surface));
		expect(await texImageFormat.detect(sourceOf(stored), "TEX01.TEX")).toBe(
			false,
		);
	});

	it("declines a window that cannot be filled", async () => {
		// The reference asks for a hundred and thirty two bytes and declines anything shorter.
		const stored = buildSzdd(lzssLiterals(Buffer.alloc(64, 0x00)));
		expect(await texImageFormat.detect(sourceOf(stored), "TEX01.TEX")).toBe(
			false,
		);
	});

	it("declines zero and oversized dimensions", async () => {
		const zero = Buffer.concat([
			Buffer.alloc(DDS_PREFIX),
			buildDds({ width: 4, height: 0 }),
		]);
		expect(
			await texImageFormat.detect(
				sourceOf(buildSzdd(lzssLiterals(zero))),
				"TEX01.TEX",
			),
		).toBe(false);
		const huge = Buffer.concat([
			Buffer.alloc(DDS_PREFIX),
			buildDds({ width: 0x10001, height: 4 }),
		]);
		expect(
			await texImageFormat.detect(
				sourceOf(buildSzdd(lzssLiterals(huge))),
				"TEX01.TEX",
			),
		).toBe(false);
	});

	it("declines a file that does not begin with the signature", async () => {
		const surface = Buffer.concat([
			Buffer.alloc(DDS_PREFIX),
			buildDds({ width: 4, height: 4 }),
		]);
		const stored = buildSzdd(lzssLiterals(surface));
		// A valid payload behind a wrong tag is still declined, because the format checks the tag itself.
		stored[1] = 0x58;
		expect(await texImageFormat.detect(sourceOf(stored), "TEX01.TEX")).toBe(
			false,
		);
	});

	it("reads the surface with the reference's non default ring buffer fill", async () => {
		// The first hundred and thirty two decompressed bytes are literals — the prefix and a whole surface
		// header — and the rest are matches into a part of the ring buffer nothing has written, so those bytes
		// are the pre-fill. The codec's default fill is zero, which would give zeros here.
		// A picture of four places of a colour of four pixels to a row and one row takes sixteen places of the
		// file behind the head of the surface.
		const surface = Buffer.concat([
			Buffer.alloc(DDS_PREFIX, 0x00),
			buildDds({ width: 4, height: 1, bitCount: 32 }),
		]);
		expect(surface.length).toBe(DDS_PREFIX + DDS_HEADER_SIZE);
		const items: Item[] = [...surface];
		for (let i = 0; i < 10; i += 1) items.push("match");
		const stored = buildSzdd(emit(items));
		// Ten matches of three places each, every one of them the fill place of the ring buffer, stand of the
		// sixteen places of the picture.
		const picture = readBmpImage(await extract(stored));
		expect(picture).toMatchObject({ width: 4, height: 1, bitsPerPixel: 32 });
		expect([...(picture?.pixels ?? [])]).toEqual(new Array(16).fill(0x20));
	});

	it("skips the fourteen byte header rather than reading it", async () => {
		const surface = Buffer.concat([
			Buffer.alloc(DDS_PREFIX),
			completeDds(2, 1, Buffer.from([9, 8, 7, 6, 5, 4, 3, 2])),
		]);
		const header: Buffer = Buffer.alloc(STREAM_OFFSET, 0xa5);
		const stored = buildSzdd(lzssLiterals(surface), header);
		expect(stored.subarray(0, 4)).toEqual(SIGNATURE);
		expect(stored.subarray(4, STREAM_OFFSET)).toEqual(Buffer.alloc(10, 0xa5));
		const picture = readBmpImage(await extract(stored));
		expect([...(picture?.pixels ?? [])]).toEqual([9, 8, 7, 6, 5, 4, 3, 2]);
	});
});
