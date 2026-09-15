import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decryptUtage,
	utageImageFormat,
} from "../../packages/formats/src/unity/utage-image.js";

const KEY = Buffer.from("InputOriginalKey", "utf8");

/** The signature of a PNG behind the key, which is what the reference registers the format under. */
const ENCRYPTED_PNG_SIGNATURE = Buffer.from([0xc0, 0x3e, 0x3e, 0x32]);

function pngOf(width: number, height: number): Buffer {
	const png: Buffer = Buffer.alloc(33, 0);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
	png.writeUInt32BE(13, 8);
	png.write("IHDR", 12, "latin1");
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	png[24] = 8;
	png[25] = 6;
	return png;
}

function jpegOf(width: number, height: number): Buffer {
	// The marker, the length word and fourteen bytes of payload, which is what the length counts.
	const app0: Buffer = Buffer.alloc(2 + 2 + 14, 0);
	app0.writeUInt16BE(0xffe0, 0);
	app0.writeUInt16BE(16, 2);
	app0.write("JFIF\0", 4, "latin1");
	const frame: Buffer = Buffer.alloc(2 + 2 + 15, 0);
	frame.writeUInt16BE(0xffc0, 0);
	frame.writeUInt16BE(17, 2);
	frame[4] = 8;
	frame.writeUInt16BE(height, 5);
	frame.writeUInt16BE(width, 7);
	frame[9] = 3;
	return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.dat"): Promise<Buffer> {
	const handle = await utageImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Utage engine encrypted image", () => {
	const png = pngOf(0x0140, 0x00f0);
	const jpeg = jpegOf(0x0140, 0x00f0);
	const encryptedPng = decryptUtage(png);
	const encryptedJpeg = decryptUtage(jpeg);

	it("keeps a byte of nothing and a byte of the key where they are", () => {
		// The rule of the reference is its own opposite: the plain byte and the plain byte that is the key
		// byte are the two it leaves alone.
		const plain: Buffer = Buffer.alloc(KEY.length * 2, 0);
		KEY.copy(plain, 0);
		plain[KEY.length] = 0x00;
		const turned = decryptUtage(plain);
		expect(turned.subarray(0, KEY.length)).toEqual(KEY);
		expect(turned[KEY.length]).toBe(0x00);
		expect(decryptUtage(turned)).toEqual(plain);
	});

	it("carries the signature of a PNG behind the key", () => {
		expect(encryptedPng.subarray(0, 4)).toEqual(ENCRYPTED_PNG_SIGNATURE);
	});

	it("finds a picture behind the key", async () => {
		expect(await utageImageFormat.detect(sourceOf(encryptedPng))).toBe(true);
		// A JPEG carries no word of its own, so the format is offered to every file and reads it.
		expect(await utageImageFormat.detect(sourceOf(encryptedJpeg))).toBe(true);
		// A picture that is not behind the key is mangled by it, and neither picture remains.
		expect(await utageImageFormat.detect(sourceOf(png))).toBe(false);
		expect(await utageImageFormat.detect(sourceOf(jpeg))).toBe(false);
		expect(
			await utageImageFormat.detect(sourceOf(Buffer.alloc(64, 0x41))),
		).toBe(false);
	});

	it("reports what the picture behind the key says about itself", async () => {
		const pngHandle = await utageImageFormat.open(
			sourceOf(encryptedPng),
			"dir/cg.dat",
		);
		expect(pngHandle.entries[0]?.path).toBe("cg.png");
		expect(pngHandle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 0x0140,
			height: 0x00f0,
			bitsPerPixel: 32,
		});
		const jpegHandle = await utageImageFormat.open(
			sourceOf(encryptedJpeg),
			"dir/cg.dat",
		);
		expect(jpegHandle.entries[0]?.path).toBe("cg.jpg");
		expect(jpegHandle.entries[0]?.metadata).toMatchObject({
			width: 0x0140,
			height: 0x00f0,
			bitsPerPixel: 24,
		});
	});

	it("hands the picture out behind the key", async () => {
		expect(await extract(encryptedPng)).toEqual(png);
		expect(await extract(encryptedJpeg)).toEqual(jpeg);
	});

	it("refuses a file that is not a picture behind the key", async () => {
		await expect(extract(png)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
