// The walk of the places of the file of a picture of this port and of an apart walk of the same
// reference stand of the same places of the file of the picture of the engine itself.
import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	readGImageLayout,
	unpackGPalette,
	unpackGPicture,
} from "../../packages/formats/src/hyperworks/g-image.js";

/** The places of the file of the table of the colours of a picture of the engine. */
const PALETTE = Buffer.from([
	0x11, 0x22, 0x33, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** The places of the file of a picture of the engine: the head, the table of the colours, the walk. */
function picture(stream: number[], width = 8, height = 2): Buffer {
	const data = Buffer.alloc(0x40 + stream.length, 0);
	data.writeUInt16LE(0x7d00, 0);
	data.writeUInt16LE(0x1a47, 2);
	data.writeInt16LE(3, 4);
	data.writeInt16LE(4, 6);
	data.writeUInt16LE(width, 8);
	data.writeUInt16LE(height, 10);
	PALETTE.copy(data, 0x0c);
	Buffer.from(stream).copy(data, 0x40);
	return data;
}

describe("HyperWorks engine indexed image", () => {
	it("reads the head of a picture of the engine", () => {
		const data = picture([0xc0]);
		const layout = readGImageLayout(data, "cg.g");
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(8);
		expect(layout?.height).toBe(2);
		expect(layout?.offsetX).toBe(3);
		expect(layout?.offsetY).toBe(4);
		expect(layout?.stride).toBe(8);
		expect(layout?.rows).toBe(2);
		expect(layout?.packed).toBe(8);
	});

	it("reads the head of a picture of the engine of the letters of the name of the file of it", () => {
		// The reference takes a picture of the first word 0x7D00 of the head of it alone, or of the
		// letters `.G` of the name of the file of the picture of the engine of the other walks of it.
		const data = picture([0xc0]);
		data.writeUInt16LE(0x1234, 0);
		expect(readGImageLayout(data, "cg.g")).toBeDefined();
		expect(readGImageLayout(data, "cg.G")).toBeDefined();
		expect(readGImageLayout(data, "cg.bin")).toBeUndefined();
	});

	it("stands of a walk of a picture of the engine of no places of the file of it", () => {
		expect(readGImageLayout(Buffer.alloc(8), "cg.g")).toBeUndefined();
		const data = picture([0xc0]);
		data.writeUInt16LE(0x1a46, 2);
		expect(readGImageLayout(data, "cg.g")).toBeUndefined();
		data.writeUInt16LE(0x1a47, 2);
		data.writeUInt16LE(0, 8);
		expect(readGImageLayout(data, "cg.g")).toBeUndefined();
	});

	it("reads the table of the colours of a picture of the engine", () => {
		const palette = unpackGPalette(PALETTE);
		expect([...palette.subarray(10 * 4, 11 * 4)]).toEqual([
			0x33, 0x22, 0x11, 0,
		]);
		expect([...palette.subarray(26 * 4, 27 * 4)]).toEqual([
			0x19, 0x11, 0x08, 0,
		]);
		expect([...palette.subarray(0, 10 * 4)]).toEqual(new Array(40).fill(0));
	});

	it("walks the places of a picture of the engine, of a colour of the table of it and of the runs", () => {
		// The walk of the places of the file of the picture of the engine of a colour of the table of the
		// colours of the places of it, of the runs of the places of the file behind the walk of a colour
		// of it: the places of the file of the walk of this port and of an apart walk of the same
		// reference stand of the same places of the file of the picture of the engine itself.
		// The places of the file of the walk of the engine of the two first places of the reservoir.
		const data = picture([0xc0, 0x00]);
		const layout = readGImageLayout(data, "cg.g");
		if (!layout) throw new Error("no picture");
		const bmp = unpackGPicture(data, layout);
		expect([...bmp.subarray(0x436, 0x436 + 16)]).toEqual([
			0x0d, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a,
			0x0a, 0x0a, 0x0a, 0x0a,
		]);
		expect([...bmp.subarray(0x36 + 10 * 4, 0x36 + 11 * 4)]).toEqual([
			0x33, 0x22, 0x11, 0,
		]);
	});

	it("walks the places of a picture of the engine of the walk of the places of the file of it", () => {
		const data = picture([
			0xc4, 0x28, 0xad, 0x03, 0xa7, 0xb6, 0xc6, 0x38, 0x13, 0x5b, 0x10, 0x84,
			0xc2, 0xc6, 0x00, 0x1f, 0x84, 0x55, 0xb9, 0x80, 0x96, 0x00, 0xd2, 0x8d,
			0xef, 0x71, 0x84, 0x1e, 0x94, 0x98, 0x98, 0x90,
		]);
		const layout = readGImageLayout(data, "cg.g");
		if (!layout) throw new Error("no picture");
		const bmp = unpackGPicture(data, layout);
		expect([...bmp.subarray(0x436, 0x436 + 16)]).toEqual([
			0x0f, 0x0a, 0x0a, 0x0e, 0x0f, 0x0a, 0x0a, 0x0e, 0x0a, 0x0a, 0x0f, 0x0e,
			0x0a, 0x0a, 0x0f, 0x0e,
		]);
		expect([...bmp.subarray(0x36, 0x36 + 42 * 4)]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x33, 0x22, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x19, 0x11, 0x08, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		]);
	});

	it("stands of a walk of a picture of the engine of a run before the walk of it", () => {
		// The reference reads the places of the file of the walk of a colour of the table of the engine of
		// the places of the file of the picture before the walk of it: the walk of this port stands of a
		// picture of the engine of no places of the file of the picture of the engine itself.
		const data = picture([
			0x28, 0xdb, 0x0f, 0x79, 0xdd, 0xec, 0xc9, 0x25, 0xf6, 0x65, 0xb5, 0xcc,
			0x76, 0x20, 0x52, 0xd4,
		]);
		const layout = readGImageLayout(data, "cg.g");
		if (!layout) throw new Error("no picture");
		expect(() => unpackGPicture(data, layout)).toThrow(/before the walk/);
	});
});
