import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { crc32 } from "@garbro-mcp/codecs";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { blackCycDwqImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readDwqLayout } from "../../packages/formats/src/black-cyc/dwq-image.js";
import {
	readBmpImage,
	writeBmp24,
	writeBmp32,
} from "../../packages/formats/src/shared/bmp.js";
import { PNG_SIGNATURE } from "../../packages/formats/src/shared/png.js";

const HEAD_SIZE = 0x40;
const BMP_HEAD_SIZE = 0x36;

/** The text header of a picture of the engine. */
function head(input: {
	packType: number;
	aType?: boolean;
	baseType?: string;
	width?: number;
	height?: number;
	packedSize?: number;
	ifVariant?: boolean;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEAD_SIZE, 0x00);
	if (input.ifVariant) {
		header.write("IF PACKTYPE==", 0, "latin1");
		header.write("0 ", 0x0d, "latin1");
		header.write("BMP ", 0x2c, "latin1");
	} else {
		header.write((input.baseType ?? "BMP").padEnd(0x10, " "), 0, "latin1");
	}
	if (undefined !== input.packedSize)
		header.writeInt32LE(input.packedSize, 0x20);
	header.writeUInt32LE(input.width ?? 0, 0x24);
	header.writeUInt32LE(input.height ?? 0, 0x28);
	const text = `PACKTYPE=${input.packType}${input.aType ? "A" : ""}`;
	header.write(text + " ".repeat(16 - text.length), 0x30, "latin1");
	return header;
}

function dwqFile(header: Buffer, body: Buffer, mask?: Buffer): Buffer {
	return Buffer.concat([header, body, mask ?? Buffer.alloc(0)]);
}

/** The head of a bitmap of eight places to a place, of the colour map behind it. */
function bmp8Head(width: number, height: number, colors: number): Buffer {
	const head: Buffer = Buffer.alloc(BMP_HEAD_SIZE, 0x00);
	head.writeUInt32LE(BMP_HEAD_SIZE + colors * 4, 0x0a);
	head.writeUInt32LE(0x28, 0x0e);
	head.writeInt32LE(width, 0x12);
	head.writeInt32LE(height, 0x16);
	head.writeUInt16LE(1, 0x1a);
	head.writeUInt16LE(8, 0x1c);
	head.writeInt32LE(colors, 0x2e);
	return head;
}

/** Every colour of a picture of eight places to a place, stood of the places of the file. */
function bmp8Palette(colors: number[][]): Buffer {
	const palette: Buffer = Buffer.alloc(colors.length * 4, 0x00);
	colors.forEach((color, at) => {
		palette[at * 4] = color[0] ?? 0;
		palette[at * 4 + 1] = color[1] ?? 0;
		palette[at * 4 + 2] = color[2] ?? 0;
	});
	return palette;
}

/** A bitmap of the engine: the colours of every place of it stand the other way round. */
function swappedBmp(bmp: Buffer, bitsPerPixel: number): Buffer {
	const body = Buffer.from(bmp);
	const size = bitsPerPixel / 8;
	if (size < 3) return body;
	const width = body.readInt32LE(0x12);
	const height = Math.abs(body.readInt32LE(0x16));
	const stride = (width * size + 3) & ~3;
	for (let row = 0; row < height; row += 1) {
		for (let at = row * stride; at + 2 < (row + 1) * stride; at += size) {
			const swap = body[BMP_HEAD_SIZE + at] ?? 0;
			body[BMP_HEAD_SIZE + at] = body[BMP_HEAD_SIZE + at + 2] ?? 0;
			body[BMP_HEAD_SIZE + at + 2] = swap;
		}
	}
	return body;
}

function chunk(kind: string, body: Buffer): Buffer {
	const length: Buffer = Buffer.alloc(4, 0x00);
	length.writeUInt32BE(body.length, 0);
	const named = Buffer.concat([Buffer.from(kind, "latin1"), body]);
	const crc: Buffer = Buffer.alloc(4, 0x00);
	crc.writeUInt32BE(crc32(named), 0);
	return Buffer.concat([length, named, crc]);
}

