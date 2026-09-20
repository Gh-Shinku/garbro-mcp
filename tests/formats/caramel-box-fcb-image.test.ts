import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	caramelBoxFcbImageFormat,
	readFcbLayout,
	unpackFcbPicture,
} from "../../packages/formats/src/caramel-box/fcb-image.js";

const HEAD_SIZE = 0x10;
/** The places of the picture of the differences of a place of the picture of the walk of the places of a
 * picture of the kinds of the words of the places of the picture of the count of them. */
const KEY_FACTOR = 0x1465d9;
const KEY_ADDEND = 0x0fb5;

/** The places of the walk of the picture of the test, of four places by two: the places of the picture of the
 * first row stand as the places of the picture of the first place of the row, and the places of the picture of
 * the second row stand of the places of the picture beside them, one of them standing from every place of the
 * picture of the differences of the places of the picture of the five places of the picture of the walk of
 * them. */
const PLACES = Buffer.from([0x4a, 0x4a, 0x4a, 0x4a, 0x5a, 0x6a, 0x7a, 0x4a]);

/** The places of the picture of the test: the places of the picture of the first row stand grey, and the
 * places of the picture of the second row stand from the places of the picture of the first place of the row. */
const EXPECT = Buffer.from([
	0x80, 0x80, 0x80, 0xff, 0x80, 0x80, 0x80, 0xff, 0x80, 0x80, 0x80, 0xff, 0x80,
	0x80, 0x80, 0xff, 0x81, 0x81, 0x81, 0xff, 0x83, 0x83, 0x83, 0xff, 0x86, 0x86,
	0x86, 0xff, 0x86, 0x86, 0x86, 0xff,
]);

function head(method: number, extra: Buffer): Buffer {
	const out = Buffer.alloc(HEAD_SIZE, 0x00);
	out.write("fcb1", 0, "latin1");
	out.writeUInt32LE(4, 4);
	out.writeUInt32LE(2, 8);
	out.writeInt32LE(method, 12);
	return Buffer.concat([out, extra]);
}

/** A picture of the kind of the places of a picture of the compression of the pictures of the engine: the
 * places of the walk of the picture of the test stand as the places of the picture of the block of the places
 * of the picture of their own, the places of the picture of the walk of them standing walked by a key. */
function tzPicture(): Buffer {
	const payload = Buffer.from(PLACES);
	const block = Buffer.from(payload);
	let key = 0;
	for (let at = 0; at + 2 <= block.length; at += 2) {
		key = (key * KEY_FACTOR + KEY_ADDEND) >>> 0;
		block.writeUInt16LE((block.readUInt16LE(at) + (key >>> 16)) & 0xffff, at);
	}
	const header = Buffer.alloc(6, 0x00);
	header.writeUInt32LE(payload.length, 2);
	const blockHeader = Buffer.alloc(8, 0x00);
	blockHeader.writeUInt16LE(0x7453, 0); // 'St': the places of the picture stand as they stand
	blockHeader.writeUInt16LE(block.length, 2);
	blockHeader.writeUInt16LE(payload.length, 4);
	blockHeader.writeUInt16LE(0, 6);
	return head(0, Buffer.concat([header, blockHeader, block]));
}

/** A picture of the kind of the places of a picture of the places of the picture of the engine. */
function zlibPicture(): Buffer {
	const sizes = Buffer.alloc(8, 0x00);
	sizes.writeInt32BE(PLACES.length, 0);
	sizes.writeInt32BE(deflateSync(PLACES).length, 4);
	// The words of the head of the picture that name the places of the walk of the places of the picture stand
	// four places behind the words of the head of the picture, and the places of the walk of them stand behind
	// the places of the picture of the two words of the places of the picture.
	return head(
		1,
		Buffer.concat([Buffer.alloc(4, 0x00), sizes, deflateSync(PLACES)]),
	);
}

describe("Caramel BOX image format", () => {
	it("reads the head of a picture of each of the two kinds of the walk of its places", () => {
		expect(readFcbLayout(zlibPicture(), zlibPicture().length)).toMatchObject({
			width: 4,
			height: 2,
			method: 1,
			dataOffset: HEAD_SIZE,
		});
		expect(readFcbLayout(tzPicture(), tzPicture().length)).toMatchObject({
			method: 0,
		});
	});

	it("turns away a head that names no picture of this kind", () => {
		const wrongMark = Buffer.from(zlibPicture());
		wrongMark.write("fcb2", 0, "latin1");
		expect(readFcbLayout(wrongMark, wrongMark.length)).toBeUndefined();
		const noPlaces = Buffer.from(zlibPicture());
		noPlaces.writeUInt32LE(0, 4);
		expect(readFcbLayout(noPlaces, noPlaces.length)).toBeUndefined();
		expect(readFcbLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("walks the places of a picture whose places of the walk stand beside them", () => {
		const layout = readFcbLayout(zlibPicture(), zlibPicture().length);
		if (!layout) throw new Error("no layout");
		expect(unpackFcbPicture(PLACES, layout)).toEqual(EXPECT);
	});

	it("stands the places of a picture out of the places of the walk of the kind of the compression of the pictures of the engine", async () => {
		// The places of the walk of the picture of the test stand as the places of the picture of the block of
		// the places of the picture of their own of the compression of the pictures of the engine.
		const file = tzPicture();
		const layout = readFcbLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const handle = await caramelBoxFcbImageFormat.open(
			new BufferByteSource(file),
			"picture.fcb",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(bmp.readInt32LE(0x12)).toBe(4);
		expect(bmp.readInt32LE(0x16)).toBe(-2);
		expect(bmp.subarray(0x36)).toEqual(EXPECT);
	});

	it("stands the places of a picture out of the places of the walk of the kind of the places of a picture of the engine", async () => {
		const file = zlibPicture();
		const handle = await caramelBoxFcbImageFormat.open(
			new BufferByteSource(file),
			"picture.fcb",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0x36)).toEqual(EXPECT);
	});

	it("turns a picture of a kind of the walk of its places it stands no places for away", async () => {
		const wrong = head(2, Buffer.alloc(4));
		const handle = await caramelBoxFcbImageFormat.open(
			new BufferByteSource(wrong),
			"picture.fcb",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(GarbroError);
	});

	it("turns a picture whose places of the walk stand short of the places of it away", () => {
		const layout = readFcbLayout(zlibPicture(), zlibPicture().length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackFcbPicture(Buffer.from([0x4a, 0x4a]), layout)).toThrow(
			GarbroError,
		);
	});

	it("is told by the words of the picture", async () => {
		expect(caramelBoxFcbImageFormat.descriptor.id).toBe(
			"caramel-box-fcb-image",
		);
		await expect(
			caramelBoxFcbImageFormat.detect(new BufferByteSource(zlibPicture())),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(zlibPicture());
		wrongMark.write("fcb2", 0, "latin1");
		await expect(
			caramelBoxFcbImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
