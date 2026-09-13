import { BufferByteSource } from "@garbro-mcp/core";
import {
	pnxEncryptedImageDescriptor,
	pnxEncryptedImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** `PnxFormat.Signature`, written out as bytes. */
const SIGNATURE = Buffer.from([0xe1, 0x38, 0x26, 0x2f]);
/** `(byte)(0xE1 ^ 0x89)`, the key `GuessEncryptionKey` always produces. */
const KEY = 0x68;
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function xor(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] as number) ^ KEY;
	return output;
}

/** A plausible PNG: signature, an IHDR chunk and a few trailing bytes. */
function buildPng(
	width = 0x40,
	height = 0x30,
	bitDepth = 8,
	colourType = 2,
): Buffer {
	const ihdr: Buffer = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.writeUInt8(bitDepth, 8);
	ihdr.writeUInt8(colourType, 9);
	const chunk: Buffer = Buffer.alloc(8);
	chunk.writeUInt32BE(13, 0);
	chunk.write("IHDR", 4, "latin1");
	const tail: Buffer = Buffer.alloc(0x20, 0x5a);
	return Buffer.concat([PNG_SIGNATURE, chunk, ihdr, tail]);
}

function buildEncrypted(...args: Parameters<typeof buildPng>): Buffer {
	return xor(buildPng(...args));
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("encrypted png image", () => {
	it("declares the signature that the key derivation implies", () => {
		expect(pnxEncryptedImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(pnxEncryptedImageDescriptor.extensions).toEqual(["pnx"]);
		// The reference derives the key from the signature itself, so a real file must start with it.
		expect(buildEncrypted().subarray(0, 4)).toEqual(SIGNATURE);
		expect(0xe1 ^ 0x89).toBe(KEY);
	});

	it("decrypts the whole file back to the original png", async () => {
		const plain = buildPng();
		const stored = buildEncrypted();
		const source = sourceOf(stored);
		expect(await pnxEncryptedImageFormat.detect(source, "EV01.PNX")).toBe(true);
		const archive = await pnxEncryptedImageFormat.open(source, "EV01.PNX");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["EV01.png"]);
			expect(archive.metadata).toMatchObject({
				image: "png",
				encrypted: true,
				bitDepth: 8,
				colorType: 2,
				channels: 3,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x40,
				height: 0x30,
				bitsPerPixel: 24,
				encrypted: true,
			});
			// The cipher preserves the length, so the listed size is the extracted size.
			expect(archive.entries[0]?.size).toBe(BigInt(stored.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(plain);
			expect(output.length).toBe(stored.length);
		} finally {
			await archive.close();
		}
	});

	it("reports the channel count for a sixteen bit grey image", async () => {
		const stored = buildEncrypted(0x100, 0x80, 16, 0);
		expect(
			await pnxEncryptedImageFormat.detect(sourceOf(stored), "EV02.PNX"),
		).toBe(true);
		const archive = await pnxEncryptedImageFormat.open(
			sourceOf(stored),
			"EV02.PNX",
		);
		try {
			expect(archive.metadata).toMatchObject({
				channels: 1,
				bitsPerPixel: 16,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 0x100,
				height: 0x80,
			});
		} finally {
			await archive.close();
		}
	});

	it("declines a plain unencrypted png", async () => {
		expect(
			await pnxEncryptedImageFormat.detect(sourceOf(buildPng()), "EV01.PNX"),
		).toBe(false);
	});

	it("declines a chunk whose length is not thirteen", async () => {
		const stored = xor(
			(() => {
				const png = buildPng();
				png.writeUInt32BE(12, 8);
				return png;
			})(),
		);
		expect(
			await pnxEncryptedImageFormat.detect(sourceOf(stored), "EV01.PNX"),
		).toBe(false);
	});

	it("declines an unknown colour type", async () => {
		const stored = buildEncrypted(0x10, 0x10, 8, 5);
		expect(
			await pnxEncryptedImageFormat.detect(sourceOf(stored), "EV01.PNX"),
		).toBe(false);
	});

	it("declines a header that is too short", async () => {
		// 28 bytes: the signature and chunk header are present but the IHDR body is cut short.
		const stored = buildEncrypted().subarray(0, 0x1c);
		expect(
			await pnxEncryptedImageFormat.detect(sourceOf(stored), "EV01.PNX"),
		).toBe(false);
	});
});
