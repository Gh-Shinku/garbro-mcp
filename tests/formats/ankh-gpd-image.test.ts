import { BufferByteSource } from "@garbro-mcp/core";
import { ankhGpdImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** `gpd` and a null: the reference compares a whole little endian word, so the fourth byte counts. */
const SIGNATURE = Buffer.from([0x67, 0x70, 0x64, 0x00]);
const LONG_HEADER = 16;
const BMP_HEADER_SIZE = 54;

const WIDTH = 4;
const HEIGHT = 2;
/** A four pixel row is twelve bytes, which is already aligned. */
const STRIDE = 12;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

function buildPixels(size = STRIDE * HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 43 + 9) & 0xff;
	return pixels;
}

/** A stream whose first control byte is also the layout flag when the short header is used. */
function buildGpd(
	options: {
		width?: number;
		height?: number;
		pixels?: Buffer;
		short?: boolean;
	} = {},
): Buffer {
	const width = options.width ?? WIDTH;
	const height = options.height ?? HEIGHT;
	const pixels = options.pixels ?? buildPixels(width * 3 * height);
	const stream = lzssLiterals(pixels);
	const header: Buffer = Buffer.alloc(LONG_HEADER, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	if (options.short) {
		// The flag word holds the first control byte of the stream, so the stream starts at offset twelve.
		const first = stream[0] ?? 0;
		if (first === 0) throw new Error("a literal control byte is never zero");
		header.writeUInt32LE(first, 12);
		// The flag word is the stream's first byte, which the rest of the stream follows.
		return Buffer.concat([
			header.subarray(0, 12),
			Buffer.from([first]),
			stream.subarray(1),
		]);
	}
	return Buffer.concat([header, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await ankhGpdImageFormat.open(sourceOf(stored), "CG01.GPD");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ankh gpd image", () => {
	it("declares the gpd signature", () => {
		expect(ankhGpdImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		// The reference compares a whole word, so the constant carries the null as well.
		expect(SIGNATURE.toString("latin1")).toBe("gpd\u0000");
	});

	it("writes a bottom up 24 bit bitmap past a zero flag", async () => {
		const pixels = buildPixels();
		const stored = buildGpd({ pixels });
		const source = sourceOf(stored);
		expect(await ankhGpdImageFormat.detect(source, "CG01.GPD")).toBe(true);
		const archive = await ankhGpdImageFormat.open(source, "CG01.GPD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 24,
				streamOffset: LONG_HEADER,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
		expect(output.readInt32LE(22)).toBe(HEIGHT);
		expect(output.length).toBe(BMP_HEADER_SIZE + STRIDE * HEIGHT);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("starts the stream inside the flag word when it is set", async () => {
		const pixels = buildPixels();
		const stored = buildGpd({ pixels, short: true });
		// The word at offset twelve holds the stream's first control byte, so the stream starts at twelve, the
		// four header bytes past it are gone and the file is four bytes shorter than the long layout.
		const plain = buildGpd({ pixels });
		expect(stored.length).toBe(plain.length - 4);
		expect(stored.readInt32LE(12)).not.toBe(0);
		const archive = await ankhGpdImageFormat.open(sourceOf(stored), "CG01.GPD");
		try {
			expect(archive.metadata).toMatchObject({ streamOffset: 12 });
		} finally {
			await archive.close();
		}
		// Both layouts describe the same image even though the bytes differ.
		expect(await extract(stored)).toEqual(await extract(plain));
	});

	it("zero fills a stream that ends early", async () => {
		const pixels = buildPixels();
		const stored = buildGpd({ pixels });
		// Keep only the header and a couple of control bytes.
		const truncated = stored.subarray(0, LONG_HEADER + 4);
		const output = await extract(truncated);
		expect(output.length).toBe(BMP_HEADER_SIZE + STRIDE * HEIGHT);
		// The decoded part matches the start of the image and the rest is zeros.
		expect(output[BMP_HEADER_SIZE]).toBe(pixels[0]);
		expect(output.subarray(output.length - 4)).toEqual(Buffer.alloc(4));
	});

	it("declines zero dimensions, a short header and a wrong signature", async () => {
		expect(
			await ankhGpdImageFormat.detect(
				sourceOf(buildGpd({ width: 0, pixels: Buffer.alloc(0) })),
				"CG01.GPD",
			),
		).toBe(false);
		expect(
			await ankhGpdImageFormat.detect(
				sourceOf(buildGpd().subarray(0, 15)),
				"CG01.GPD",
			),
		).toBe(false);
		const wrong = buildGpd();
		wrong[2] = 0x65;
		expect(await ankhGpdImageFormat.detect(sourceOf(wrong), "CG01.GPD")).toBe(
			false,
		);
		// The fourth byte is part of the word the reference compares, so it has to be a null as well.
		const trailing = buildGpd();
		trailing[3] = 0x58;
		expect(
			await ankhGpdImageFormat.detect(sourceOf(trailing), "CG01.GPD"),
		).toBe(false);
	});

	it("carries the dimensions into the listing", async () => {
		const stored = buildGpd({
			width: 2,
			height: 3,
			pixels: buildPixels(2 * 3 * 3),
		});
		const archive = await ankhGpdImageFormat.open(sourceOf(stored), "CG01.GPD");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 2,
				height: 3,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
