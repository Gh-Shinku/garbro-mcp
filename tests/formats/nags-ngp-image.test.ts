import { BufferByteSource } from "@garbro-mcp/core";
import { nagsNgpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const SIZES_OFFSET = 0x12;
const UNPACKED_SIZE_OFFSET = 0x100;
const DATA_OFFSET = 0x104;

interface NgpOptions {
	width?: number;
	height?: number;
	/** Bytes per pixel as the header stores it, which is the depth divided by eight. */
	bytesPerPixel?: number;
	pixels?: Buffer;
	packedSize?: number;
	unpackedSize?: number;
	marker?: string;
}

function buildNgp(options: NgpOptions = {}): Buffer {
	const pixels =
		options.pixels ?? Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
	const header: Buffer = Buffer.alloc(DATA_OFFSET, 0x00);
	header.write(options.marker ?? "NGP ", 0, "latin1");
	const packed = deflateSync(pixels);
	header.writeInt32LE(options.packedSize ?? packed.length, SIZES_OFFSET);
	header.writeUInt32LE(options.width ?? 2, SIZES_OFFSET + 4);
	header.writeUInt32LE(options.height ?? 1, SIZES_OFFSET + 8);
	header.writeUInt16LE(options.bytesPerPixel ?? 3, SIZES_OFFSET + 12);
	header.writeInt32LE(
		options.unpackedSize ?? pixels.length,
		UNPACKED_SIZE_OFFSET,
	);
	return Buffer.concat([header, packed]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.ngp"): Promise<Buffer> {
	const archive = await nagsNgpImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("NAGS engine image", () => {
	it("needs its marker and two sizes it can believe", async () => {
		expect(await nagsNgpImageFormat.detect(sourceOf(buildNgp()), "A.ngp")).toBe(
			true,
		);
		// Either size being zero is a refusal, and the depth is not looked at here at all.
		expect(
			await nagsNgpImageFormat.detect(
				sourceOf(buildNgp({ packedSize: 0 })),
				"A.ngp",
			),
		).toBe(false);
		expect(
			await nagsNgpImageFormat.detect(
				sourceOf(buildNgp({ unpackedSize: 0 })),
				"A.ngp",
			),
		).toBe(false);
		expect(
			await nagsNgpImageFormat.detect(
				sourceOf(buildNgp({ marker: "NGQ " })),
				"A.ngp",
			),
		).toBe(false);
		expect(
			await nagsNgpImageFormat.detect(
				sourceOf(Buffer.from("NGP ", "latin1")),
				"A.ngp",
			),
		).toBe(false);
	});

	it("multiplies the stored depth by eight", async () => {
		const depths: Array<[number, number]> = [
			[1, 8],
			[3, 24],
			[4, 32],
		];
		for (const [bytesPerPixel, bits] of depths) {
			const archive = await nagsNgpImageFormat.open(
				sourceOf(buildNgp({ bytesPerPixel })),
				"A.ngp",
			);
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					bitsPerPixel: bits,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("inflates a twenty four bit image top down", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const output = await extract(buildNgp({ width: 2, height: 2, pixels }));
		expect(output.readUInt16LE(28)).toBe(24);
		// This reader does not flip, so the bitmap's height is negative.
		expect(output.readInt32LE(22)).toBe(-2);
		// Bitmap rows are padded to four bytes, so the rows sit eight bytes apart.
		expect(output.subarray(54, 60)).toEqual(pixels.subarray(0, 6));
		expect(output.subarray(62, 68)).toEqual(pixels.subarray(6, 12));
	});

	it("wraps an eight bit image in a grey ramp", async () => {
		const pixels = Buffer.from([0x00, 0xff, 0x80, 0x40]);
		const output = await extract(
			buildNgp({ width: 2, height: 2, bytesPerPixel: 1, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(22)).toBe(-2);
		// The palette page starts at 54 and the pixels follow it.
		expect(output.subarray(54, 58)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
		);
		expect(output.subarray(54 + 0xff * 4, 54 + 0x100 * 4)).toEqual(
			Buffer.from([0xff, 0xff, 0xff, 0x00]),
		);
		expect(output.subarray(1078, 1080)).toEqual(Buffer.from([0x00, 0xff]));
	});

	it("reads a thirty two bit image", async () => {
		const pixels = Buffer.from([0x11, 0x22, 0x33, 0x44]);
		const output = await extract(
			buildNgp({ width: 1, height: 1, bytesPerPixel: 4, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54, 58)).toEqual(pixels);
	});

	it("refuses a depth it does not know", async () => {
		const file = buildNgp({ bytesPerPixel: 2 });
		expect(await nagsNgpImageFormat.detect(sourceOf(file), "A.ngp")).toBe(true);
		await expect(extract(file)).rejects.toThrow();
	});

	it("refuses a stream that does not hold the whole image", async () => {
		// The header promises more than the stream can give.
		await expect(
			extract(buildNgp({ pixels: Buffer.alloc(16, 0x00), unpackedSize: 32 })),
		).rejects.toThrow();
	});

	it("refuses a packed block that is cut short", async () => {
		const file = buildNgp();
		await expect(
			extract(buildNgp({ packedSize: file.length - DATA_OFFSET - 2 })),
		).rejects.toThrow();
	});

	it("names the entry after the bitmap and reports its depth", async () => {
		const archive = await nagsNgpImageFormat.open(
			sourceOf(buildNgp({ width: 6, height: 2 })),
			"sub/CG_07.ngp",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 6,
				height: 2,
			});
		} finally {
			await archive.close();
		}
	});
});
