// The walk of the places of an elf GPH picture, against a fixture written the way the format reads it:
// the two trees of the engine are written out bit by bit, then the tokens that walk them. The places the
// picture asks for are known from the tokens, so the packed places and the picture behind them are the
// values the walk has to turn out rather than a recording of what it did.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { elfGphImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	gphPalette,
	readGphLayout,
	unpackGphPicture,
} from "../../packages/formats/src/elf/gph-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** A bit writer of the stream the reader of the reference takes: most significant bit first. */
class BitWriter {
	readonly bits: number[] = [];

	bit(value: number): void {
		this.bits.push(value & 1);
	}

	code(value: number, width: number): void {
		for (let i = width - 1; i >= 0; i -= 1) this.bits.push((value >> i) & 1);
	}

	/** A leaf of a tree: a clear bit and then the value of it, nine places wide for a token. */
	leaf(value: number, width: number): void {
		this.bit(0);
		this.code(value, width);
	}

	bytes(): Buffer {
		const out = Buffer.alloc(Math.ceil(this.bits.length / 8), 0);
		for (const [index, bit] of this.bits.entries()) {
			if (0 === bit) continue;
			const at = index >> 3;
			out[at] = (out[at] ?? 0) | (0x80 >> (index & 7));
		}
		return out;
	}
}

/** The two trees of the fixture, then the tokens of a picture of thirty two by four places. */
function gphFixtureStream(): Buffer {
	const writer = new BitWriter();
	// A token tree: '00' the place 'A', '01' the place 'B', '10' a run of three, '11' a run of four.
	writer.bit(1);
	writer.bit(1);
	writer.leaf(0x41, 9);
	writer.leaf(0x42, 9);
	writer.bit(1);
	writer.leaf(0x100, 9);
	writer.leaf(0x101, 9);
	// An offset tree: '0' one place back, '1' two places back.
	writer.bit(1);
	writer.leaf(0, 8);
	writer.leaf(1, 8);
	// The places: two of their own, then a run of four two places back and two of the like one place
	// back, then eighteen runs of three. Every run of them reaches into the places already written.
	writer.code(0, 2);
	writer.code(1, 2);
	writer.code(3, 2);
	writer.code(1, 1);
	writer.code(3, 2);
	writer.code(0, 1);
	for (let i = 0; i < 18; i += 1) {
		writer.code(2, 2);
		writer.code(0, 1);
	}
	return writer.bytes();
}

const STREAM = Buffer.from([
	196, 17, 10, 128, 32, 48, 0, 4, 126, 146, 73, 36, 146, 73, 36, 144,
]);

/** The places of the fixture as the walk writes them: `A B A B A B` and then the place `B`. */
const PLACES = (() => {
	const places = Buffer.alloc(64, 0x42);
	for (const [at, value] of [0x41, 0x42, 0x41, 0x42, 0x41, 0x42].entries()) {
		places[at] = value;
	}
	return places;
})();

/** The same places packed four bits to a byte, in the order the walk of the reference packs them. */
const PACKED = (() => {
	const packed = Buffer.alloc(PLACES.length, 0);
	for (const [at, value] of PLACES.entries()) {
		let place = (value & 0x80) | ((value & 0x20) << 1);
		place |= ((value & 0x08) << 2) | ((value & 0x02) << 3);
		place |= (value & 0x01) | ((value & 0x04) >> 1);
		place |= ((value & 0x10) >> 2) | ((value & 0x40) >> 3);
		packed[at] = place & 0xff;
	}
	return packed;
})();

/**
 * `GphFormat.ReadMetaData`: the mark, the count of the frames and the places of the first of them, and
 * then the count of the places of the frame, its flags (the fourth of them saying it carries no palette
 * of its own), the palette if it carries one, the box of the picture and the stream of its places.
 */
function buildGph(spec: {
	stream: Buffer;
	ownPalette?: boolean;
	count?: number;
	box?: readonly [number, number, number, number];
	frameOffset?: number;
}): Buffer {
	const frameOffset = spec.frameOffset ?? 0x10;
	const head = Buffer.alloc(frameOffset, 0);
	head.write("GPH", 0, "latin1");
	head[3] = 0x1d;
	head.writeUInt16LE(spec.count ?? 1, 4);
	head.writeInt32LE(frameOffset, 6);
	const box = spec.box ?? [0, 0, 15, 3];
	const palette = Buffer.alloc((spec.ownPalette ?? true) ? 0 : 0x20, 0);
	if (palette.length > 0) {
		for (let i = 0; i < 16; i += 1) {
			palette[i * 2] = i;
			palette[i * 2 + 1] = i;
		}
	}
	const frame = Buffer.alloc(6 + palette.length + 8, 0);
	frame.writeInt32LE(0, 0);
	frame.writeUInt16LE((spec.ownPalette ?? true) ? 4 : 0, 4);
	palette.copy(frame, 6);
	frame.writeInt16LE(box[0], 6 + palette.length);
	frame.writeInt16LE(box[1], 8 + palette.length);
	frame.writeInt16LE(box[2], 10 + palette.length);
	frame.writeInt16LE(box[3], 12 + palette.length);
	return Buffer.concat([head, frame, spec.stream]);
}

