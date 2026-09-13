import { BufferByteSource } from "@garbro-mcp/core";
import { risaSygImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x20;

interface SygOptions {
	width?: number;
	height?: number;
	/** The alpha block's distance from the pixels, or zero for an image without transparency. */
	alphaOffset?: number;
	pixels?: number[];
	alpha?: number[];
	marker?: string;
	/** Drops the last bytes of the file, which cuts whichever block they belong to. */
	truncate?: number;
}

function buildSyg(options: SygOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 1;
	const pixelCount = width * height;
	const pixels =
		options.pixels ??
		Array.from({ length: pixelCount * 3 }, (_, index) => index + 1);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "$SYG", 0, "latin1");
	header.writeUInt32LE(width, 0x10);
	header.writeUInt32LE(height, 0x14);
	header.writeUInt32LE(options.alphaOffset ?? 0, 0x1c);
	const body: Buffer = Buffer.from(pixels);
	let alpha: Buffer = Buffer.alloc(0);
	if (options.alphaOffset !== undefined && options.alphaOffset !== 0) {
		const alphaBytes =
			options.alpha ?? Array.from({ length: pixelCount }, (_, i) => 0xf0 - i);
		// The alpha block sits at the offset the header names, measured from the pixels.
		const gap = options.alphaOffset - pixels.length;
		alpha = Buffer.concat([
			Buffer.alloc(Math.max(0, gap), 0x00),
			Buffer.from(alphaBytes),
		]);
	}
	const file = Buffer.concat([header, body, alpha]);
	return options.truncate
		? file.subarray(0, Math.max(0, file.length - options.truncate))
		: file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.syg"): Promise<Buffer> {
	const archive = await risaSygImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Risa game platform image", () => {
	it("needs its marker and a whole header, but not the pixels behind it", async () => {
		expect(await risaSygImageFormat.detect(sourceOf(buildSyg()), "A.syg")).toBe(
			true,
		);
		// The header alone is enough: this reader never looks at the length of what follows.
		expect(
			await risaSygImageFormat.detect(
				sourceOf(buildSyg({ truncate: 4 })),
				"A.syg",
			),
		).toBe(true);
		expect(
			await risaSygImageFormat.detect(
				sourceOf(buildSyg({ marker: "$SYH" })),
				"A.syg",
			),
		).toBe(false);
		expect(
			await risaSygImageFormat.detect(
				sourceOf(Buffer.from("$SYG", "latin1")),
				"A.syg",
			),
		).toBe(false);
	});

	it("reads a twenty four bit image top down", async () => {
		// Two rows of two pixels: the colours are stored with no padding between the rows at all.
		const pixels = Array.from({ length: 12 }, (_, index) => 0x10 + index);
		const output = await extract(buildSyg({ width: 2, height: 2, pixels }));
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readInt32LE(22)).toBe(-2);
		// A bitmap pads each row to four bytes, so the rows sit eight bytes apart here.
		expect(output.subarray(54, 60)).toEqual(Buffer.from(pixels.slice(0, 6)));
		expect(output.subarray(62, 68)).toEqual(Buffer.from(pixels.slice(6, 12)));
	});

	it("promises thirty two bits when the header points at transparency", async () => {
		const archive = await risaSygImageFormat.open(
			sourceOf(buildSyg({ width: 2, height: 1, alphaOffset: 6 })),
			"A.syg",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 32 });
		} finally {
			await archive.close();
		}
	});

	it("interleaves the alpha block the header points at", async () => {
		const pixels = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
		const alpha = [0xaa, 0xbb];
		const output = await extract(
			buildSyg({ width: 2, height: 1, alphaOffset: 6, pixels, alpha }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.subarray(54, 62)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0xaa, 0x44, 0x55, 0x66, 0xbb]),
		);
	});

	it("keeps the image at three bytes per pixel when the transparency is cut short", async () => {
		const pixels = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
		// The alpha block is one byte short of a whole image, so the reference never uses it.
		const file = buildSyg({
			width: 2,
			height: 1,
			alphaOffset: 6,
			pixels,
			alpha: [0xaa, 0xbb],
			truncate: 1,
		});
		const archive = await risaSygImageFormat.open(sourceOf(file), "A.syg");
		try {
			// The metadata still promises a fourth byte, which is what the header says.
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 32 });
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.subarray(54, 60)).toEqual(Buffer.from(pixels));
	});

	it("fills the colours it does not have with black", async () => {
		const output = await extract(
			buildSyg({ width: 2, height: 2, truncate: 4 }),
		);
		expect(output.readInt32LE(22)).toBe(-2);
		// Four of the twelve colour bytes are missing and the reference leaves them as they began.
		expect(output.subarray(54, 60)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
		);
		expect(output.subarray(62, 68)).toEqual(
			Buffer.from([0x07, 0x08, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("refuses an image with no pixels to place", async () => {
		expect(
			await risaSygImageFormat.detect(
				sourceOf(buildSyg({ width: 0 })),
				"A.syg",
			),
		).toBe(true);
		await expect(extract(buildSyg({ width: 0 }))).rejects.toThrow();
		await expect(extract(buildSyg({ height: 0 }))).rejects.toThrow();
	});

	it("names the entry after the bitmap and describes it", async () => {
		const archive = await risaSygImageFormat.open(
			sourceOf(buildSyg({ width: 7, height: 5 })),
			"sub/CG_13.syg",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_13.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 7,
				height: 5,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});
});
