// The walk of the places of the file of a picture of this port and of an apart walk of the same
// reference stand of the same places of the file of the picture of the engine itself.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	i24ImageFormat,
	readI24Layout,
	rotateShiftTable,
	unpackI24Picture,
} from "../../packages/formats/src/hyperworks/i24-image.js";
import { SHIFT_TABLE } from "../../packages/formats/src/hyperworks/i24-tables.js";

/**
 * The picture of the engine of the walk of the places of the file of it: the head, the places of the
 * file of the three tables of the walk of the engine (the colours of it of the tokens 91 and 216, the
 * places of the file of a row of the token 1 and the third table of the token 0) and the tokens of the
 * places of the file of the three places of the picture of the engine (of a colour of the table of the
 * engine first, of the places of the file of the run of two places of the picture behind it).
 */
const PICTURE = Buffer.from(
	"4932344100000000000000000300010018000000000000006805ba03e645d1c800000000",
	"hex",
);

/** The places of the file of the walk of the engine, of the two kinds of the walk of the picture of it. */
const ROTATED = [1, 1, -1, 0, 0, 1, -1, 1];
const SWAPPED = [-1, 0, 1, 1, 0, 1, -1, 1];

/** The places of the file of the picture of the engine: the colours of the places of the picture. */
const PIXELS = [
	0x02, 0x00, 0x01, 0x00, 0x02, 0x00, 0x01, 0x00, 0x02, 0x00, 0x01, 0x00,
];

describe("HyperWorks RGB image", () => {
	it("reads the head of a picture of the engine", () => {
		const layout = readI24Layout(PICTURE);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(3);
		expect(layout?.height).toBe(1);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.version).toBe(0x41);
	});

	it("reads the head of a picture of the engine of the two marks of it", () => {
		const other = Buffer.from(PICTURE);
		other[3] = 0x20;
		expect(readI24Layout(other)?.version).toBe(0x20);
		const bad = Buffer.from(PICTURE);
		bad[3] = 0x42;
		expect(readI24Layout(bad)).toBeUndefined();
	});

	it("stands of a walk of a picture of the engine of no places of the file of it", () => {
		expect(readI24Layout(PICTURE.subarray(0, 0x17))).toBeUndefined();
		const bad = Buffer.from(PICTURE);
		bad.writeInt16LE(32, 0x10);
		expect(readI24Layout(bad)).toBeUndefined();
		const other = Buffer.from(PICTURE);
		other.writeUInt16LE(0, 0x0c);
		expect(readI24Layout(other)).toBeUndefined();
		const mark = Buffer.from(PICTURE);
		mark[0] = 0x48;
		expect(readI24Layout(mark)).toBeUndefined();
	});

	it("walks the places of the file of a picture of the engine", () => {
		const layout = readI24Layout(PICTURE);
		if (!layout) throw new Error("no picture");
		const bmp = unpackI24Picture(PICTURE, layout);
		const at = bmp.readUInt32LE(0x0a);
		expect([...bmp.subarray(at, at + 12)]).toEqual(PIXELS);
	});

	it("walks the places of the file of the table of the walk of a row of the picture of the engine", () => {
		// The places of the file of the picture of the engine of the letters `A` of the kind of the
		// picture of it stand of the places of the file of the token of the walk of the engine at the
		// front of the table of it; of the kind of the places of the file of the picture of the engine
		// itself the places of the file of the token stand of the places of the file of the walk of the
		// engine above it.
		const wound = [...SHIFT_TABLE];
		rotateShiftTable(wound, 2, 0x41);
		expect(wound.slice(0, 8)).toEqual(ROTATED);
		const swapped = [...SHIFT_TABLE];
		rotateShiftTable(swapped, 2, 0x20);
		expect(swapped.slice(0, 8)).toEqual(SWAPPED);
		const plain = [...SHIFT_TABLE];
		rotateShiftTable(plain, 0, 0x41);
		expect(plain).toEqual([...SHIFT_TABLE]);
	});

	it("reads the places of the file of a picture of the engine of the file of it", async () => {
		const source = new BufferByteSource(PICTURE);
		expect(await i24ImageFormat.detect(source, "cg.a")).toBe(true);
		expect(
			await i24ImageFormat.detect(
				new BufferByteSource(PICTURE.subarray(0, 8)),
				"cg.a",
			),
		).toBe(false);
		const handle = await i24ImageFormat.open(source, "cg.a");
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const content = await consumeBuffer(await handle.openEntry(entry.id));
		expect(content.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(content.readInt32LE(0x12)).toBe(3);
		expect(Math.abs(content.readInt32LE(0x16))).toBe(1);
		const at = content.readUInt32LE(0x0a);
		expect([...content.subarray(at, at + 12)]).toEqual(PIXELS);
		expect(handle.metadata?.width).toBe(3);
		expect(handle.metadata?.bitsPerPixel).toBe(24);
	});
});