describe("elf GPH picture", () => {
	it("writes the stream of the fixture the reader of the reference takes", () => {
		expect(gphFixtureStream()).toEqual(STREAM);
	});

	it("reads the head of the picture", () => {
		const layout = readGphLayout(buildGph({ stream: STREAM }));
		expect(layout?.frameCount).toBe(1);
		expect(layout?.flags).toBe(4);
		expect(layout?.width).toBe(32);
		expect(layout?.height).toBe(4);
		expect(layout?.offsetX).toBe(0);
		expect(layout?.offsetY).toBe(0);
	});

	it("reads a picture whose frame carries a palette of its own", () => {
		const file = buildGph({ stream: STREAM, ownPalette: false });
		const layout = readGphLayout(file);
		if (!layout) throw new Error("no layout");
		expect(layout.flags).toBe(0);
		expect(layout.width).toBe(32);
		const palette = gphPalette(file, layout);
		// `GphReader.ReadPalette`: red and blue out of the first byte of a colour and green out of the
		// second, each of six places lifted into eight by `Clamp`.
		expect(palette.subarray(0, 3)).toEqual(Buffer.from([0x00, 0x00, 0x00]));
		// The last colour of the fixture holds 0x0f in both of its bytes. The reference takes its red
		// out of `(rgb >> 2) & 0x3C`, which for so small a colour stands at nothing, and its green and
		// blue out of `(rgb << 2) & 0x3C`, which for those bytes stand at sixty.
		expect(palette.subarray(15 * 3, 16 * 3)).toEqual(
			Buffer.from([0x00, 0xff, 0xff]),
		);
	});

	it("hands over the sixteen colours of the engine when a frame carries none", () => {
		const file = buildGph({ stream: STREAM });
		const layout = readGphLayout(file);
		if (!layout) throw new Error("no layout");
		const palette = gphPalette(file, layout);
		expect(palette.length).toBe(48);
		expect(palette.subarray(0, 9)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0xaa, 0x00, 0xaa, 0x00]),
		);
		expect(palette.subarray(45, 48)).toEqual(Buffer.from([0xff, 0xff, 0xff]));
	});

	it("walks the two trees and the places of the frame", () => {
		const file = buildGph({ stream: STREAM });
		const layout = readGphLayout(file);
		if (!layout) throw new Error("no layout");
		const places = unpackGphPicture(file, layout);
		expect(places.length).toBe(64);
		// The places the tokens ask for: two of their own, a run of four two places back and the runs
		// of three behind them.
		expect(places).toEqual(PACKED);
		expect([...places.subarray(0, 6)]).toEqual([
			0x09, 0x18, 0x09, 0x18, 0x09, 0x18,
		]);
		expect(new Set([...places.subarray(6)]).size).toBe(1);
		expect(places[63]).toBe(0x18);
	});

	it("reads the picture through the format", async () => {
		const handle = await elfGphImageFormat.open(
			new BufferByteSource(buildGph({ stream: STREAM })),
			"sample.gph",
		);
		expect(handle.entries.length).toBe(1);
		expect(handle.entries[0]?.path).toBe("image.bmp");
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.toString("latin1", 0, 2)).toBe("BM");
		expect(bmp.readUInt32LE(18)).toBe(32);
		expect(bmp.readInt32LE(22)).toBe(-4);
		expect(bmp.readUInt16LE(28)).toBe(4);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect(read.width).toBe(32);
		expect(read.height).toBe(4);
		expect(read.pixels).toEqual(PACKED);
	});

	it("turns away what is not one of its pictures", async () => {
		const other = buildGph({ stream: STREAM });
		other[0] = 0x48;
		expect(await elfGphImageFormat.detect(new BufferByteSource(other))).toBe(
			false,
		);
		const none = buildGph({ stream: STREAM, count: 0 });
		expect(await elfGphImageFormat.detect(new BufferByteSource(none))).toBe(
			false,
		);
		const far = buildGph({ stream: STREAM });
		far.writeInt32LE(0x1000, 6);
		expect(await elfGphImageFormat.detect(new BufferByteSource(far))).toBe(
			false,
		);
		const flat = buildGph({ stream: STREAM, box: [0, 1, 15, 0] });
		expect(await elfGphImageFormat.detect(new BufferByteSource(flat))).toBe(
			false,
		);
		expect(
			await elfGphImageFormat.detect(
				new BufferByteSource(buildGph({ stream: STREAM })),
			),
		).toBe(true);
	});
});
