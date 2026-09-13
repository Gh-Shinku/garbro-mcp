import { BufferByteSource } from "@garbro-mcp/core";
import { cgdImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;
const BMP_HEADER_SIZE = 54;

interface Built {
	file: Buffer;
	pixels: Buffer;
}

/** Builds an image: the signature, the dimensions and top down BGRA pixels. */
function buildCgd(width = 0x20, height = 0x10): Built {
	const pixels: Buffer = Buffer.alloc(width * height * 4);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 5) & 0xff;
	const head = Buffer.alloc(HEADER_SIZE, 0x11);
	head.write("cgd", 0, "latin1");
	head[3] = 0;
	head.writeUInt32LE(width, 12);
	head.writeUInt32LE(height, 16);
	return { file: Buffer.concat([head, pixels]), pixels };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("carriere cgd image", () => {
	it("declares the cgd signature for the registry", () => {
		expect(cgdImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x63, 0x67, 0x64, 0x00]) },
		]);
	});

	it("wraps the pixels in a top down bitmap", async () => {
		const { file, pixels } = buildCgd();
		const source = sourceOf(file);
		expect(await cgdImageFormat.detect(source, "CG01.CGD")).toBe(true);
		const archive = await cgdImageFormat.open(source, "CG01.CGD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x20,
				height: 0x10,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 0x20,
				height: 0x10,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + pixels.length);
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(2)).toBe(output.length);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
			expect(output.readUInt32LE(14)).toBe(40);
			expect(output.readInt32LE(18)).toBe(0x20);
			// A negative height keeps the reference's top down byte order.
			expect(output.readInt32LE(22)).toBe(-0x10);
			expect(output.readUInt16LE(26)).toBe(1);
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.readUInt32LE(30)).toBe(0);
			expect(output.readUInt32LE(34)).toBe(pixels.length);
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const { file } = buildCgd();
		file[0] = 0x64;
		expect(await cgdImageFormat.detect(sourceOf(file), "CG01.CGD")).toBe(false);
	});

	it("declines a zero dimension", async () => {
		const { file } = buildCgd();
		file.writeUInt32LE(0, 16);
		expect(await cgdImageFormat.detect(sourceOf(file), "CG01.CGD")).toBe(false);
	});

	it("declines dimensions that do not fit the file", async () => {
		const { file } = buildCgd();
		file.writeUInt32LE(0x10000, 16);
		expect(await cgdImageFormat.detect(sourceOf(file), "CG01.CGD")).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await cgdImageFormat.detect(sourceOf(Buffer.alloc(8)), "CG01.CGD"),
		).toBe(false);
	});
});
