import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { BufferByteSource } from "@garbro-mcp/core";
import { gssImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const BLOCK_SIZE = 4;
const PERIOD = 31;
/** The key commented out in the reference; it yields the first declared signature word. */
const KEY = 0x20040915;
const TAG_WORD = 0x00535347;

function rotateLeft32(value: number, count: number): number {
	const shift = count & 31;
	return (value << shift) | (value >>> (32 - shift));
}

/** The same keystream the port uses, so encryption is a plain exclusive-or away. */
function crypt(data: Buffer, key: number): Buffer {
	const output: Buffer = Buffer.alloc(data.length);
	for (let i = 0; i < data.length; i += 1) {
		const block = Math.floor(i / BLOCK_SIZE);
		const word = rotateLeft32(
			(key + Math.floor(block / PERIOD)) >>> 0,
			block % PERIOD,
		);
		const mask = (word >>> ((i % BLOCK_SIZE) * 8)) & 0xff;
		output[i] = (data[i] ?? 0) ^ mask;
	}
	return output;
}

/** Builds a bitmap: a header length, the dimensions, the depth and some pixels. */
function buildBitmap(width = 0x40, height = 0x20, bpp = 32): Buffer {
	const pixels = Buffer.alloc(width * height * (bpp / 8), 0x5b);
	const header = Buffer.alloc(0x28, 0);
	header.writeInt32LE(0x28, 0);
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header.writeInt16LE(bpp, 0xe);
	return Buffer.concat([header, pixels]);
}

/** Builds an encrypted, compressed image resource. */
function buildGss(bitmap = buildBitmap(), unpackedSize?: number): Buffer {
	const plain = Buffer.concat([
		Buffer.from("GSS\0", "latin1"),
		Buffer.alloc(4),
		deflateSync(bitmap),
	]);
	plain.writeInt32LE(unpackedSize ?? bitmap.length, 4);
	return crypt(plain, KEY);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ags32i gss image", () => {
	it("computes the declared signature from the key", () => {
		// The stored word is the tag exclusive-ored with the key, which is what the registry matches.
		expect((TAG_WORD ^ KEY) >>> 0).toBe(0x20575a52);
		expect(gssImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x52, 0x5a, 0x57, 0x20]) },
			{ bytes: Buffer.from([0x42, 0x42, 0x57, 0x20]) },
			{ bytes: Buffer.from([0x46, 0x43, 0x57, 0x20]) },
			{ bytes: Buffer.alloc(4) },
		]);
	});

	it("decrypts and inflates the bitmap", async () => {
		const bitmap = buildBitmap();
		const file = buildGss(bitmap);
		const source = sourceOf(file);
		expect(await gssImageFormat.detect(source, "CG01.GSS")).toBe(true);
		const archive = await gssImageFormat.open(source, "CG01.GSS");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x40,
				height: 0x20,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 0x40,
				height: 0x20,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				bitmap,
			);
		} finally {
			await archive.close();
		}
	});

	it("accepts a twenty four bit bitmap", async () => {
		const bitmap = buildBitmap(0x20, 0x10, 24);
		const source = sourceOf(buildGss(bitmap));
		const archive = await gssImageFormat.open(source, "CG02.GSS");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 0x20,
				height: 0x10,
				bitsPerPixel: 24,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				bitmap,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose tag does not survive decryption", async () => {
		const file = buildGss();
		file[0] = (file[0] ?? 0) ^ 0x01;
		expect(await gssImageFormat.detect(sourceOf(file), "CG01.GSS")).toBe(false);
	});

	it("declines a non positive unpacked size", async () => {
		const file = buildGss(buildBitmap(), 0);
		expect(await gssImageFormat.detect(sourceOf(file), "CG01.GSS")).toBe(false);
	});

	it("declines a header length that reaches the unpacked size", async () => {
		const file = buildGss(buildBitmap(), 0x28);
		expect(await gssImageFormat.detect(sourceOf(file), "CG01.GSS")).toBe(false);
	});

	it("declines a file whose payload is not compressed", async () => {
		const plain = Buffer.concat([
			Buffer.from("GSS\0", "latin1"),
			Buffer.alloc(4),
			Buffer.alloc(0x40, 0x7f),
		]);
		plain.writeInt32LE(0x100, 4);
		const file = crypt(plain, KEY);
		expect(await gssImageFormat.detect(sourceOf(file), "CG01.GSS")).toBe(false);
	});

	it("declines an unknown signature word", async () => {
		const file = buildGss();
		file.writeUInt32LE(0x12345678, 0);
		expect(await gssImageFormat.detect(sourceOf(file), "CG01.GSS")).toBe(false);
	});

	it("still inflates the payload the codec returns", async () => {
		// Guards the helper import: the inflated bitmap must match what the codec produces.
		const bitmap = buildBitmap(8, 4, 24);
		const inflated = await inflateZlibBuffer(deflateSync(bitmap));
		expect(inflated).toEqual(bitmap);
	});
});
