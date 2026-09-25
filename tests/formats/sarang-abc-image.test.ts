import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { abcImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readAbcLayout,
	unpackAbc,
	unpackAbcPicture,
} from "../../packages/formats/src/sarang/abc-image.js";
import {
	readBmpImage,
	writeBmp24,
	writeBmp32,
} from "../../packages/formats/src/shared/bmp.js";
import {
	readDdsLayout,
	readDdsPicture,
} from "../../packages/formats/src/directdraw/dds-image.js";

const RGB = 0x40;
const ALPHA_PIXELS = 0x01;

/** The bits of a walk of the engine, of the lowest bit of every place of the file first. */
class BitWriter {
	readonly bits: number[] = [];

	/** A place of the picture standing of the places of the file itself. */
	place(value: number): void {
		this.bits.push(0);
		for (let at = 7; at >= 0; at -= 1) this.bits.push((value >> at) & 1);
	}

	/** A place of the picture standing of a place of the walks of the engine. */
	token(value: number, tokenBits = 1): void {
		this.bits.push(1);
		for (let at = tokenBits - 1; at >= 0; at -= 1) {
			this.bits.push(((value - 0x100) >> at) & 1);
		}
	}

	bytes(): Buffer {
		const places: number[] = [];
		for (let at = 0; at < this.bits.length; at += 8) {
			let value = 0;
			for (let bit = 0; bit < 8; bit += 1) {
				value = (value << 1) | (this.bits[at + bit] ?? 0);
			}
			places.push(value);
		}
		return Buffer.from(places);
	}
}

/** The walks of the engine of a picture: every place of it stands of the places of the file itself. */
function walkOf(picture: Buffer): Buffer {
	const writer = new BitWriter();
	for (const place of picture) writer.place(place);
	return writer.bytes();
}

/**
 * A picture of the engine: the count of the places behind its walks and then the walks of them. The walks
 * of a picture of this engine begin with the word its head stands of, of the places of the picture itself.
 */
function abcFile(
	picture: Buffer,
	head?: Buffer,
	unpackedSize?: number,
): Buffer {
	const size: Buffer = Buffer.alloc(4, 0x00);
	size.writeInt32LE(unpackedSize ?? picture.length, 0);
	return Buffer.concat([size, head ?? walkOf(picture)]);
}

/** A texture: a head of a hundred and twenty four places and then the places of it. */
function ddsFile(width: number, height: number, body: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(4 + 0x7c, 0x00);
	head.write("DDS ", 0, "latin1");
	head.writeInt32LE(0x7c, 4);
	head.writeUInt32LE(height, 0xc);
	head.writeUInt32LE(width, 0x10);
	head.writeUInt32LE(RGB | ALPHA_PIXELS, 0x50);
	head.writeInt32LE(32, 0x58);
	head.writeUInt32LE(0xff0000, 0x5c);
	head.writeUInt32LE(0x00ff00, 0x60);
	head.writeUInt32LE(0x0000ff, 0x64);
	head.writeUInt32LE(0xff000000, 0x68);
	return Buffer.concat([head, body]);
}

async function pictureOf(data: Buffer) {
	const handle = await abcImageFormat.open(
		new BufferByteSource(data),
		"cg.abc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("Sarang compressed bitmap", () => {
	it("reads the head of a picture of the engine and turns away the ones that stand of no picture", () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const bmp = writeBmp24(2, 2, pixels, true);
		const data = abcFile(bmp);
		// The walks of a picture of the engine begin with the word its head stands of: for a bitmap, the
		// places of the walks of it stand of that word itself.
		expect(data.readUInt32LE(4) & 0xffff).toBe(0x1321);
		const layout = readAbcLayout(data);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.unpackedSize).toBe(bmp.length);
		expect(layout?.kind).toBe("bmp");
		// A picture standing of too few places, of too many places, of no word its head knows and one
		// standing short of its own head.
		expect(readAbcLayout(abcFile(bmp, undefined, 0x37))).toBeUndefined();
		expect(readAbcLayout(abcFile(bmp, undefined, 0x4000001))).toBeUndefined();
		expect(
			readAbcLayout(abcFile(bmp, Buffer.alloc(0x40, 0x00))),
		).toBeUndefined();
		expect(readAbcLayout(data.subarray(0, 7))).toBeUndefined();
		// A picture whose walks stand of no picture the reader of the reference knows.
		const stray = Buffer.alloc(0x40, 0x00);
		stray.write("ZZ", 0, "latin1");
		expect(readAbcLayout(abcFile(stray))).toBeUndefined();
	});

	it("hands the picture behind the walks over, of the places of it", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const bmp = writeBmp24(2, 2, pixels, true);
		const image = await pictureOf(abcFile(bmp));
		expect(image.width).toBe(2);
		expect(image.height).toBe(2);
		expect(image.bitsPerPixel).toBe(24);
		// The places of the bitmap stand from the bottom of the picture up, and the port hands the picture
		// of the reference over as the reader of it read it.
		expect([...image.pixels]).toEqual([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]);
	});

	it("stands the places of the walks of the engine of the places of the walks before them", () => {
		// Two places of the picture as they stand, and then a place of the walks standing of them: the
		// places of the walks of a picture stand of the place before them and of a place of it.
		const writer = new BitWriter();
		writer.place(0x41);
		writer.place(0x42);
		writer.token(0x100);
		const stream = abcFile(Buffer.alloc(0), writer.bytes(), 4);
		expect([...unpackAbc(stream, 4)]).toEqual([0x41, 0x42, 0x41, 0x42]);
	});

	it("hands the texture behind the walks over, of the places of it", () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const texture = ddsFile(2, 1, pixels);
		const layout = readDdsLayout(texture);
		if (!layout) throw new Error("the texture stands of no head of its own");
		const expected = readBmpImage(
			writeBmp32(layout.width, layout.height, readDdsPicture(texture, layout)),
		);
		if (!expected) throw new Error("the texture stands of no picture");
		const picture = unpackAbcPicture(abcFile(texture), {
			unpackedSize: texture.length,
			width: layout.width,
			height: layout.height,
			bitsPerPixel: layout.bitsPerPixel,
			kind: "dds",
		});
		const image = readBmpImage(picture);
		if (!image) throw new Error("the port handed over no picture");
		expect(image.width).toBe(2);
		expect(image.height).toBe(1);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([...expected.pixels]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const bmp = writeBmp24(1, 1, Buffer.from([9, 8, 7]), true);
		const data = abcFile(bmp);
		expect(await abcImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		const wrong = abcFile(bmp, Buffer.alloc(0x40, 0x00));
		expect(await abcImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
		await expect(
			abcImageFormat.open(new BufferByteSource(wrong), "cg.abc"),
		).rejects.toThrow(GarbroError);
	});
});
