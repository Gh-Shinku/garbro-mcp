import { BufferByteSource } from "@garbro-mcp/core";
import { silkyZitImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const TYPE_BGR = 0x1803;
const TYPE_BGRA = 0x2084;
const TYPE_PALETTE = 0x8803;

interface ZitOptions {
	width?: number;
	height?: number;
	type?: number;
	colors?: number;
	body?: Buffer;
}

function buildZit(options: ZitOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("ZT", 0, "latin1");
	header.writeUInt16LE(options.type ?? TYPE_BGR, 2);
	header.writeUInt16LE(options.colors ?? 0, 4);
	header.writeUInt16LE(options.width ?? 2, 8);
	header.writeUInt16LE(options.height ?? 1, 10);
	return Buffer.concat([header, options.body ?? Buffer.alloc(0)]);
}

/** A palette of blue, green and red triples, the way the format stores them. */
function buildPalette(entries: number[][]): Buffer {
	return Buffer.from(entries.flat());
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.zit"): Promise<Buffer> {
	const archive = await silkyZitImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Silky's image (ZIT)", () => {
	it("declares its three words and no extension", async () => {
		const words = [TYPE_BGR, TYPE_BGRA, TYPE_PALETTE].map((type) => {
			const bytes: Buffer = Buffer.alloc(4, 0x00);
			bytes.write("ZT", 0, "latin1");
			bytes.writeUInt16LE(type, 2);
			return { bytes };
		});
		expect(silkyZitImageFormat.detection?.signatures).toEqual(words);
		expect(silkyZitImageFormat.descriptor.extensions).toEqual([]);
		for (const type of [TYPE_BGR, TYPE_BGRA, TYPE_PALETTE]) {
			expect(
				await silkyZitImageFormat.detect(
					sourceOf(buildZit({ type, body: Buffer.alloc(64, 0x11) })),
					"CG01.zit",
				),
			).toBe(true);
		}
		// A type word that is none of the three is not registered at all.
		expect(
			await silkyZitImageFormat.detect(
				sourceOf(buildZit({ type: 0x1804, body: Buffer.alloc(64) })),
				"CG01.zit",
			),
		).toBe(false);
		expect(
			await silkyZitImageFormat.detect(sourceOf(Buffer.alloc(8)), "CG01.zit"),
		).toBe(false);
	});

	it("reads its measurements, its type and its colour count", async () => {
		const archive = await silkyZitImageFormat.open(
			sourceOf(
				buildZit({
					width: 3,
					height: 2,
					type: TYPE_PALETTE,
					colors: 5,
					body: Buffer.alloc(64, 0x00),
				}),
			),
			"CG01.zit",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 32,
				imageType: TYPE_PALETTE,
				colors: 5,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "none",
			});
		} finally {
			await archive.close();
		}
	});

	it("takes three bytes a pixel and turns its green key transparent", async () => {
		// Blue, green, red: an ordinary colour, then the key, which is green rather than a colour.
		const body = Buffer.from([0x10, 0x20, 0x30, 0x00, 0xff, 0x00]);
		const output = await extract(
			buildZit({ width: 2, height: 1, type: TYPE_BGR, body }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		// `ImageData.Create` with no flip, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.subarray(54, 58)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0xff]),
		);
		// The key is packed as a whole word, which puts blue and green with no alpha at all.
		expect(output.subarray(58, 62)).toEqual(
			Buffer.from([0xff, 0xff, 0x00, 0x00]),
		);
	});

	it("copies four byte pixels as they are, short body and all", async () => {
		const body = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const output = await extract(
			buildZit({ width: 3, height: 1, type: TYPE_BGRA, body }),
		);
		// The third pixel is missing and keeps the zeroes the buffer was allocated with, as the reference's
		// own read leaves it.
		expect(output.subarray(54, 66)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]),
		);
		const archive = await silkyZitImageFormat.open(
			sourceOf(buildZit({ width: 3, height: 1, type: TYPE_BGRA, body })),
			"CG01.zit",
		);
		try {
			// The reference ignores how much that read returned, so the size is not known ahead.
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});

	it("takes a palette and packs its key as a different word", async () => {
		const palette = buildPalette([
			[0x11, 0x22, 0x33],
			[0x00, 0xff, 0x00],
		]);
		const body = Buffer.concat([palette, Buffer.from([0, 1])]);
		const output = await extract(
			buildZit({ width: 2, height: 1, type: TYPE_PALETTE, colors: 2, body }),
		);
		expect(output.subarray(54, 58)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0xff]),
		);
		// Here the key word holds the green alone, which is not the word the three byte kind writes.
		expect(output.subarray(58, 62)).toEqual(
			Buffer.from([0x00, 0xff, 0x00, 0x00]),
		);
	});

	it("refuses a palette index that is not in the palette", async () => {
		const palette = buildPalette([[0x11, 0x22, 0x33]]);
		const body = Buffer.concat([palette, Buffer.from([3])]);
		await expect(
			extract(
				buildZit({ width: 1, height: 1, type: TYPE_PALETTE, colors: 1, body }),
			),
		).rejects.toThrow(/index is out of range/);
	});

	it("refuses a body that stops in the middle of a pixel", async () => {
		await expect(
			extract(
				buildZit({
					width: 2,
					height: 1,
					type: TYPE_BGR,
					body: Buffer.alloc(4),
				}),
			),
		).rejects.toThrow(/truncated/);
		await expect(
			extract(
				buildZit({
					width: 1,
					height: 1,
					type: TYPE_PALETTE,
					colors: 4,
					body: Buffer.alloc(4),
				}),
			),
		).rejects.toThrow(/truncated/);
	});

	it("names the entry after the image", async () => {
		const archive = await silkyZitImageFormat.open(
			sourceOf(
				buildZit({
					width: 1,
					height: 1,
					type: TYPE_BGR,
					body: Buffer.from([1, 2, 3]),
				}),
			),
			"sub/CG07.zit",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.compressed).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
