import { BufferByteSource } from "@garbro-mcp/core";
import { mbImageDescriptor, mbImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
/** Every tag the reference accepts in place of the bitmap's own marker. */
const PREFIXES = ["MB", "MC", "MK", "CL", "XX"];

/** A twenty four bit bitmap, then its first two bytes replaced by `tag`. */
function buildObfuscated(tag: string, width = 3, height = 2): Buffer {
	const stride = (width * 3 + 3) & ~3;
	const pixels: Buffer = Buffer.alloc(stride * height, 0x60);
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
	bitmap.write(tag, 0, "latin1");
	return bitmap;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("obfuscated bitmap", () => {
	it("declares no signature and the reference extensions", () => {
		expect(mbImageFormat.detection?.signatures).toEqual([]);
		expect(mbImageDescriptor.extensions).toEqual(["bmp", "gra", "xxx"]);
	});

	it("restores the bitmap marker for every accepted tag", async () => {
		for (const tag of PREFIXES) {
			const stored = buildObfuscated(tag);
			const source = sourceOf(stored);
			expect(await mbImageFormat.detect(source, "CG.BMP")).toBe(true);
			const archive = await mbImageFormat.open(source, "CG.BMP");
			try {
				expect(archive.metadata).toMatchObject({
					image: "bmp",
					storedTag: tag,
					width: 3,
					height: 2,
					bitsPerPixel: 24,
				});
				expect(archive.entries[0]?.metadata).toMatchObject({
					type: "image",
					width: 3,
					height: 2,
					bitsPerPixel: 24,
				});
				// Only two bytes differ, so the listed size is the extracted size.
				expect(archive.entries[0]?.size).toBe(BigInt(stored.length));
				const entry = archive.entries[0];
				if (!entry) throw new Error("missing entry");
				const output = await consumeBuffer(await archive.openEntry(entry.id));
				expect(output.length).toBe(stored.length);
				expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
				// Everything from the third byte on is untouched.
				expect(output.subarray(2)).toEqual(stored.subarray(2));
			} finally {
				await archive.close();
			}
		}
	});

	it("declines a plain bitmap whose marker is intact", async () => {
		const stored = buildObfuscated("BM");
		expect(await mbImageFormat.detect(sourceOf(stored), "CG.BMP")).toBe(false);
	});

	it("declines a tag the reference does not list", async () => {
		const stored = buildObfuscated("ZZ");
		expect(await mbImageFormat.detect(sourceOf(stored), "CG.BMP")).toBe(false);
	});

	it("declines an accepted tag whose payload is not a bitmap", async () => {
		const stored = buildObfuscated("MB");
		// Break the DIB header size, which the metadata reader requires to be at least forty.
		stored.writeUInt32LE(12, 14);
		expect(await mbImageFormat.detect(sourceOf(stored), "CG.BMP")).toBe(false);
	});

	it("declines a file too short to hold a bitmap header", async () => {
		expect(
			await mbImageFormat.detect(
				sourceOf(Buffer.from("MB", "latin1")),
				"CG.BMP",
			),
		).toBe(false);
	});
});
