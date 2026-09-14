import { BufferByteSource } from "@garbro-mcp/core";
import { Rc4 } from "@garbro-mcp/codecs";
import {
	DOGENZAKA_PNG_RC4_KEY,
	dogenzakaRc4PngImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface PngOptions {
	width?: number;
	height?: number;
	depth?: number;
	colourType?: number;
	/** Replaces the signature, for the case where the decrypted head is not a graphic at all. */
	signature?: Buffer;
}

/** A portable network graphic down to its header: the chunk's checksum is never read. */
function buildPng(options: PngOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(13, 0x00);
	header.writeUInt32BE(options.width ?? 40, 0);
	header.writeUInt32BE(options.height ?? 30, 4);
	header[8] = options.depth ?? 8;
	header[9] = options.colourType ?? 2;
	const chunk = Buffer.concat([
		Buffer.from([0x00, 0x00, 0x00, 0x0d]),
		Buffer.from("IHDR", "latin1"),
		header,
		Buffer.alloc(4, 0x00),
	]);
	return Buffer.concat([
		options.signature ?? PNG_SIGNATURE,
		chunk,
		Buffer.alloc(24, 0x11),
	]);
}

function encrypt(data: Buffer): Buffer {
	return new Rc4(DOGENZAKA_PNG_RC4_KEY).xor(data);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.a"): Promise<Buffer> {
	const archive = await dogenzakaRc4PngImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("RC4 encrypted PNG image", () => {
	it("declares its word and extension", async () => {
		expect(dogenzakaRc4PngImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x1a, 0xf6, 0xf7, 0xc4]) },
		]);
		expect(dogenzakaRc4PngImageFormat.descriptor.extensions).toEqual(["a"]);
	});

	it("needs the cipher, so a plain graphic is not one of these", async () => {
		expect(
			await dogenzakaRc4PngImageFormat.detect(
				sourceOf(encrypt(buildPng())),
				"CG01.a",
			),
		).toBe(true);
		expect(
			await dogenzakaRc4PngImageFormat.detect(sourceOf(buildPng()), "CG01.a"),
		).toBe(false);
	});

	it("reads its measurements out of the decrypted header", async () => {
		const archive = await dogenzakaRc4PngImageFormat.open(
			sourceOf(encrypt(buildPng({ width: 40, height: 30 }))),
			"CG01.a",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 40,
				height: 30,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "png",
				compression: "rc4",
			});
		} finally {
			await archive.close();
		}
	});

	it("takes a palette graphic as twenty four bits and a grey one at its own depth", async () => {
		const palette = await dogenzakaRc4PngImageFormat.open(
			sourceOf(encrypt(buildPng({ depth: 4, colourType: 3 }))),
			"CG01.a",
		);
		try {
			expect(palette.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 24 });
		} finally {
			await palette.close();
		}
		const grey = await dogenzakaRc4PngImageFormat.open(
			sourceOf(encrypt(buildPng({ depth: 4, colourType: 0 }))),
			"CG01.a",
		);
		try {
			expect(grey.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 4 });
		} finally {
			await grey.close();
		}
	});

	it("hands the decrypted graphic back", async () => {
		const png = buildPng({ width: 8, height: 6 });
		const stored = encrypt(png);
		const output = await extract(stored);
		expect(output.equals(png)).toBe(true);
		// The entry's bytes put through the cipher are the ones the file held.
		expect(new Rc4(DOGENZAKA_PNG_RC4_KEY).xor(output).equals(stored)).toBe(
			true,
		);
	});

	it("refuses a head that is not a graphic after decryption", async () => {
		expect(
			await dogenzakaRc4PngImageFormat.detect(
				sourceOf(encrypt(Buffer.alloc(64, 0xa5))),
				"CG01.a",
			),
		).toBe(false);
		const notPng = buildPng({ signature: Buffer.alloc(8, 0x00) });
		expect(
			await dogenzakaRc4PngImageFormat.detect(
				sourceOf(encrypt(notPng)),
				"CG01.a",
			),
		).toBe(false);
	});

	it("refuses a depth or a colour type the reader does not know", async () => {
		expect(
			await dogenzakaRc4PngImageFormat.detect(
				sourceOf(encrypt(buildPng({ depth: 3 }))),
				"CG01.a",
			),
		).toBe(false);
		expect(
			await dogenzakaRc4PngImageFormat.detect(
				sourceOf(encrypt(buildPng({ colourType: 5 }))),
				"CG01.a",
			),
		).toBe(false);
		expect(
			await dogenzakaRc4PngImageFormat.detect(
				sourceOf(Buffer.alloc(5)),
				"CG01.a",
			),
		).toBe(false);
	});

	it("names the entry after the image", async () => {
		const archive = await dogenzakaRc4PngImageFormat.open(
			sourceOf(encrypt(buildPng())),
			"sub/CG07.a",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.png");
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(true);
		} finally {
			await archive.close();
		}
	});

	it("refuses to open a file whose decrypted head is not a graphic", async () => {
		await expect(
			dogenzakaRc4PngImageFormat.open(
				sourceOf(encrypt(Buffer.alloc(64, 0xa5))),
				"CG01.a",
			),
		).rejects.toThrow(/RC4 encrypted PNG/);
	});
});
