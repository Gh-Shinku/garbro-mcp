import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { kurumiGraLegacyImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x97, 0xa3, 0x2f, 0xee]);
const HEADER_SIZE = 0x14;

/**
 * The cipher of the reference, written a second way: a congruential sequence held to thirty-two bits by
 * `BigInt` rather than by `Math.imul`, and **added** because the reference's reader subtracts it.
 */
function encrypt(plain: Buffer): Buffer {
	const output: Buffer = Buffer.alloc(plain.length);
	let seed = 34567n;
	for (let i = 0; i < plain.length; i += 1) {
		const key = Number((BigInt.asIntN(32, seed) >> 8n) & 0xffn);
		output[i] = ((plain[i] ?? 0) + key) & 0xff;
		seed = BigInt.asIntN(32, 5n * seed - 1n);
	}
	return output;
}

interface GraFixture {
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	/** The two bytes of every pixel, as the file stores them. */
	pixels: number[];
}

function buildGra(fixture: GraFixture): Buffer {
	const header = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeInt32LE(0x10, 0);
	header.writeInt16LE(fixture.offsetX ?? 0, 0xc);
	header.writeInt16LE(fixture.offsetY ?? 0, 0xe);
	header.writeUInt16LE(fixture.width, 0x10);
	header.writeUInt16LE(fixture.height, 0x12);
	return encrypt(Buffer.concat([header, Buffer.from(fixture.pixels)]));
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer): Promise<Buffer> {
	const archive = await kurumiGraLegacyImageFormat.open(
		sourceOf(file),
		"CG01.GRA",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Kurumi encrypted image", () => {
	it("finds its files by the cipher of the word it expects behind it", async () => {
		// The reference's own word is what its cipher makes of the plaintext word, which is a check of the
		// sequence's first steps against a constant the reference declares itself.
		expect(encrypt(Buffer.from([0x10, 0, 0, 0])).toString("hex")).toBe(
			SIGNATURE.toString("hex"),
		);
		const file = buildGra({
			width: 2,
			height: 2,
			pixels: [0, 0, 0, 0, 0, 0, 0, 0],
		});
		expect(
			await kurumiGraLegacyImageFormat.detect(sourceOf(file), "a.gra"),
		).toBe(true);
		const other = encrypt(Buffer.alloc(HEADER_SIZE, 0x00));
		expect(
			await kurumiGraLegacyImageFormat.detect(sourceOf(other), "a.gra"),
		).toBe(false);
		expect(
			await kurumiGraLegacyImageFormat.detect(
				sourceOf(Buffer.alloc(8, 0)),
				"a.gra",
			),
		).toBe(false);
	});

	it("weaves the halves of a fifteen bit pixel out of two bytes", async () => {
		// 0xE0, 0x00 carries the top three bits of the pixel; 0x1F, 0x03 the lowest five.
		const file = buildGra({
			width: 2,
			height: 1,
			pixels: [0xe0, 0x00, 0x1f, 0x03],
		});
		const archive = await kurumiGraLegacyImageFormat.open(
			sourceOf(file),
			"CG01.GRA",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 1,
				bitsPerPixel: 16,
				offsetX: 0,
				offsetY: 0,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				encryption: "kurumi",
				width: 2,
				height: 1,
				bitsPerPixel: 16,
			});
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readInt32LE(22)).toBe(-1);
		expect(bmp.readUInt16LE(28)).toBe(16);
		expect(bmp.readUInt32LE(30)).toBe(3);
		expect(bmp.readUInt32LE(54)).toBe(0x7c00);
		expect(bmp.readUInt32LE(58)).toBe(0x03e0);
		expect(bmp.readUInt32LE(62)).toBe(0x001f);
		// The pixels follow the masks, as words of two bytes.
		expect(bmp.subarray(66, 70)).toEqual(Buffer.from([0xe0, 0x00, 0x00, 0x7f]));
	});

	it("carries where the picture belongs", async () => {
		const file = buildGra({
			width: 1,
			height: 1,
			offsetX: -3,
			offsetY: 5,
			pixels: [0x00, 0x00],
		});
		const archive = await kurumiGraLegacyImageFormat.open(
			sourceOf(file),
			"a.gra",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				offsetX: -3,
				offsetY: 5,
			});
		} finally {
			await archive.close();
		}
	});

	it("pads a row of an odd number of pixels", async () => {
		const file = buildGra({
			width: 3,
			height: 1,
			pixels: [0xe0, 0x00, 0xe0, 0x00, 0xe0, 0x00],
		});
		const bmp = await render(file);
		// Three pixels of two bytes are six bytes, and a row of a bitmap is a multiple of four.
		expect(bmp.subarray(66, 72)).toEqual(
			Buffer.from([0xe0, 0x00, 0xe0, 0x00, 0xe0, 0x00]),
		);
		expect(bmp[72]).toBe(0x00);
		expect(bmp[73]).toBe(0x00);
		expect(bmp.length).toBe(74);
	});

	it("holds the sequence to thirty-two bits over a long file", async () => {
		// The sequence multiplies itself five times per byte, so it has long since wrapped around by the end
		// of a picture of this size.
		const pixels: number[] = [];
		for (let i = 0; i < 32; i += 1) pixels.push((i * 13) & 0xff, i & 0xff);
		const file = buildGra({ width: 8, height: 4, pixels });
		const bmp = await render(file);
		const words: number[] = [];
		for (let i = 0; i < 4; i += 1) {
			words.push(bmp.readUInt16LE(66 + i * 2));
		}
		for (let i = 0; i < 4; i += 1) {
			const [p0, p1] = [pixels[i * 2] ?? 0, pixels[i * 2 + 1] ?? 0];
			// The bitmap names its pixels as little endian words, so the first byte of the pair the reader
			// writes is the low half of the word.
			const low = ((p1 >> 2) & 0x1f) | (p0 & 0xe0);
			const high = ((p0 & 0x1f) << 2) | (p1 & 3);
			expect(words[i]).toBe(low | (high << 8));
		}
	});

	it("stops when the stream ends in the middle of a pixel", async () => {
		const file = buildGra({ width: 2, height: 2, pixels: [1, 2, 3] });
		const archive = await kurumiGraLegacyImageFormat.open(
			sourceOf(file),
			"a.gra",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Truncated Kurumi image",
			});
		} finally {
			await archive.close();
		}
	});
});
