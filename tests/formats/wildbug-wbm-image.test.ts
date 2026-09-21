import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	decodeWbmPicture,
	mergeWbmAlpha,
	readWbmLayout,
	wildbugWbmImageFormat,
} from "../../packages/formats/src/wildbug/wbm-image.js";

const HEADER = 0x10;
const RECORD = 16;
const STORED = 0x80;

interface Section {
	id: number;
	body: Buffer;
	/** How the section says it is stored; the top bit is the one way this port reads. */
	format?: number;
	packedSize?: number;
}

/** A file of this engine: the word, the kind, the directory, and the sections' bytes behind it. */
function wpxFile(
	marker: string,
	sections: Section[],
	options: { count?: number; recordSize?: number } = {},
): Buffer {
	const recordSize = options.recordSize ?? RECORD;
	const count = options.count ?? sections.length;
	const directorySize = count * recordSize;
	const head = Buffer.alloc(HEADER, 0x00);
	head.write("WPX\u001a", 0, "latin1");
	head.write(marker, 4, "latin1");
	head[0x0c] = 1;
	head[0x0e] = count;
	head[0x0f] = recordSize;
	let offset = HEADER + directorySize;
	const directory = Buffer.alloc(directorySize, 0x00);
	const bodies: Buffer[] = [];
	sections.forEach((section, index) => {
		const at = index * recordSize;
		directory[at] = section.id;
		directory[at + 1] = section.format ?? STORED;
		directory.writeInt32LE(offset, at + 4);
		directory.writeInt32LE(section.body.length, at + 8);
		directory.writeInt32LE(section.packedSize ?? 0, at + 12);
		bodies.push(section.body);
		offset += section.body.length;
	});
	return Buffer.concat([head, directory, ...bodies]);
}

/** The picture's own head: the size, and the depth it is stored in. */
function pictureHead(
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	head[0x0c] = bitsPerPixel;
	return head;
}

function pixels24(): Buffer {
	return Buffer.from([
		1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0,
		0, 0,
	]);
}

function pictureFile(sections: Section[]): Buffer {
	return wpxFile("BMP", sections);
}

