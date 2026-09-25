// The walk of the places of the file of a picture of this port and of an apart walk of the same
// reference stand of the same places of the file of the picture of the engine itself.
import { Buffer } from "node:buffer";
import { GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gcmpImageFormat,
	readGcmpLayout,
	unpackGcmp24bpp,
	unpackGcmp8bpp,
} from "../../packages/formats/src/nekotaro/gcmp-image.js";

/** The pictures of the walk of the places of the file of the engine, of the places of the file of them. */
const ONE = Buffer.from(
	"47436d700000000002000300180000000211223302445566e1",
	"hex",
);
const TWO = Buffer.from(
	"47436d700000000002000300180000000103778899aabbccddeeff03123456",
	"hex",
);
const THREE = Buffer.from(
	"47436d70000000000400020008000000012a012b21022c",
	"hex",
);
const FOUR = Buffer.from(
	"47436d700000000004001000080000000d02500e000063",
	"hex",
);
const FIVE = Buffer.from("47436d700000000004001000080000000f0000000022", "hex");
const SIX = Buffer.from("47436d700000000004000400080000000c0200000040", "hex");
const SEVEN = Buffer.from(
	"47436d700000000004000400f800000000050a0f14191e23282d32373c41464b",
	"hex",
);
const EIGHT = Buffer.from("47436d700000000008000200010000000101", "hex");

/** The places of the file of the walk of the engine of the pictures of the test. */
const ONE_PLACES = "112233112233445566445566112233112233";
const TWO_PLACES = "778899aabbccddeeff123456123456123456";
const THREE_PLACES = "2a2a2b2b2a2a2c2c";
const FOUR_PLACES =
	"04040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404050505050505050505050505050505";
const FIVE_PLACES =
	"01010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101";
const SIX_PLACES = "40404040404040404040404040404040";
const SEVEN_PLACES = "00050a0f14191e23282d32373c41464b";
const EIGHT_PLACES = "0101";

/** The walk of the places of the file of a picture, of the places of the file of the BMP of it. */
function placesOf(data: Buffer): number[] {
	const layout = readGcmpLayout(data);
	if (!layout) throw new Error("no picture of the engine");
	const stride =
		layout.bitsPerPixel > 1
			? (layout.width * layout.bitsPerPixel) / 8
			: (layout.width + 7) >> 3;
	if (24 === layout.bitsPerPixel) return [...unpackGcmp24bpp(data, layout)];
	return [...unpackGcmp8bpp(data, layout, stride)];
}

describe("Nekotaro Game System image", () => {
	it("reads the head of a picture of the engine", () => {
		const layout = readGcmpLayout(ONE);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(3);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.compressed).toBe(true);
		expect(readGcmpLayout(SEVEN)?.compressed).toBe(false);
		expect(readGcmpLayout(EIGHT)?.bitsPerPixel).toBe(1);
	});

	it("stands of a walk of a picture of the engine of no places of the file of it", () => {
		expect(readGcmpLayout(ONE.subarray(0, 0x0f))).toBeUndefined();
		const mark = Buffer.from(ONE);
		mark[0] = 0x48;
		expect(readGcmpLayout(mark)).toBeUndefined();
		const bpp = Buffer.from(ONE);
		bpp[12] = 32;
		expect(readGcmpLayout(bpp)).toBeUndefined();
		const flat = Buffer.from(ONE);
		flat.writeUInt16LE(0, 8);
		expect(readGcmpLayout(flat)).toBeUndefined();
	});

	it("walks the places of the file of a picture of the twenty four places of a colour of the engine", () => {
		// The places of the file of a colour of the walk of the engine and of the frame of the walk of it:
		// the places of the file of the picture of the engine of the second place of the file of the colour
		// of it stand of the frame of it.
		expect(placesOf(ONE)).toEqual([...Buffer.from(ONE_PLACES, "hex")]);
	});

	it("walks the places of the file of a picture of the engine of the places of the file of the chunk of it", () => {
		// The walk of the places of the file of the engine of a place of the file of the picture of the
		// engine of the walk of the places of the file of the chunk of it (of the places of the file of the
		// count of the two of them behind the place of the walk) and of the places of the file of the three
		// of them behind the walk of the engine.
		expect(placesOf(TWO)).toEqual([...Buffer.from(TWO_PLACES, "hex")]);
	});

	it("walks the places of the file of a picture of the eight places of a colour of the engine", () => {
		expect(placesOf(THREE)).toEqual([...Buffer.from(THREE_PLACES, "hex")]);
	});

	it("walks the places of the file of a picture of the engine of the count of the two of them", () => {
		// The walk of the places of the file of the engine of the places of the file of the count of the
		// frame of it of the two of them (of the places of the file of the count of the walk of the engine
		// itself) and of the places of the file of the frame of the walk of it.
		expect(placesOf(FOUR)).toEqual([...Buffer.from(FOUR_PLACES, "hex")]);
	});

	it("walks the places of the file of a picture of the engine of the count of the three of them", () => {
		expect(placesOf(FIVE)).toEqual([...Buffer.from(FIVE_PLACES, "hex")]);
		expect(placesOf(SIX)).toEqual([...Buffer.from(SIX_PLACES, "hex")]);
	});

	it("walks the places of the file of a picture of the engine of no places of the file of the walk of it", () => {
		expect(placesOf(SEVEN)).toEqual([...Buffer.from(SEVEN_PLACES, "hex")]);
	});

	it("walks the places of the file of a picture of the one place of a colour of the engine", () => {
		expect(placesOf(EIGHT)).toEqual([...Buffer.from(EIGHT_PLACES, "hex")]);
	});

	it("reads the places of the file of a picture of the engine of the walk of the BMP of it", async () => {
		const handle = await gcmpImageFormat.open(
			new (await import("@garbro-mcp/core")).BufferByteSource(ONE),
			"cg.gcmp",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await (await import("node:stream/consumers")).buffer(
			await handle.openEntry(entry.id),
		);
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readInt32LE(0x12)).toBe(2);
		expect(Math.abs(bmp.readInt32LE(0x16))).toBe(3);
		const at = bmp.readUInt32LE(0x0a);
		// `ImageData.CreateFlipped`: the places of the file of the first row of the walk of the engine stand
		// of the places of the file of the picture of the engine behind it. The places of the file of a row
		// of the BMP of it stand of the four places of the file of the picture of the engine itself.
		const places = Buffer.from(ONE_PLACES, "hex");
		for (let row = 0; row < 3; row += 1) {
			expect([...bmp.subarray(at + row * 8, at + row * 8 + 6)]).toEqual([
				...places.subarray(row * 6, row * 6 + 6),
			]);
		}
		await expect(
			gcmpImageFormat.open(
				new (await import("@garbro-mcp/core")).BufferByteSource(
					Buffer.alloc(0x20),
				),
				"cg.gcmp",
			),
		).rejects.toThrow(GarbroError);
	});
});
