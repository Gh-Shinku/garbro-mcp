import { BufferByteSource } from "@garbro-mcp/core";
import { bbmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const XOR_KEY = 0xff;
const META_SIZE = 0x20;
const UNMASK_SIZE = 100;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;

/** A bitmap with an optional palette, which the port only unmasks for its first hundred bytes. */
function buildBmp(bpp = 24): Buffer {
	// The reference unmasks a hundred bytes before decoding, so every fixture is at least that long.
	const dataOffset =
		bpp === 8 ? BMP_HEADER_SIZE + PALETTE_SIZE : BMP_HEADER_SIZE;
	const stride = bpp === 8 ? 4 : 24;
	const width = bpp === 8 ? 4 : 8;
	const height = bpp === 8 ? 3 : 2;
	const fileSize = dataOffset + stride * height;
	const bmp: Buffer = Buffer.alloc(fileSize, 0x00);
	bmp.write("BM", 0, "latin1");
	bmp.writeUInt32LE(fileSize, 2);
	bmp.writeUInt32LE(dataOffset, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(width, 18);
	bmp.writeInt32LE(height, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(bpp, 28);
	bmp.writeUInt32LE(stride * height, 34);
	for (let i = 0; i < (bpp === 8 ? 256 : 0); i += 1) {
		bmp[BMP_HEADER_SIZE + i * 4] = i;
		bmp[BMP_HEADER_SIZE + i * 4 + 1] = (i * 3) & 0xff;
		bmp[BMP_HEADER_SIZE + i * 4 + 2] = (i * 7) & 0xff;
	}
	for (let i = 0; i < stride * height; i += 1)
		bmp[dataOffset + i] = (i * 23 + 5) & 0xff;
	return bmp;
}

/**
 * Masks the *whole* file, which is what makes the port's behaviour visible: it restores the first hundred bytes
 * and passes everything past them through untouched, so a file masked further than that stays masked there.
 */
function maskAll(bmp: Buffer): Buffer {
	const stored = Buffer.from(bmp);
	for (let i = 0; i < stored.length; i += 1)
		stored[i] = (stored[i] ?? 0) ^ XOR_KEY;
	return stored;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("blue-gale bbm image", () => {
	it("declares no signature and no extension gate", () => {
		expect(bbmImageFormat.detection?.signatures).toEqual([]);
		expect(bbmImageFormat.descriptor.extensions).toEqual(["bbm"]);
	});

	it("unmasks the first hundred bytes of a bitmap", async () => {
		const bmp = buildBmp(24);
		const stored = maskAll(bmp);
		// The mask turns `BM` into the marker the reference looks for, and the check is made before unmasking.
		expect(stored.readUInt16LE(0)).toBe(0xb2bd);
		expect(stored.readUInt16LE(0)).toBe((0x4d42 ^ 0xffff) & 0xffff);
		const source = sourceOf(stored);
		expect(await bbmImageFormat.detect(source, "CG01.BBM")).toBe(true);
		const archive = await bbmImageFormat.open(source, "CG01.BBM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				encrypted: true,
				unmaskSize: UNMASK_SIZE,
				width: 8,
				height: 2,
				bitsPerPixel: 24,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// The bitmap is a little longer than the prefix, so its first hundred bytes are restored and the two
			// past them keep the mask the file stored.
			expect(bmp.length).toBe(102);
			expect(output.subarray(0, UNMASK_SIZE)).toEqual(
				bmp.subarray(0, UNMASK_SIZE),
			);
			expect(output.subarray(UNMASK_SIZE)).toEqual(
				Buffer.from(
					[...bmp.subarray(UNMASK_SIZE)].map((byte) => byte ^ XOR_KEY),
				),
			);
		} finally {
			await archive.close();
		}
	});

	it("leaves everything past the prefix masked", async () => {
		// An eight bit image is longer than a hundred bytes, so its palette is not unmasked: the reference
		// prefixes only the first hundred bytes to the untouched remainder.
		const bmp = buildBmp(8);
		const stored = maskAll(bmp);
		expect(bmp.length).toBeGreaterThan(UNMASK_SIZE);
		const archive = await bbmImageFormat.open(sourceOf(stored), "CG01.BBM");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(bmp.length);
			// Restored inside the prefix and still masked beyond it.
			expect(output.subarray(0, UNMASK_SIZE)).toEqual(
				bmp.subarray(0, UNMASK_SIZE),
			);
			const paletteOffset = BMP_HEADER_SIZE + 200 * 4;
			expect(paletteOffset).toBeGreaterThan(UNMASK_SIZE);
			expect(output[paletteOffset]).toBe((bmp[paletteOffset] ?? 0) ^ XOR_KEY);
		} finally {
			await archive.close();
		}
	});

	it("rejects the marker, the reserved word and the header size", async () => {
		const marker = maskAll(buildBmp(24));
		marker[0] = 0x00;
		expect(await bbmImageFormat.detect(sourceOf(marker), "CG01.BBM")).toBe(
			false,
		);
		const reserved = maskAll(buildBmp(24));
		reserved.writeUInt32LE(0x12345678, 6);
		expect(await bbmImageFormat.detect(sourceOf(reserved), "CG01.BBM")).toBe(
			false,
		);
		// The unmasked header size has to be forty; masking a wrong value keeps it wrong.
		const dib = maskAll(buildBmp(24));
		dib.writeUInt32LE(0x29 ^ XOR_KEY, 0x0e);
		expect(await bbmImageFormat.detect(sourceOf(dib), "CG01.BBM")).toBe(false);
	});

	it("lists a file too short to hold the unmasked prefix but fails to extract it", async () => {
		// Detection needs only thirty two bytes; extraction unmasks a hundred.
		const stored = maskAll(buildBmp(24)).subarray(0, META_SIZE + 8);
		expect(await bbmImageFormat.detect(sourceOf(stored), "CG01.BBM")).toBe(
			true,
		);
		const archive = await bbmImageFormat.open(sourceOf(stored), "CG01.BBM");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a short header and zero dimensions", async () => {
		expect(
			await bbmImageFormat.detect(
				sourceOf(maskAll(buildBmp(24)).subarray(0, META_SIZE - 1)),
				"CG01.BBM",
			),
		).toBe(false);
		const bmp = buildBmp(24);
		bmp.writeInt32LE(0, 22);
		expect(
			await bbmImageFormat.detect(sourceOf(maskAll(bmp)), "CG01.BBM"),
		).toBe(false);
	});
});
