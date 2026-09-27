import { deflateSync, inflateSync } from "node:zlib";
import { BufferByteSource } from "@garbro-mcp/core";
import { pmpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const XOR_KEY = 0x21;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

const WIDTH = 4;
const HEIGHT = 2;
const STRIDE = 4;

/** An eight bit grey bitmap, the shape `readBmpMetaData` accepts. */
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
		bmp[DATA_OFFSET + i] = (i * 17 + 3) & 0xff;
	for (let i = 0; i < tail; i += 1) bmp[fileSize + i] = 0x5a;
	return bmp;
}

function mask(input: Buffer): Buffer {
	const output = Buffer.alloc(input.length);
	for (let i = 0; i < input.length; i += 1)
		output[i] = (input[i] ?? 0) ^ XOR_KEY;
	return output;
}

function buildPmp(payload = buildBmp()): Buffer {
	return mask(deflateSync(payload));
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("sceneplayer pmp image", () => {
	it("declares no signature and the pmp extension", () => {
		expect(pmpImageFormat.detection?.signatures).toEqual([]);
		expect(pmpImageFormat.descriptor.extensions).toEqual(["pmp"]);
	});

	it("unmasks and inflates a bitmap", async () => {
		const bmp = buildBmp();
		const stored = buildPmp(bmp);
		// The reference peeks the first byte and unmasks it, so the stored value is the masked zlib CMF.
		expect((stored[0] ?? 0) ^ XOR_KEY).toBe(0x78);
		const source = sourceOf(stored);
		expect(await pmpImageFormat.detect(source, "CG01.PMP")).toBe(true);
		const archive = await pmpImageFormat.open(source, "CG01.PMP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "zlib",
				encrypted: true,
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const picture = readBmpImage(output);
			expect(picture).toMatchObject({
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			// A bitmap stores its rows bottom up, so the walk of the picture hands the last row of the file
			// over first.
			const expected: number[] = [];
			for (let row = HEIGHT - 1; row >= 0; row -= 1) {
				for (let i = 0; i < STRIDE; i += 1)
					expected.push((row * STRIDE * 17 + i * 17 + 3) & 0xff);
			}
			expect([...(picture?.pixels ?? [])]).toEqual(expected);
		} finally {
			await archive.close();
		}
	});

	it("reads the places of the picture of the head of the bitmap alone", async () => {
		const bmp = buildBmp(16);
		const stored = buildPmp(bmp);
		const archive = await pmpImageFormat.open(sourceOf(stored), "CG01.PMP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// The sixteen places behind the picture stand of no count of the walk, so the picture stands of the
			// same places as the one of a file that ends with it.
			expect(readBmpImage(output)).toEqual(readBmpImage(bmp));
		} finally {
			await archive.close();
		}
	});

	it("declines a stream that is not a bitmap", async () => {
		const stored = mask(deflateSync(Buffer.from("not a bitmap", "latin1")));
		expect(await pmpImageFormat.detect(sourceOf(stored), "CG01.PMP")).toBe(
			false,
		);
	});

	it("declines a wrong first byte and an unmasked file", async () => {
		const wrong = buildPmp();
		wrong[0] = 0x11;
		expect(await pmpImageFormat.detect(sourceOf(wrong), "CG01.PMP")).toBe(
			false,
		);
		// Stored without the mask the first byte is the zlib CMF and the mask check fails.
		const plain = deflateSync(buildBmp());
		expect(await pmpImageFormat.detect(sourceOf(plain), "CG01.PMP")).toBe(
			false,
		);
	});

	it("declines a corrupted stream and a truncated file", async () => {
		const corrupted = buildPmp();
		corrupted[4] = (corrupted[4] ?? 0) ^ 0xff;
		expect(await pmpImageFormat.detect(sourceOf(corrupted), "CG01.PMP")).toBe(
			false,
		);
		expect(
			await pmpImageFormat.detect(
				sourceOf(buildPmp().subarray(0, 1)),
				"CG01.PMP",
			),
		).toBe(false);
	});

	it("round trips through the mask relation", async () => {
		// The mask is applied to the whole file, so re-masking the stored bytes recovers the zlib stream.
		const stored = buildPmp();
		const recovered = mask(stored);
		expect(recovered[0]).toBe(0x78);
		expect(() => inflateSync(recovered)).not.toThrow();
	});
});
