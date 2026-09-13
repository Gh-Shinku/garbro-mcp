import { BufferByteSource } from "@garbro-mcp/core";
import { pcgImageDescriptor, pcgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;
const BMP_HEADER_SIZE = 54;
const SIGNATURE = Buffer.from([0x50, 0x43, 0x47, 0x30]);

interface Built {
	file: Buffer;
	pixels: Buffer;
	width: number;
	height: number;
}

/** The header carries `PCG0`, eight unused bytes and the dimensions; pixels follow top down. */
function buildPcg(width = 0x10, height = 0x0c): Built {
	const pixels: Buffer = Buffer.alloc(width * height * 4);
	for (let i = 0; i < pixels.length; i += 4) {
		pixels[i] = i & 0xff;
		pixels[i + 1] = (i * 3) & 0xff;
		pixels[i + 2] = (i * 5) & 0xff;
		pixels[i + 3] = 0x80;
	}
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x2a);
	SIGNATURE.copy(head, 0);
	head.writeUInt32LE(width, 12);
	head.writeUInt32LE(height, 16);
	return { file: Buffer.concat([head, pixels]), pixels, width, height };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("parsley pcg image", () => {
	it("declares the signature and the pcg extension", () => {
		expect(pcgImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(pcgImageDescriptor.extensions).toEqual(["pcg"]);
	});

	it("wraps the bgra pixels in a top down bitmap", async () => {
		const built = buildPcg();
		const source = sourceOf(built.file);
		expect(await pcgImageFormat.detect(source, "EV01.PCG")).toBe(true);
		const archive = await pcgImageFormat.open(source, "EV01.PCG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["EV01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 0x10,
				height: 0x0c,
				bitsPerPixel: 32,
				pixelFormat: "bgra32",
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x10,
				height: 0x0c,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(built.pixels.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.length).toBe(BMP_HEADER_SIZE + built.pixels.length);
			// `ImageData.Create` is top down, so the bitmap stores a negative height.
			expect(output.readInt32LE(22)).toBe(-built.height);
			expect(output.readUInt32LE(18)).toBe(built.width);
			// Offset 14 is the DIB header size, the bit count sits at 28.
			expect(output.readUInt32LE(14)).toBe(40);
			expect(output.readUInt16LE(28)).toBe(32);
			// The pixel bytes are stored as they are, alpha included.
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(built.pixels);
			// The first pixel is index zero, so only its alpha byte is non-zero.
			expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
				Buffer.from([0x00, 0x00, 0x00, 0x80]),
			);
		} finally {
			await archive.close();
		}
	});

	it("accepts a single pixel image", async () => {
		const built = buildPcg(1, 1);
		expect(await pcgImageFormat.detect(sourceOf(built.file), "EV02.PCG")).toBe(
			true,
		);
		const archive = await pcgImageFormat.open(sourceOf(built.file), "EV02.PCG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + 4);
			expect(output.readInt32LE(22)).toBe(-1);
		} finally {
			await archive.close();
		}
	});

	it("declines a file that is one byte longer than declared", async () => {
		const built = buildPcg();
		const stored = Buffer.concat([built.file, Buffer.from([0x00])]);
		expect(await pcgImageFormat.detect(sourceOf(stored), "EV01.PCG")).toBe(
			false,
		);
	});

	it("declines a file that is one byte shorter than declared", async () => {
		const built = buildPcg();
		const stored = built.file.subarray(0, built.file.length - 1);
		expect(await pcgImageFormat.detect(sourceOf(stored), "EV01.PCG")).toBe(
			false,
		);
	});

	it("declines zero dimensions", async () => {
		const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x2a);
		SIGNATURE.copy(head, 0);
		expect(await pcgImageFormat.detect(sourceOf(head), "EV01.PCG")).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await pcgImageFormat.detect(
				sourceOf(SIGNATURE.subarray(0, 3)),
				"EV01.PCG",
			),
		).toBe(false);
	});
});