/** A picture of three places to a place, of the places of it as they stand. */
function png24(width: number, height: number, places: number[][]): Buffer {
	const head: Buffer = Buffer.alloc(13, 0x00);
	head.writeUInt32BE(width, 0);
	head.writeUInt32BE(height, 4);
	head[8] = 8;
	head[9] = 2;
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line: Buffer = Buffer.alloc(1 + width * 3, 0x00);
		for (let column = 0; column < width; column += 1) {
			const place = places[row * width + column] ?? [];
			const at = 1 + column * 3;
			line[at] = place[0] ?? 0;
			line[at + 1] = place[1] ?? 0;
			line[at + 2] = place[2] ?? 0;
		}
		rows.push(line);
	}
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", head),
		chunk("IDAT", deflateSync(Buffer.concat(rows))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

async function pictureOf(data: Buffer) {
	const handle = await blackCycDwqImageFormat.open(
		new BufferByteSource(data),
		"cg.dwq",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("Black Cyc image", () => {
	it("reads the text header of a picture and the head behind it", () => {
		const body = Buffer.alloc(8, 0x00);
		const plain = readDwqLayout(
			dwqFile(head({ packType: 8, width: 4, height: 2 }), body),
		);
		expect(plain).toEqual({
			packType: 8,
			hasAlpha: false,
			width: 4,
			height: 2,
			bitsPerPixel: 32,
			baseType: "BMP",
			packedSize: 8,
		});
		// A picture of a mask stands of the counts of the header of it, and tells the alpha of it of the
		// head of the picture alone where the kind of it names no mask of its own.
		const masked = readDwqLayout(
			dwqFile(head({ packType: 2, packedSize: 6, width: 4, height: 2 }), body),
		);
		expect(masked?.hasAlpha).toBe(false);
		expect(masked?.packedSize).toBe(6);
		expect(
			readDwqLayout(
				dwqFile(
					head({
						packType: 2,
						aType: true,
						packedSize: 6,
						width: 4,
						height: 2,
					}),
					body,
				),
			)?.hasAlpha,
		).toBe(true);
		expect(
			readDwqLayout(dwqFile(head({ packType: 7, width: 4, height: 2 }), body))
				?.hasAlpha,
		).toBe(true);
		// A kind of picture this project knows none of, a header standing of no text of its own and a
		// picture standing short of its own header.
		expect(
			readDwqLayout(dwqFile(head({ packType: 4, width: 4, height: 2 }), body)),
		).toBeUndefined();
		expect(
			readDwqLayout(dwqFile(Buffer.alloc(HEAD_SIZE, 0x20), body)),
		).toBeUndefined();
		expect(readDwqLayout(Buffer.alloc(0x30, 0x00))).toBeUndefined();
	});

	it("reads the head of a picture of the text header of the file itself", () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const bmp = writeBmp24(2, 2, pixels, true);
		const layout = readDwqLayout(
			dwqFile(head({ packType: 0, ifVariant: true }), bmp),
		);
		expect(layout?.packType).toBe(0);
		expect(layout?.baseType).toBe("BMP");
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.packedSize).toBe(bmp.length);
	});

	it("reads a picture of a bitmap of the file itself, of the colours the other way round", async () => {
		const pixels = Buffer.from([
			10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
		]);
		const bmp = writeBmp24(2, 2, pixels, true);
		const image = await pictureOf(
			dwqFile(head({ packType: 0, width: 2, height: 2 }), swappedBmp(bmp, 24)),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([...pixels]);
	});

	it("reads a picture of the runs of the file and of the row above", async () => {
		const colors = bmp8Palette([
			[1, 1, 1],
			[2, 2, 2],
		]);
		const body = Buffer.concat([
			bmp8Head(4, 2, 2),
			colors,
			// The first row stands of two places and a run of two of nought, the second of a place and
			// a run of three, and every place of it stands of the place above.
			Buffer.from([1, 2, 0, 2, 3, 0, 3]),
		]);
		// The head of a picture of the header of the file itself stands of a bitmap of its own.
		body.write("BM", 0, "latin1");
		body.writeUInt32LE(body.length, 2);
		const image = await pictureOf(
			dwqFile(head({ packType: 1, ifVariant: true }), body),
		);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([1, 2, 0, 0, 2, 2, 0, 0]);
	});

	it("reads the alpha of a picture of the mask behind it", async () => {
		const base = writeBmp32(
			2,
			1,
			Buffer.from([10, 20, 30, 255, 40, 50, 60, 255]),
			true,
		);
		const mask = Buffer.concat([
			bmp8Head(2, 1, 2),
			bmp8Palette([
				[0, 0, 0],
				[0x30, 0x60, 0x90],
			]),
			Buffer.from([1, 1]),
		]);
		const image = await pictureOf(
			dwqFile(
				head({
					packType: 2,
					aType: true,
					width: 2,
					height: 1,
					packedSize: base.length,
				}),
				swappedBmp(base, 32),
				mask,
			),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([10, 20, 30, 0x60, 40, 50, 60, 0x60]);
	});

	it("reads a picture of a picture of its own kind", async () => {
		const image = await pictureOf(
			dwqFile(
				head({ packType: 8, baseType: "PNG", width: 2, height: 1 }),
				png24(2, 1, [
					[1, 2, 3],
					[4, 5, 6],
				]),
			),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([3, 2, 1, 0xff, 6, 5, 4, 0xff]);
	});

	it("hands a picture of a kind this project reads none of over as it stands", async () => {
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
		const data = dwqFile(
			head({ packType: 5, baseType: "JPEG", width: 2, height: 1 }),
			jpeg,
		);
		const handle = await blackCycDwqImageFormat.open(
			new BufferByteSource(data),
			"cg.dwq",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("image.jpg");
		const bytes = await consumeBuffer(await handle.openEntry(entry.id));
		expect([...bytes]).toEqual([...jpeg]);
		await expect(
			blackCycDwqImageFormat
				.open(
					new BufferByteSource(
						dwqFile(
							head({ packType: 7, width: 2, height: 1, packedSize: 4 }),
							jpeg,
						),
					),
					"cg.dwq",
				)
				.then((opened) => opened.openEntry(opened.entries[0]?.id ?? "")),
		).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
	});

	it("tells a picture of the engine by the header of it", async () => {
		const data = dwqFile(
			head({ packType: 0, width: 2, height: 2 }),
			writeBmp24(2, 2, Buffer.alloc(12, 0x11), true),
		);
		expect(
			await blackCycDwqImageFormat.detect?.(new BufferByteSource(data)),
		).toBe(true);
		expect(
			await blackCycDwqImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x20)),
			),
		).toBe(false);
		await expect(
			blackCycDwqImageFormat.open(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x20)),
				"cg.dwq",
			),
		).rejects.toThrow(GarbroError);
	});
});
