import { BufferByteSource } from "@garbro-mcp/core";
import { fc01ClmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x40;
const PALETTE_SIZE = 0x100 * 4;
const GREY_PIXEL_OFFSET = 54 + PALETTE_SIZE;

/** Builds a literal only mrg lzss stream: one control byte per eight literals, least significant bit first. */
function literalStream(data: Buffer): Buffer {
	const output: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		let control = 0;
		const body: number[] = [];
		for (const [index, value] of group.entries()) {
			control |= 1 << index;
			body.push(value);
		}
		output.push(control, ...body);
	}
	return Buffer.from(output);
}

function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0x00);
	for (let index = 0; index < 0x100; index += 1) {
		palette[index * 4] = index;
		palette[index * 4 + 1] = (index + 1) & 0xff;
		palette[index * 4 + 2] = (index + 2) & 0xff;
	}
	return palette;
}

interface ClmOptions {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	/** The plain pixels the body decompresses to, a row at a time and tight. */
	pixels?: Buffer;
	palette?: Buffer;
	body?: Buffer;
	unpackedSize?: number;
	dataOffset?: number;
	marker?: string;
	version?: string;
	tail?: Buffer;
}

function buildClm(options: ClmOptions = {}): Buffer {
	const width = options.width ?? 3;
	const height = options.height ?? 2;
	const bitsPerPixel = options.bitsPerPixel ?? 24;
	const pixelSize = bitsPerPixel === 8 ? 1 : bitsPerPixel === 24 ? 3 : 4;
	const plain =
		options.pixels ??
		Buffer.from(
			Array.from(
				{ length: width * height * pixelSize },
				(_, index) => (index * 7 + 1) & 0xff,
			),
		);
	const palette =
		bitsPerPixel === 8 ? (options.palette ?? buildPalette()) : Buffer.alloc(0);
	const body = options.body ?? literalStream(plain);
	const dataOffset = options.dataOffset ?? HEADER_SIZE;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "CLM ", 0, "latin1");
	header.write(options.version ?? "1.00", 4, "latin1");
	header.writeUInt32LE(dataOffset, 0x10);
	header.writeUInt32LE(width, 0x1c);
	header.writeUInt32LE(height, 0x20);
	header.writeInt32LE(bitsPerPixel, 0x24);
	header.writeInt32LE(options.unpackedSize ?? plain.length, 0x28);
	return Buffer.concat([
		header,
		palette,
		body,
		options.tail ?? Buffer.alloc(0),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.CLM"): Promise<Buffer> {
	const archive = await fc01ClmImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("F&C Co. image", () => {
	it("needs its marker, the 1.00 version and a data offset behind the header", async () => {
		expect(await fc01ClmImageFormat.detect(sourceOf(buildClm()), "A.CLM")).toBe(
			true,
		);
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm({ marker: "CLN " })),
				"A.CLM",
			),
		).toBe(false);
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm({ version: "1.01" })),
				"A.CLM",
			),
		).toBe(false);
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm({ dataOffset: 0x3f })),
				"A.CLM",
			),
		).toBe(false);
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm({ dataOffset: 0x1000 })),
				"A.CLM",
			),
		).toBe(false);
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm().subarray(0, HEADER_SIZE - 1)),
				"A.CLM",
			),
		).toBe(false);
	});

	it("needs dimensions and a length to decode into", async () => {
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm({ width: 0 })),
				"A.CLM",
			),
		).toBe(false);
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm({ height: 0 })),
				"A.CLM",
			),
		).toBe(false);
		expect(
			await fc01ClmImageFormat.detect(
				sourceOf(buildClm({ unpackedSize: 0 })),
				"A.CLM",
			),
		).toBe(false);
	});

	it("describes the image and keeps its depth as it stands", async () => {
		const archive = await fc01ClmImageFormat.open(
			sourceOf(buildClm()),
			"CG01.CLM",
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
				compression: "mrg-lzss",
			});
			expect(fc01ClmImageFormat.descriptor.extensions).toEqual([]);
		} finally {
			await archive.close();
		}
		// A depth the reference cannot build is still described: it only fails when the image is read.
		const odd = await fc01ClmImageFormat.open(
			sourceOf(buildClm({ bitsPerPixel: 16, pixels: Buffer.alloc(8) })),
			"CG01.CLM",
		);
		try {
			expect(odd.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 16 });
		} finally {
			await odd.close();
		}
		await expect(
			extract(buildClm({ bitsPerPixel: 16, pixels: Buffer.alloc(8) })),
		).rejects.toThrow();
	});

	it("unfolds a twenty four bit image top down", async () => {
		const pixels = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21, 22, 23, 24,
		]);
		const output = await extract(buildClm({ width: 3, height: 2, pixels }));
		expect(output.readUInt16LE(28)).toBe(24);
		// No flip in the reference, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(54, 66)).toEqual(
			Buffer.concat([pixels.subarray(0, 9), Buffer.alloc(3)]),
		);
		expect(output.subarray(66, 78)).toEqual(
			Buffer.concat([pixels.subarray(9), Buffer.alloc(3)]),
		);
	});

	it("reads the palette an eight bit image carries in front of its body", async () => {
		const pixels = Buffer.from([0x00, 0x05, 0xff]);
		const output = await extract(
			buildClm({ width: 3, height: 1, bitsPerPixel: 8, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(22)).toBe(-1);
		// The entries are blue, green, red and an unused byte, exactly as the file holds them.
		expect(output.subarray(54 + 5 * 4, 54 + 5 * 4 + 4)).toEqual(
			Buffer.from([0x05, 0x06, 0x07, 0x00]),
		);
		expect(output.subarray(GREY_PIXEL_OFFSET, GREY_PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0x00, 0x05, 0xff, 0x00]),
		);
	});

	it("unfolds a thirty two bit image", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const output = await extract(
			buildClm({ width: 2, height: 1, bitsPerPixel: 32, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54, 62)).toEqual(pixels);
	});

	it("refuses a short palette or a body that cannot fill the image", async () => {
		// Eight bits a pixel expect a 0x400 byte palette in front of the body.
		const shortPalette = buildClm({ width: 2, height: 1, bitsPerPixel: 8 });
		await expect(
			extract(shortPalette.subarray(0, HEADER_SIZE + 0x100)),
		).rejects.toThrow();
		// The unpacked length promises less than the image needs.
		await expect(
			extract(buildClm({ width: 3, height: 2, unpackedSize: 9 })),
		).rejects.toThrow();
	});

	it("names the entry after the image", async () => {
		const archive = await fc01ClmImageFormat.open(
			sourceOf(buildClm()),
			"sub/CG07.CLM",
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
