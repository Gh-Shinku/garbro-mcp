import { BufferByteSource } from "@garbro-mcp/core";
import { bpdImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const BMP_HEADER_SIZE = 54;

interface Built {
	file: Buffer;
	pixels: Buffer;
	width: number;
	height: number;
}

/** Builds an image: the signature, sixteen bit dimensions and top down BGRA pixels. */
function buildBpd(width = 0x30, height = 0x12): Built {
	const pixels: Buffer = Buffer.alloc(width * height * 4);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7) & 0xff;
	const head = Buffer.alloc(HEADER_SIZE, 0x13);
	head.write("BPD", 0, "latin1");
	head[3] = 0;
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	return { file: Buffer.concat([head, pixels]), pixels, width, height };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("pinesoft bpd image", () => {
	it("declares the BPD signature for the registry", () => {
		expect(bpdImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x42, 0x50, 0x44, 0x00]) },
		]);
	});

	it("wraps the pixels in a top down bitmap", async () => {
		const built = buildBpd();
		const source = sourceOf(built.file);
		expect(await bpdImageFormat.detect(source, "CG01.BPD")).toBe(true);
		const archive = await bpdImageFormat.open(source, "CG01.BPD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x30,
				height: 0x12,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 0x30,
				height: 0x12,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + built.pixels.length);
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(2)).toBe(output.length);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
			expect(output.readUInt32LE(14)).toBe(40);
			expect(output.readInt32LE(18)).toBe(0x30);
			// A negative height keeps the reference's top down byte order.
			expect(output.readInt32LE(22)).toBe(-0x12);
			expect(output.readUInt16LE(26)).toBe(1);
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.readUInt32LE(30)).toBe(0);
			expect(output.readUInt32LE(34)).toBe(built.pixels.length);
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(built.pixels);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const { file } = buildBpd();
		file[0] = 0x43;
		expect(await bpdImageFormat.detect(sourceOf(file), "CG01.BPD")).toBe(false);
	});

	it("declines a zero dimension", async () => {
		const { file } = buildBpd();
		file.writeUInt16LE(0, 4);
		expect(await bpdImageFormat.detect(sourceOf(file), "CG01.BPD")).toBe(false);
	});

	it("declines dimensions that do not fit the file", async () => {
		const { file } = buildBpd();
		file.writeUInt16LE(0xff, 6);
		expect(await bpdImageFormat.detect(sourceOf(file), "CG01.BPD")).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await bpdImageFormat.detect(sourceOf(Buffer.alloc(4)), "CG01.BPD"),
		).toBe(false);
	});
});
