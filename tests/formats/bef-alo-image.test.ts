import { BufferByteSource } from "@garbro-mcp/core";
import { aloImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

const WIDTH = 4;
const HEIGHT = 2;
const STRIDE = 4;

function buildBmp(tail = 0): Buffer {
	const fileSize = DATA_OFFSET + STRIDE * HEIGHT;
	const bmp: Buffer = Buffer.alloc(fileSize + tail, 0x00);
	bmp.write("BM", 0, "latin1");
	bmp.writeUInt32LE(fileSize, 2);
	bmp.writeUInt32LE(DATA_OFFSET, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(WIDTH, 18);
	bmp.writeInt32LE(HEIGHT, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(8, 28);
	bmp.writeUInt32LE(STRIDE * HEIGHT, 34);
	for (let i = 0; i < 256; i += 1) {
		bmp[BMP_HEADER_SIZE + i * 4] = i;
		bmp[BMP_HEADER_SIZE + i * 4 + 1] = i;
		bmp[BMP_HEADER_SIZE + i * 4 + 2] = i;
	}
	for (let i = 0; i < STRIDE * HEIGHT; i += 1)
		bmp[DATA_OFFSET + i] = (i * 19 + 7) & 0xff;
	for (let i = 0; i < tail; i += 1) bmp[fileSize + i] = 0x4d;
	return bmp;
}

/** The obfuscation the reference writes: two zero bytes in place of the marker. */
function obfuscate(bmp: Buffer): Buffer {
	const stored = Buffer.from(bmp);
	stored[0] = 0;
	stored[1] = 0;
	return stored;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("bef alo image", () => {
	it("declares no signature and the alo extension", () => {
		expect(aloImageFormat.detection?.signatures).toEqual([]);
		expect(aloImageFormat.descriptor.extensions).toEqual(["alo"]);
	});

	it("restores the marker and reads the bitmap", async () => {
		const bmp = buildBmp();
		const stored = obfuscate(bmp);
		const source = sourceOf(stored);
		expect(await aloImageFormat.detect(source, "CG01.ALO")).toBe(true);
		const archive = await aloImageFormat.open(source, "CG01.ALO");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				encrypted: true,
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// Restoring the two bytes recovers the original bitmap exactly.
			expect(output).toEqual(bmp);
		} finally {
			await archive.close();
		}
	});

	it("trims data past the declared bitmap size", async () => {
		const bmp = buildBmp(20);
		const stored = obfuscate(bmp);
		const archive = await aloImageFormat.open(sourceOf(stored), "CG01.ALO");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(bmp.length - 20);
			expect(output).toEqual(bmp.subarray(0, bmp.length - 20));
		} finally {
			await archive.close();
		}
	});

	it("requires the two zeroed bytes", async () => {
		// A plain bitmap has `BM` there, so the marker check fails.
		const plain = buildBmp();
		expect(await aloImageFormat.detect(sourceOf(plain), "CG01.ALO")).toBe(
			false,
		);
		const oneZero = obfuscate(buildBmp());
		oneZero[1] = 0x00;
		oneZero[0] = 0x00;
		expect(oneZero[0]).toBe(0);
		// Only the first byte zeroed is not enough.
		const half = obfuscate(buildBmp());
		half[1] = 0x4d;
		expect(await aloImageFormat.detect(sourceOf(half), "CG01.ALO")).toBe(false);
	});

	it("requires the alo extension", async () => {
		const stored = obfuscate(buildBmp());
		expect(await aloImageFormat.detect(sourceOf(stored), "CG01.BMP")).toBe(
			false,
		);
		expect(await aloImageFormat.detect(sourceOf(stored), "CG01.alo")).toBe(
			true,
		);
	});

	it("declines a payload that is not a bitmap", async () => {
		const stored = Buffer.concat([
			Buffer.alloc(2, 0x00),
			Buffer.alloc(64, 0x5a),
		]);
		expect(await aloImageFormat.detect(sourceOf(stored), "CG01.ALO")).toBe(
			false,
		);
	});

	it("declines a short file and zero dimensions", async () => {
		expect(
			await aloImageFormat.detect(sourceOf(Buffer.alloc(3, 0x00)), "CG01.ALO"),
		).toBe(false);
		const bmp = buildBmp();
		bmp.writeInt32LE(0, 22);
		expect(
			await aloImageFormat.detect(sourceOf(obfuscate(bmp)), "CG01.ALO"),
		).toBe(false);
	});
});
