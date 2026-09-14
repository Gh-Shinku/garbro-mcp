import { BufferByteSource } from "@garbro-mcp/core";
import { MsvcRandom } from "@garbro-mcp/codecs";
import { slgTigImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const DEFAULT_KEY = 0x7f7f7f7f;

interface PngOptions {
	width?: number;
	height?: number;
	depth?: number;
	colourType?: number;
	signature?: Buffer;
}

/** A portable network graphic down to its header: the chunk's checksum is never read. */
function buildPng(options: PngOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(13, 0x00);
	header.writeUInt32BE(options.width ?? 32, 0);
	header.writeUInt32BE(options.height ?? 24, 4);
	header[8] = options.depth ?? 8;
	header[9] = options.colourType ?? 6;
	return Buffer.concat([
		options.signature ?? PNG_SIGNATURE,
		Buffer.from([0x00, 0x00, 0x00, 0x0d]),
		Buffer.from("IHDR", "latin1"),
		header,
		Buffer.alloc(4, 0x00),
		Buffer.alloc(16, 0x33),
	]);
}

/** The transform the format reads through, from the other side: a draw's low byte is added. */
function encrypt(png: Buffer, key: number = DEFAULT_KEY): Buffer {
	const random = new MsvcRandom(key);
	const out = Buffer.from(png);
	for (let index = 0; index < out.length; index += 1) {
		out[index] = ((out[index] ?? 0) + (random.next() & 0xff)) & 0xff;
	}
	return out;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.tig"): Promise<Buffer> {
	const archive = await slgTigImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("SLG system encrypted PNG image", () => {
	it("declares its word and no extension", async () => {
		expect(slgTigImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x8b, 0xc2, 0xf3, 0x7c]) },
		]);
		expect(slgTigImageFormat.descriptor.extensions).toEqual([]);
	});

	it("needs the cipher, and the key it starts from", async () => {
		expect(
			await slgTigImageFormat.detect(sourceOf(encrypt(buildPng())), "CG01.tig"),
		).toBe(true);
		// A plain graphic is not one of these files.
		expect(
			await slgTigImageFormat.detect(sourceOf(buildPng()), "CG01.tig"),
		).toBe(false);
		// A stream scrambled with another seed does not come out as a graphic.
		expect(
			await slgTigImageFormat.detect(
				sourceOf(encrypt(buildPng(), 0x12345678)),
				"CG01.tig",
			),
		).toBe(false);
	});

	it("reads its measurements out of the decrypted header", async () => {
		const archive = await slgTigImageFormat.open(
			sourceOf(
				encrypt(buildPng({ width: 32, height: 24, depth: 8, colourType: 6 })),
			),
			"CG01.tig",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 32,
				height: 24,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "png",
				compression: "slg-tig",
			});
		} finally {
			await archive.close();
		}
	});

	it("hands the decrypted graphic back", async () => {
		const png = buildPng({ width: 7, height: 5 });
		const stored = encrypt(png);
		const output = await extract(stored);
		expect(output.equals(png)).toBe(true);
		// Scrambling the entry's bytes again gives back exactly what the file held.
		expect(encrypt(output).equals(stored)).toBe(true);
	});

	it("refuses a head that is not a graphic after decryption", async () => {
		expect(
			await slgTigImageFormat.detect(
				sourceOf(encrypt(Buffer.alloc(64, 0x5a))),
				"CG01.tig",
			),
		).toBe(false);
		const notPng = buildPng({ signature: Buffer.alloc(8, 0x00) });
		expect(
			await slgTigImageFormat.detect(sourceOf(encrypt(notPng)), "CG01.tig"),
		).toBe(false);
		// A graphic whose palette colour type the reader knows is taken as twenty four bits.
		const palette = buildPng({ depth: 1, colourType: 3 });
		const archive = await slgTigImageFormat.open(
			sourceOf(encrypt(palette)),
			"CG01.tig",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 24 });
		} finally {
			await archive.close();
		}
	});

	it("refuses a depth or a colour type the reader does not know", async () => {
		expect(
			await slgTigImageFormat.detect(
				sourceOf(encrypt(buildPng({ depth: 7 }))),
				"CG01.tig",
			),
		).toBe(false);
		expect(
			await slgTigImageFormat.detect(
				sourceOf(encrypt(buildPng({ colourType: 1 }))),
				"CG01.tig",
			),
		).toBe(false);
		expect(
			await slgTigImageFormat.detect(sourceOf(Buffer.alloc(6)), "CG01.tig"),
		).toBe(false);
	});

	it("refuses to open a file whose decrypted head is not a graphic", async () => {
		await expect(
			slgTigImageFormat.open(
				sourceOf(encrypt(Buffer.alloc(64, 0x5a))),
				"CG01.tig",
			),
		).rejects.toThrow(/SLG encrypted image/);
	});

	it("names the entry after the image", async () => {
		const archive = await slgTigImageFormat.open(
			sourceOf(encrypt(buildPng())),
			"sub/CG07.tig",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.png");
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(true);
		} finally {
			await archive.close();
		}
	});
});
