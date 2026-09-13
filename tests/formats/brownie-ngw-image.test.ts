import { BufferByteSource } from "@garbro-mcp/core";
import {
	mbImageFormat,
	ngwImageDescriptor,
	ngwImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
const TAG = "NG";

/** A twenty four bit bitmap whose first two bytes are replaced by the tag. */
function buildNgw(width = 3, height = 2): Buffer {
	const stride = (width * 3 + 3) & ~3;
	const pixels: Buffer = Buffer.alloc(stride * height, 0x5a);
	const bitmap: Buffer = Buffer.alloc(BMP_HEADER_SIZE + pixels.length, 0);
	bitmap.write("BM", 0, "latin1");
	bitmap.writeUInt32LE(bitmap.length, 2);
	bitmap.writeUInt32LE(BMP_HEADER_SIZE, 10);
	bitmap.writeUInt32LE(40, 14);
	bitmap.writeInt32LE(width, 18);
	bitmap.writeInt32LE(height, 22);
	bitmap.writeUInt16LE(1, 26);
	bitmap.writeUInt16LE(24, 28);
	bitmap.writeUInt32LE(pixels.length, 34);
	pixels.copy(bitmap, BMP_HEADER_SIZE);
	bitmap.write(TAG, 0, "latin1");
	return bitmap;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("brownie ngw obfuscated bitmap", () => {
	it("declares no signature and the ngw extension", () => {
		expect(ngwImageFormat.detection?.signatures).toEqual([]);
		expect(ngwImageDescriptor.extensions).toEqual(["ngw"]);
	});

	it("restores the bitmap marker", async () => {
		const stored = buildNgw();
		const source = sourceOf(stored);
		expect(await ngwImageFormat.detect(source, "CG01.NGW")).toBe(true);
		const archive = await ngwImageFormat.open(source, "CG01.NGW");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				storedTag: TAG,
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(stored.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.subarray(2)).toEqual(stored.subarray(2));
			expect(output.length).toBe(stored.length);
		} finally {
			await archive.close();
		}
	});

	it("declines a bitmap tagged for another subclass", async () => {
		const stored = buildNgw();
		stored.write("GD", 0, "latin1");
		expect(await ngwImageFormat.detect(sourceOf(stored), "CG01.NGW")).toBe(
			false,
		);
		// The base class does not accept this tag either, since it lists only its own five.
		expect(await mbImageFormat.detect(sourceOf(stored), "CG01.NGW")).toBe(
			false,
		);
	});

	it("declines a plain bitmap and a short file", async () => {
		const stored = buildNgw();
		stored.write("BM", 0, "latin1");
		expect(await ngwImageFormat.detect(sourceOf(stored), "CG01.NGW")).toBe(
			false,
		);
		expect(
			await ngwImageFormat.detect(
				sourceOf(Buffer.from(TAG, "latin1")),
				"CG01.NGW",
			),
		).toBe(false);
	});
});
