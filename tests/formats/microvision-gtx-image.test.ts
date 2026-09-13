import { BufferByteSource } from "@garbro-mcp/core";
import { gtxImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x40;
const V1_FLAG = 0x1000;
const V2_FLAG = 0x2000;

interface GtxOptions {
	flags?: number;
	width?: number;
	height?: number;
	version?: number;
	/** Bytes of pixel data, four a pixel. */
	pixels?: Buffer;
	marker?: string;
	headerSize?: number;
}

function buildGtx(options: GtxOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	header.write(options.marker ?? "GPC0", 0, "latin1");
	if (header.length >= HEADER_SIZE)
		header.writeUInt16LE(options.flags ?? V2_FLAG, 0x0c);
	// Both variants put the dimensions at the same offset within their own block, so the file's own offsets
	// are 0x50 and 0x52 either way. The first variant's block is shorter, which the trailing zeroes cover.
	const block: Buffer = Buffer.alloc(0x50, 0x00);
	block.writeUInt16LE(options.width ?? 2, 0x10);
	block.writeUInt16LE(options.height ?? 1, 0x12);
	block.writeUInt16LE(options.version ?? 1, 0x14);
	return Buffer.concat([header, block, options.pixels ?? Buffer.alloc(0)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.gtx"): Promise<Buffer> {
	const archive = await gtxImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("MicroVision image", () => {
	it("needs the marker and one of the two flag words", async () => {
		expect(await gtxImageFormat.detect(sourceOf(buildGtx()), "A.gtx")).toBe(
			true,
		);
		expect(
			await gtxImageFormat.detect(
				sourceOf(buildGtx({ flags: V1_FLAG })),
				"A.gtx",
			),
		).toBe(true);
		for (const options of [
			{ marker: "GPC1" },
			{ flags: 0x0000 },
			{ flags: 0x8000 },
			{ headerSize: 0x20 },
		]) {
			expect(
				await gtxImageFormat.detect(sourceOf(buildGtx(options)), "A.gtx"),
			).toBe(false);
		}
	});

	it("takes the first flag when a header carries both", async () => {
		const both = buildGtx({ flags: V1_FLAG | V2_FLAG, width: 3, height: 2 });
		expect(await gtxImageFormat.detect(sourceOf(both), "A.gtx")).toBe(true);
		// The first variant's reading code was never written in the reference, so this header describes an
		// image whose pixels cannot be had.
		await expect(extract(both)).rejects.toThrow();
	});

	it("needs a version word of one for the second variant", async () => {
		expect(
			await gtxImageFormat.detect(sourceOf(buildGtx({ version: 1 })), "A.gtx"),
		).toBe(true);
		for (const version of [0, 2, 0xffff]) {
			expect(
				await gtxImageFormat.detect(sourceOf(buildGtx({ version })), "A.gtx"),
			).toBe(false);
		}
		// The first variant has no version word at all, so whatever sits there is never looked at.
		expect(
			await gtxImageFormat.detect(
				sourceOf(buildGtx({ flags: V1_FLAG, version: 0xffff })),
				"A.gtx",
			),
		).toBe(true);
	});

	it("reads the dimensions from the block behind the header", async () => {
		const archive = await gtxImageFormat.open(
			sourceOf(buildGtx({ width: 9, height: 4 })),
			"A.gtx",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 9,
				height: 4,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 9,
				height: 4,
			});
		} finally {
			await archive.close();
		}
	});

	it("hands the pixels over from behind both headers", async () => {
		const pixels: Buffer = Buffer.alloc(4 * 4, 0x00);
		for (let index = 0; index < 16; index += 1) pixels[index] = 0x10 + index;
		const output = await extract(buildGtx({ width: 4, height: 1, pixels }));
		expect(output.readUInt16LE(28)).toBe(32);
		// The reference hands this image over unflipped.
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.subarray(54)).toEqual(pixels);
	});

	it("refuses a pixel block the file does not hold", async () => {
		// Four pixels at four bytes each are wanted and only six bytes are there.
		const short = buildGtx({
			width: 4,
			height: 1,
			pixels: Buffer.alloc(6, 0x33),
		});
		expect(await gtxImageFormat.detect(sourceOf(short), "A.gtx")).toBe(true);
		await expect(extract(short)).rejects.toThrow();
	});

	it("names the entry after the bitmap and reports its depth", async () => {
		const archive = await gtxImageFormat.open(
			sourceOf(buildGtx({ width: 2, height: 2 })),
			"sub/CG_11.gtx",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_11.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
