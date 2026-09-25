import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	miaImageFormat,
	readMiaLayout,
	readMiaPalette,
	unpackMiaPicture,
} from "../../packages/formats/src/miami/mia-image.js";

const HEAD_SIZE = 0x10;
const PALETTE_SIZE = 0x30;
const ORDER_SIZE = 6;

/** The bits of a picture, of which the lowest of a byte stands first. */
function bitsToBytes(bits: number[]): Buffer {
	const bytes: number[] = [];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let bit = 0; bit < 8; bit += 1) value |= (bits[at + bit] ?? 0) << bit;
		bytes.push(value);
	}
	return Buffer.from(bytes);
}

/** A picture of this engine: its head, its colour map, the order of its ways, then the bits of its places. */
function miaFile(
	width: number,
	height: number,
	bits: number[],
	options: { order?: number[]; palette?: number[] } = {},
): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("CoB42", 0xa, "latin1");
	head.writeUInt16LE(width, 6);
	head.writeUInt16LE(height, 8);
	const palette = Buffer.alloc(PALETTE_SIZE, 0x00);
	(options.palette ?? []).forEach((place, at) => {
		palette[at] = place;
	});
	const order = Buffer.alloc(ORDER_SIZE, 0x00);
	(options.order ?? []).forEach((place, at) => {
		order[at] = place;
	});
	return Buffer.concat([head, palette, order, bitsToBytes(bits)]);
}

describe("Miamisoft image", () => {
	it("reads the head of a picture and turns away the ones that stand no picture", () => {
		const layout = readMiaLayout(miaFile(8, 1, []));
		expect(layout?.width).toBe(8);
		expect(layout?.height).toBe(1);
		const wrong = Buffer.from(miaFile(8, 1, []));
		wrong.write("CoB43", 0xa, "latin1");
		expect(readMiaLayout(wrong)).toBeUndefined();
		expect(readMiaLayout(Buffer.alloc(0x10, 0x00))).toBeUndefined();
	});

	it("reads the colour map of a picture, green, red and blue to a colour", () => {
		const colours = Array.from({ length: 16 }, (_, at) => [at, 15 - at, at]);
		const palette = readMiaPalette(
			miaFile(8, 1, [], { palette: colours.flat() }),
			HEAD_SIZE,
		);
		// A bitmap keeps a colour map the other way round: the third place of a colour comes first.
		expect([...(palette.subarray(0, 4) as Buffer)]).toEqual([
			0,
			0,
			15 * 0x11,
			0,
		]);
		expect([...(palette.subarray(4, 8) as Buffer)]).toEqual([
			0x11,
			0x11,
			14 * 0x11,
			0,
		]);
	});

	it("tells a picture of its own by the shape of its head", async () => {
		const good = miaFile(8, 1, []);
		expect(await miaImageFormat.detect?.(new BufferByteSource(good))).toBe(
			true,
		);
		const bad = Buffer.from(good);
		bad[0xa] = 0x00;
		expect(await miaImageFormat.detect?.(new BufferByteSource(bad))).toBe(
			false,
		);
	});

	it("draws a picture of nothing when the places of the pattern stand of nothing", () => {
		// The first bit of a group stands of its own and the four places behind it name places of the pattern
		// the picture draws out of; a picture drawn out of places of nothing is a picture of nothing.
		const picture = unpackMiaPicture(miaFile(8, 1, [1, 1, 1, 1, 1]), {
			width: 8,
			height: 1,
		});
		expect([...picture.places]).toEqual([0, 0, 0, 0]);
	});

	it("draws the places of a picture out of the pattern of its own", async () => {
		// One place of the pattern is asked for by one bit standing clear in front of the next one that
		// stands, and the places of the other three of the group stand at the place the walk has reached.
		const data = miaFile(8, 1, [1, 0, 1, 1, 1, 1]);
		const picture = unpackMiaPicture(data, { width: 8, height: 1 });
		expect([...picture.places]).toEqual([0x11, 0x11, 0x00, 0x00]);
		const handle = await miaImageFormat.open(
			new BufferByteSource(data),
			"picture.mia",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		if (!image) throw new Error("no picture");
		// The places of a picture stand two of them to a byte, the first of them the higher.
		expect([...image.pixels]).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
	});
});