function base24(extra: Section[] = []): Buffer {
	return pictureFile([
		{ id: 0x10, body: pictureHead(3, 2, 24) },
		{ id: 0x11, body: pixels24() },
		...extra,
	]);
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await wildbugWbmImageFormat.open(
		new BufferByteSource(file),
		"picture.wbm",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

describe("Wild Bug WBM image", () => {
	it("reads a stored picture of twenty four bits", async () => {
		const file = base24();
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(2);
		expect(layout.bitsPerPixel).toBe(24);
		// The rows are padded to four bytes, so nine bytes of pixels take twelve.
		expect(layout.stride).toBe(12);
		const picture = decodeWbmPicture(file, layout);
		expect(picture.bottomUp).toBe(false);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.width).toBe(3);
		expect(bitmap.height).toBe(2);
		expect(bitmap.bitsPerPixel).toBe(24);
		expect(bitmap.pixels).toEqual(
			Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
			]),
		);
	});

	it("spreads the alpha channel it finds over the picture", () => {
		const pixels = Buffer.from([
			1, 2, 3, 0xa0, 4, 5, 6, 0xa1, 7, 8, 9, 0xa2, 10, 11, 12, 0xa3,
		]);
		// The alpha channel is one byte a pixel over the rows the picture takes, padded like them.
		const alpha = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(2, 2, 32) },
			{ id: 0x11, body: pixels },
			{ id: 0x13, body: alpha },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.pixelSize).toBe(4);
		expect(layout.alphaStride).toBe(4);
		const picture = decodeWbmPicture(file, layout);
		// The byte the picture keeps behind its colours is dropped: the alpha channel is the one that counts.
		// The alpha channel is read a row at a time, and its rows are four bytes wide: the second row of
		// this picture therefore begins at the fifth byte of the section.
		expect(mergeWbmAlpha(picture, layout)).toEqual(
			Buffer.from([
				1, 2, 3, 0x11, 4, 5, 6, 0x22, 7, 8, 9, 0x55, 10, 11, 12, 0x66,
			]),
		);
	});

	it("leaves a picture of thirty two bits alone when no alpha channel is there", () => {
		const pixels = Buffer.from([
			1, 2, 3, 0xa0, 4, 5, 6, 0xa1, 7, 8, 9, 0xa2, 10, 11, 12, 0xa3,
		]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(2, 2, 32) },
			{ id: 0x11, body: pixels },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		const picture = decodeWbmPicture(file, layout);
		expect(picture.alpha).toBeUndefined();
		expect(mergeWbmAlpha(picture, layout)).toEqual(pixels);
	});

	it("reads the colours of a picture of eight bits", async () => {
		const palette = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const pixels = Buffer.from([0, 1, 2, 3, 0, 0, 0, 0]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(4, 2, 8) },
			{ id: 0x11, body: pixels },
			{ id: 0x12, body: palette },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.pixelSize).toBe(1);
		expect(layout.stride).toBe(4);
		const picture = decodeWbmPicture(file, layout);
		// A bitmap keeps its colours blue first, the picture keeps them red first.
		expect(picture.palette?.subarray(0, 12)).toEqual(
			Buffer.from([3, 2, 1, 0, 6, 5, 4, 0, 9, 8, 7, 0]),
		);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(8);
		expect(bitmap.palette.subarray(1 * 4, 1 * 4 + 3)).toEqual(
			Buffer.from([6, 5, 4]),
		);
		expect(bitmap.pixels).toEqual(pixels);
	});

	it("reads a picture of eight bits without colours as one shade of grey each", async () => {
		const pixels = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(4, 2, 8) },
			{ id: 0x11, body: pixels },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.palette).toBeUndefined();
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(8);
		expect(bitmap.pixels).toEqual(pixels);
		// The colours climb from nothing to white, which is what the writer here gives a grey picture.
		expect(bitmap.palette.subarray(0, 4)).toEqual(Buffer.from([0, 0, 0, 0]));
	});

	it("reads a stored picture of sixteen bits with the colours a five bit kind takes", async () => {
		const pixels = Buffer.from([
			0x1f, 0x00, 0xe0, 0x03, 0x00, 0x7c, 0xff, 0x7f,
		]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(2, 2, 16) },
			{ id: 0x11, body: pixels },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.pixelSize).toBe(2);
		expect(layout.stride).toBe(4);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(16);
		expect(bitmap.masks).toEqual({
			red: 0x7c00,
			green: 0x03e0,
			blue: 0x001f,
		});
	});

	it("refuses a packed section and reads one that says it holds nothing packed", async () => {
		const packed = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: pixels24(), format: 0x01, packedSize: 8 },
		]);
		const layout = readWbmLayout(packed);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		// The refusal names the walk the section's own byte asks for.
		expect(() => decodeWbmPicture(packed, layout)).toThrow(GarbroError);
		expect(() => decodeWbmPicture(packed, layout)).toThrow(/0x01 walk/);
		// A section that declares no packed bytes at all is read as it stands, as the reference does.
		const plain = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: pixels24(), format: 0x01, packedSize: 0 },
		]);
		const plainLayout = readWbmLayout(plain);
		if (!plainLayout) throw new Error("the fixture is not a WBM picture");
		expect(decodeWbmPicture(plain, plainLayout).pixels).toEqual(pixels24());
		expect(readBmpImage(await bitmapOf(plain))?.pixels).toEqual(
			Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
			]),
		);
	});

	it("refuses a picture it cannot read", () => {
		const base = base24();
		expect(readWbmLayout(base)).toBeDefined();
		// The word of a sound of this engine, which the sound's own reader takes.
		const sound = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: pixels24() },
		]);
		sound.write("WAV", 4, "latin1");
		expect(readWbmLayout(sound)).toBeUndefined();
		// A picture with no head of its own, and one whose head is too short to name a size.
		expect(
			readWbmLayout(pictureFile([{ id: 0x11, body: pixels24() }])),
		).toBeUndefined();
		expect(
			readWbmLayout(
				pictureFile([
					{ id: 0x10, body: Buffer.alloc(8, 0x00) },
					{ id: 0x11, body: pixels24() },
				]),
			),
		).toBeUndefined();
		// A depth this engine never writes.
		expect(
			readWbmLayout(
				pictureFile([
					{ id: 0x10, body: pictureHead(3, 2, 12) },
					{ id: 0x11, body: pixels24() },
				]),
			),
		).toBeUndefined();
		// A picture with no pixels.
		expect(
			readWbmLayout(pictureFile([{ id: 0x10, body: pictureHead(3, 2, 24) }])),
		).toBeUndefined();
		// A picture whose pixels reach past the end of the file.
		const past = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: Buffer.alloc(4, 0x00) },
		]);
		const layout = readWbmLayout(past);
		if (!layout) throw new Error("the fixture still names its size");
		expect(() => decodeWbmPicture(past, layout)).toThrow();
	});
});
