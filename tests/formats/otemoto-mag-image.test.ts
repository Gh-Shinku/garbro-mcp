import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	otemotoMagIndexBytes,
	otemotoMagImageFormat,
	readOtemotoMagLayout,
	readOtemotoMagPalette,
	unpackOtemotoMag,
} from "../../packages/formats/src/otemoto/mag-image.js";

const PICTURE = Buffer.from(
	"4d414b49303220201a0000000000000000070000005000000051000000f8ffffff520000" +
		"000000000000010204050608090a0c0d0e10111214151618191a1c1d1e20212224252628" +
		"292a2c2d2e30313234353638393a3c3d3ec0011032",
	"hex",
);
const PLACES = [0x3210, 0x3210];
const ROW = Buffer.from("10321032", "hex");

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await otemotoMagImageFormat.open(
		new BufferByteSource(data),
		"picture.mag",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Otemoto image format", () => {
	it("reads the head of a picture", () => {
		expect(readOtemotoMagLayout(PICTURE, PICTURE.length)).toEqual({
			width: 8,
			height: 1,
			bitsPerPixel: 4,
			stride: 4,
			paletteOffset: 0x29,
			bitsOffset: 0x59,
			data1Offset: 0x5a,
			data1Length: 1,
			data2Offset: 0x5b,
			// The reference names the places the walk reads by standing the place of the words of the head
			// beside the words of the head that name those places, so the place of the words stands as a place
			// of the walk of its own.
			data2Length: 9,
		});
	});

	it("turns away a head that stands as no picture", () => {
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.write("MAKI03  ", 0, "latin1");
		expect(readOtemotoMagLayout(wrongMark, wrongMark.length)).toBeUndefined();
		const noMark = Buffer.from(PICTURE);
		noMark.writeUInt8(0x00, 8);
		expect(readOtemotoMagLayout(noMark, noMark.length)).toBeUndefined();
		expect(readOtemotoMagLayout(Buffer.alloc(8), 8)).toBeUndefined();
		const cut = Buffer.alloc(0x40, 0x00);
		cut.write("MAKI02  ", 0, "latin1");
		cut.writeUInt8(0x1a, 8);
		expect(readOtemotoMagLayout(cut, 0x30)).toBeUndefined();
	});

	it("reads the palette of a picture", () => {
		const layout = readOtemotoMagLayout(PICTURE, PICTURE.length);
		if (!layout) throw new Error("the head stands in the picture");
		const palette = readOtemotoMagPalette(PICTURE, layout);
		expect(palette.length).toBe(16 * 3);
		expect([...palette.subarray(0, 6)]).toEqual([
			0x01, 0x00, 0x02, 0x05, 0x04, 0x06,
		]);
	});

	it("stands the places of the picture beside the places of the walk that name them", () => {
		const layout = readOtemotoMagLayout(PICTURE, PICTURE.length);
		if (!layout) throw new Error("the head stands in the picture");
		const places = unpackOtemotoMag(PICTURE, layout);
		expect([...places]).toEqual(PLACES);
		expect(otemotoMagIndexBytes(places, layout)).toEqual(ROW);
	});

	it("hands the places of the picture to a bitmap", async () => {
		const out = await extract(PICTURE);
		expect(out.readUInt32LE(0x12)).toBe(8);
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.readUInt16LE(0x1c)).toBe(4);
		expect(out.readUInt32LE(0x2e)).toBe(16);
		expect(out.subarray(0x76, 0x7a)).toEqual(ROW);
	});

	it("turns a walk that names a place outside the picture away", () => {
		// The first place of the picture names a place a place above itself rather than a place the walk reads
		// for itself, which stands outside the picture where the picture stands at its own first place.
		const data = Buffer.from(PICTURE);
		data.writeUInt8(0x10, 0x5a);
		const layout = readOtemotoMagLayout(data, data.length);
		if (!layout) throw new Error("the head stands in the picture");
		expect(() => unpackOtemotoMag(data, layout)).toThrow(GarbroError);
		expect(() => unpackOtemotoMag(data, layout)).toThrow(
			"Otemoto picture names a place that stands outside it",
		);
	});

	it("is told by the words of the picture", async () => {
		expect(otemotoMagImageFormat.descriptor.id).toBe("otemoto-mag-image");
		expect(otemotoMagImageFormat.descriptor.extensions).toEqual(["mag"]);
		expect(otemotoMagImageFormat.detection).toEqual({
			signatures: [{ bytes: Buffer.from("MAKI", "latin1") }],
		});
		await expect(
			otemotoMagImageFormat.detect(new BufferByteSource(PICTURE)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.write("MAKI03  ", 0, "latin1");
		await expect(
			otemotoMagImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
