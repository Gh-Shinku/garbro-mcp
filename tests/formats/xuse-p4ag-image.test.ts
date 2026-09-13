import { BufferByteSource } from "@garbro-mcp/core";
import { p4agImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const MIN_SIZE = 0x1f;
/** A complete PNG signature and IHDR, so the fixture can be built field by field. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface Built {
	file: Buffer;
	width: number;
	height: number;
	bitDepth: number;
	colorType: number;
}

/**
 * Builds the stored file: a PNG with its first two signature bytes removed, so the file starts at the
 * third byte of the PNG signature.
 */
function buildP4ag(
	width = 0x80,
	height = 0x40,
	bitDepth = 8,
	colorType = 6,
): Built {
	const png: Buffer = Buffer.alloc(MIN_SIZE + 2 + 4, 0x11);
	PNG_SIGNATURE.copy(png, 0);
	png.writeUInt32BE(13, 8);
	png.write("IHDR", 12, "latin1");
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	png[24] = bitDepth;
	png[25] = colorType;
	png.writeUInt32BE(0x5a5a5a5a, 29);
	return {
		file: Buffer.from(png.subarray(2)),
		width,
		height,
		bitDepth,
		colorType,
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("xuse obfuscated png image", () => {
	it("declares the stored signature for the registry", () => {
		expect(p4agImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x4e, 0x47, 0x0d, 0x0a]) },
		]);
	});

	it("restores the missing signature bytes and keeps the rest", async () => {
		const built = buildP4ag();
		const source = sourceOf(built.file);
		expect(await p4agImageFormat.detect(source, "CG01.PNG")).toBe(true);
		const archive = await p4agImageFormat.open(source, "CG01.PNG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.png"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x80,
				height: 0x40,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "png",
				encrypted: true,
				width: 0x80,
				height: 0x40,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// Two bytes are prepended, so the result is the original PNG.
			expect(output.length).toBe(built.file.length + 2);
			expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
			expect(output.subarray(2)).toEqual(built.file);
			expect(output.subarray(12, 16).toString("latin1")).toBe("IHDR");
		} finally {
			await archive.close();
		}
	});

	it("derives the bit depth from the colour type", async () => {
		const palette = buildP4ag(0x20, 0x20, 4, 3);
		const first = await p4agImageFormat.open(sourceOf(palette.file), "A.PNG");
		try {
			expect(first.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 4 });
		} finally {
			await first.close();
		}
		const rgb = buildP4ag(0x20, 0x20, 8, 2);
		const second = await p4agImageFormat.open(sourceOf(rgb.file), "B.PNG");
		try {
			expect(second.entries[0]?.metadata).toMatchObject({
				bitsPerPixel: 24,
			});
		} finally {
			await second.close();
		}
	});

	it("declines a plain png", async () => {
		// A plain PNG starts with 89 50, which is exactly the prefix this format restores.
		const built = buildP4ag();
		const plain = Buffer.concat([PNG_SIGNATURE.subarray(0, 2), built.file]);
		expect(await p4agImageFormat.detect(sourceOf(plain), "CG01.PNG")).toBe(
			false,
		);
	});

	it("declines a broken signature", async () => {
		const built = buildP4ag();
		built.file[5] = 0x0b;
		expect(await p4agImageFormat.detect(sourceOf(built.file), "CG01.PNG")).toBe(
			false,
		);
	});

	it("declines a file whose first chunk is not the header", async () => {
		const built = buildP4ag();
		built.file.write("IDAT", 10, "latin1");
		expect(await p4agImageFormat.detect(sourceOf(built.file), "CG01.PNG")).toBe(
			false,
		);
	});

	it("declines a zero dimension", async () => {
		const built = buildP4ag();
		built.file.writeUInt32BE(0, 18);
		expect(await p4agImageFormat.detect(sourceOf(built.file), "CG01.PNG")).toBe(
			false,
		);
	});

	it("declines a file shorter than a header chunk", async () => {
		const built = buildP4ag();
		expect(
			await p4agImageFormat.detect(
				sourceOf(built.file.subarray(0, MIN_SIZE - 1)),
				"CG01.PNG",
			),
		).toBe(false);
	});
});
