import { BufferByteSource } from "@garbro-mcp/core";
import { imaImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const RGB_OFFSET = 0x10;

interface ImaOptions {
	width?: number;
	height?: number;
	rgbSize?: number;
	prefix?: number;
	rgb?: Buffer;
	alpha?: Buffer;
}

/** The colour block starts behind the header, and the alpha plane at the declared offset past the prefix. */
function buildIma(options: ImaOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const planeSize = width * height;
	const rgbSize = options.rgbSize ?? planeSize * 3;
	const rgb = options.rgb ?? Buffer.alloc(planeSize * 3, 0x00);
	const alpha = options.alpha ?? Buffer.alloc(planeSize, 0x00);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeInt32LE(options.prefix ?? 0, 0);
	header.writeUInt32LE(rgbSize, 4);
	header.writeUInt32LE(width, 8);
	header.writeUInt32LE(height, 12);
	const alphaOffset = 8 + rgbSize;
	const body: Buffer = Buffer.alloc(
		Math.max(0, alphaOffset - RGB_OFFSET),
		0x00,
	);
	rgb.copy(body, 0, 0, Math.min(rgb.length, body.length));
	return Buffer.concat([header, body, alpha]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.ima"): Promise<Buffer> {
	const archive = await imaImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Hill Field image", () => {
	it("probes the header, the size relations and the room for an alpha plane", async () => {
		expect(await imaImageFormat.detect(sourceOf(buildIma()), "A.ima")).toBe(
			true,
		);
		// A non zero first word, or an empty image.
		expect(
			await imaImageFormat.detect(sourceOf(buildIma({ prefix: 1 })), "A.ima"),
		).toBe(false);
		expect(
			await imaImageFormat.detect(sourceOf(buildIma({ height: 0 })), "A.ima"),
		).toBe(false);
		// A colour block smaller than three bytes a pixel.
		expect(
			await imaImageFormat.detect(
				sourceOf(buildIma({ width: 2, height: 2, rgbSize: 11 })),
				"A.ima",
			),
		).toBe(false);
		// Not enough room for the alpha plane behind the declared colour block.
		const file = buildIma();
		expect(
			await imaImageFormat.detect(
				sourceOf(file.subarray(0, file.length - 1)),
				"A.ima",
			),
		).toBe(false);
	});

	it("wraps the pixel count like the unsigned product it is", async () => {
		// Sixty five thousand pixels square overflows to exactly zero, which the reference declines. The probe
		// only reads the header, so the fixture needs no body at all.
		const file = buildIma({
			width: 0x10000,
			height: 0x10000,
			rgbSize: 0,
			rgb: Buffer.alloc(0),
			alpha: Buffer.alloc(0),
		});
		expect(await imaImageFormat.detect(sourceOf(file), "A.ima")).toBe(false);
	});

	it("reports thirty two bit dimensions", async () => {
		const archive = await imaImageFormat.open(
			sourceOf(buildIma({ width: 3, height: 2 })),
			"A.ima",
		);
		try {
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 3,
				height: 2,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 3,
				height: 2,
			});
		} finally {
			await archive.close();
		}
	});

	it("takes the alpha plane from the colour block's declared size", async () => {
		// Twelve bytes of colour inside a twenty byte block: the alpha plane follows the block, not the pixels.
		const rgb: Buffer = Buffer.from([
			0x01, 0x11, 0x21, 0x02, 0x12, 0x22, 0x03, 0x13, 0x23, 0x04, 0x14, 0x24,
		]);
		const alpha: Buffer = Buffer.from([0x00, 0xff, 0x7f, 0x01]);
		const output = await extract(buildIma({ rgbSize: 20, rgb, alpha }));
		// A flipped image carries a positive height.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x01, 0x11, 0x21, 0xff, 0x02, 0x12, 0x22, 0x00, 0x03, 0x13, 0x23, 0x80,
				0x04, 0x14, 0x24, 0xfe,
			]),
		);
	});

	it("accepts a file whose colour block runs off the end, then fails to read it", async () => {
		// A single pixel leaves fourteen bytes between the header end and the alpha plane at eleven, so the
		// probe passes and the read cannot find three colour bytes.
		const file = buildIma({ width: 1, height: 1, rgbSize: 3 });
		expect(await imaImageFormat.detect(sourceOf(file), "A.ima")).toBe(true);
		await expect(extract(file)).rejects.toThrow();
	});

	it("lists its single bitmap entry", async () => {
		const file = buildIma({ width: 2, height: 1 });
		const archive = await imaImageFormat.open(sourceOf(file), "sub/CG_09.ima");
		try {
			const entry = archive.entries[0];
			expect(entry?.path).toBe("CG_09.bmp");
			expect(entry?.sizeKnown).toBe(false);
			expect(entry?.size).toBe(BigInt(file.length));
		} finally {
			await archive.close();
		}
	});
});
