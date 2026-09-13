import { BufferByteSource } from "@garbro-mcp/core";
import { mtgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;

interface MtgOptions {
	width?: number;
	height?: number;
	dataLength?: number;
	alpha?: number;
	pixels?: Buffer;
	plane?: Buffer;
}

function buildMtg(options: MtgOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const planeSize = width * height;
	const pixels = options.pixels ?? Buffer.alloc(planeSize * 3, 0x00);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	header.writeInt32LE(options.dataLength ?? pixels.length, 8);
	header.writeInt32LE(options.alpha ?? 0, 0x0c);
	return Buffer.concat([
		header,
		pixels,
		options.plane ?? Buffer.alloc(planeSize, 0x00),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.mtg"): Promise<Buffer> {
	const archive = await mtgImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Asura image", () => {
	it("is found by its extension alone", async () => {
		const file = buildMtg();
		expect(await mtgImageFormat.detect(sourceOf(file), "CG_01.mtg")).toBe(true);
		for (const name of ["CG_01.MTG", "CG_01.png", "CG_01", "CG_01.mtg.png"]) {
			expect(await mtgImageFormat.detect(sourceOf(file), name)).toBe(
				name === "CG_01.MTG",
			);
		}
	});

	it("checks the size word and the alpha flag", async () => {
		expect(await mtgImageFormat.detect(sourceOf(buildMtg()), "A.mtg")).toBe(
			true,
		);
		for (const dataLength of [0, -4, 0x4000]) {
			expect(
				await mtgImageFormat.detect(
					sourceOf(buildMtg({ dataLength })),
					"A.mtg",
				),
			).toBe(false);
		}
		for (const alpha of [-1, 2, 0x100]) {
			expect(
				await mtgImageFormat.detect(sourceOf(buildMtg({ alpha })), "A.mtg"),
			).toBe(false);
		}
		expect(
			await mtgImageFormat.detect(
				sourceOf(buildMtg({ alpha: 1, plane: Buffer.alloc(4, 0xff) })),
				"A.mtg",
			),
		).toBe(true);
	});

	it("always reports twenty four bits, even with an alpha plane", async () => {
		for (const alpha of [0, 1]) {
			const archive = await mtgImageFormat.open(
				sourceOf(buildMtg({ width: 3, height: 2, alpha })),
				"A.mtg",
			);
			try {
				expect(archive.metadata).toMatchObject({
					image: "bmp",
					width: 3,
					height: 2,
					bitsPerPixel: 24,
					hasAlpha: alpha === 1,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("copies a colour only image", async () => {
		const pixels: Buffer = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
		]);
		const output = await extract(buildMtg({ pixels }));
		expect(output.readUInt16LE(28)).toBe(24);
		// The reference hands this one over unflipped: a negative height, top down.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(54)).toEqual(
			// Two rows of two pixels, each padded to a bitmap's four byte stride.
			Buffer.from([
				0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00, 0x00, 0x07, 0x08, 0x09, 0x0a,
				0x0b, 0x0c, 0x00, 0x00,
			]),
		);
	});

	it("interleaves an alpha plane that follows the pixel block", async () => {
		const pixels: Buffer = Buffer.from([
			0x01, 0x11, 0x21, 0x02, 0x12, 0x22, 0x03, 0x13, 0x23, 0x04, 0x14, 0x24,
		]);
		const output = await extract(
			buildMtg({
				alpha: 1,
				pixels,
				plane: Buffer.from([0x80, 0x40, 0x20, 0x10]),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x01, 0x11, 0x21, 0x80, 0x02, 0x12, 0x22, 0x40, 0x03, 0x13, 0x23, 0x20,
				0x04, 0x14, 0x24, 0x10,
			]),
		);
	});

	it("finds the alpha plane behind a padded pixel block", async () => {
		// The block declares sixteen bytes but holds twelve: the alpha plane starts after all sixteen.
		const pixels: Buffer = Buffer.concat([
			Buffer.from([
				0x01, 0x11, 0x21, 0x02, 0x12, 0x22, 0x03, 0x13, 0x23, 0x04, 0x14, 0x24,
			]),
			Buffer.alloc(4, 0xcc),
		]);
		const output = await extract(
			buildMtg({
				alpha: 1,
				pixels,
				dataLength: 16,
				plane: Buffer.from([0x01, 0x02, 0x03, 0x04]),
			}),
		);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x01, 0x11, 0x21, 0x01, 0x02, 0x12, 0x22, 0x02, 0x03, 0x13, 0x23, 0x03,
				0x04, 0x14, 0x24, 0x04,
			]),
		);
	});

	it("refuses a pixel block that cannot fill the image", async () => {
		// Eleven bytes for four pixels: the probe still accepts it and the read fails.
		const file = buildMtg({
			alpha: 1,
			plane: Buffer.alloc(4, 0x00),
			pixels: Buffer.alloc(11, 0x00),
		});
		expect(await mtgImageFormat.detect(sourceOf(file), "A.mtg")).toBe(true);
		await expect(extract(file)).rejects.toThrow();
	});

	it("lists its single bitmap entry", async () => {
		const file = buildMtg({ width: 2, height: 1 });
		const archive = await mtgImageFormat.open(sourceOf(file), "sub/CG_02.mtg");
		try {
			const entry = archive.entries[0];
			expect(entry?.path).toBe("CG_02.bmp");
			expect(entry?.sizeKnown).toBe(false);
			expect(entry?.size).toBe(BigInt(file.length));
		} finally {
			await archive.close();
		}
	});
});
