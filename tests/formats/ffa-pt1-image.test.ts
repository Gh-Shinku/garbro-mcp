// The walk of the places of a picture of the FFA System engine. The two oldest kinds stand of an LZSS
// stream over a frame the walk fills itself and the two newer ones of a bit stream whose bits are read from
// the lowest place of a byte up: every fixture writes the stream the walk asks for, so the places of the
// picture are the values the fixture asks for rather than a recording of what the walk did.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ffaPt1ImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	populatePt1Frame,
	Pt1Bits,
	readPt1Layout,
	unpackPt1Picture,
} from "../../packages/formats/src/ffa/pt1-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** `Pt1Format.ReadMetaData`: the kind, the word behind it, the box and the two counts. */
function buildPt1(spec: {
	kind: number;
	stream: Buffer;
	alpha?: Buffer;
	width?: number;
	height?: number;
	unpackedSize?: number;
	marker?: number;
}): Buffer {
	const width = spec.width ?? 2;
	const height = spec.height ?? 2;
	const head = Buffer.alloc(0x20, 0);
	head.writeInt32LE(spec.kind, 0);
	head.writeInt32LE(spec.marker ?? -1, 4);
	head.writeInt32LE(0, 8);
	head.writeInt32LE(0, 12);
	head.writeUInt32LE(width, 16);
	head.writeUInt32LE(height, 20);
	head.writeInt32LE(spec.stream.length, 24);
	head.writeInt32LE(spec.unpackedSize ?? width * height * 3, 28);
	const parts = [head, spec.stream];
	if (spec.alpha) {
		const size = Buffer.alloc(4, 0);
		size.writeInt32LE(spec.alpha.length, 0);
		parts.push(size, spec.alpha);
	}
	return Buffer.concat(parts);
}

/** The stream of the two newer kinds of the picture of two by two pixels, of its first pixel in front. */
function predictorStream(): Buffer {
	// The first pixel, then the bits of the walk from the lowest place of the fourth byte up: a place
	// written like the one to its left, one like the place above it and a last one of the gradient of the
	// left, the up-left and the up places with a difference of minus one for its first colour.
	return Buffer.from([0x10, 0x20, 0x30, 0xe7, 0x00, 0x00, 0x00, 0x00]);
}
const PREDICTOR_PIXELS = [
	0x10, 0x20, 0x30, 0x10, 0x20, 0x30, 0x10, 0x20, 0x30, 0x0f, 0x20, 0x30,
];

/** The frame of the walk: thirteen of every place of a byte, and then the tail of the frame. */
const FRAME = populatePt1Frame();

/** A writer of the bits of the stream of the two newer kinds, from the lowest place of a byte up. */
function writeLsbBits(bits: readonly number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / 8), 0);
	bits.forEach((bit, index) => {
		if (0 !== bit)
			out[index >> 3] = (out[index >> 3] ?? 0) | (1 << (index & 7));
	});
	return out;
}

describe("FFA System PT1 picture", () => {
	it("reads the head of the picture", () => {
		const stream = Buffer.from([0x01, 0x41]);
		const plain = readPt1Layout(buildPt1({ kind: 0, stream }));
		expect(plain?.type).toBe(0);
		expect(plain?.width).toBe(2);
		expect(plain?.height).toBe(2);
		expect(plain?.packedSize).toBe(2);
		expect(plain?.unpackedSize).toBe(12);
		expect(plain?.bitsPerPixel).toBe(24);
		// The kind of three carries a place of its own for the alpha of the picture as well.
		const alpha = readPt1Layout(
			buildPt1({ kind: 3, stream, alpha: Buffer.from([0xff, 0xaa]) }),
		);
		expect(alpha?.bitsPerPixel).toBe(32);
		expect(alpha?.alphaPackedSize).toBe(2);
		expect(readPt1Layout(buildPt1({ kind: 2, stream }))?.bitsPerPixel).toBe(24);
	});

	it("fills the frame of the walk the way the reference does", () => {
		expect(FRAME.length).toBe(0x1000);
		// Thirteen places of every place of a byte, from zero up.
		expect([...FRAME.subarray(0, 5)]).toEqual([0, 0, 0, 0, 0]);
		expect([...FRAME.subarray(13, 18)]).toEqual([1, 1, 1, 1, 1]);
		// Then the places of a byte from zero up and then from the highest one down.
		expect([...FRAME.subarray(0xd00, 0xd04)]).toEqual([0, 1, 2, 3]);
		expect([...FRAME.subarray(0xe00, 0xe04)]).toEqual([0xff, 0xfe, 0xfd, 0xfc]);
		// A hundred and twenty eight places of nothing, a hundred and ten of a space and eighteen more
		// of nothing, which is where the ring of the walk starts.
		expect([...FRAME.subarray(0xf00, 0xf04)]).toEqual([0, 0, 0, 0]);
		expect([...FRAME.subarray(0xf80, 0xf84)]).toEqual([0x20, 0x20, 0x20, 0x20]);
		expect([...FRAME.subarray(0xfee, 0xff2)]).toEqual([0, 0, 0, 0]);
	});

	it("walks the places of the kind of one place a step", () => {
		// One place of its own, then a run of six places and a run of five: twelve places, which is the
		// count of the places of a picture of two by two places of three colours.
		const stream = Buffer.from([0x01, 0x41, 0x00, 0x03, 0x00, 0x02]);
		const file = buildPt1({ kind: 0, stream });
		const layout = readPt1Layout(file);
		if (!layout) throw new Error("no layout");
		const places = unpackPt1Picture(file, layout);
		// The run reaches the places of the frame, which stand at thirteen of every place of a byte and
		// are the places of nothing at its start.
		expect([...places]).toEqual([0x41, ...(new Array(11).fill(0) as number[])]);
	});

	it("walks the places of the kind of three places a step", () => {
		// The same walk, one place of its own and a run of three, three places of the picture for every
		// step of it.
		const stream = Buffer.from([0x01, 0x41, 0x00, 0x00]);
		const file = buildPt1({ kind: 1, stream });
		const layout = readPt1Layout(file);
		if (!layout) throw new Error("no layout");
		const places = unpackPt1Picture(file, layout);
		expect([...places]).toEqual([
			0x41,
			0x41,
			0x41,
			...(new Array(9).fill(0) as number[]),
		]);
	});

	it("reads the difference of a place of the newer kinds of the reservoir", () => {
		// The code of every difference of the walk, one at a time, behind the first pixel of the picture.
		const cases: readonly (readonly [readonly number[], number])[] = [
			[[1], 0],
			[[0, 0, 1], -1],
			[[0, 1, 0], 1],
			[[0, 1, 1, 1], -2],
			[[0, 1, 1, 0], 2],
			[[0, 0, 0, 1], -3],
			[[0, 0, 0, 0, 1, 1, 1], 3],
			[[0, 0, 0, 0, 1, 1, 0], -4],
			[[0, 0, 0, 0, 1, 0, 1], 4],
			[[0, 0, 0, 0, 1, 0, 0], -5],
			[[0, 0, 0, 0, 0, 1, 1], 5],
			[[0, 0, 0, 0, 0, 1, 0], -6],
			[[0, 0, 0, 0, 0, 0, 1], 6],
			[[0, 0, 0, 0, 0, 0, 0, 1, 1], -7],
			[[0, 0, 0, 0, 0, 0, 0, 1, 0], 7],
			[[0, 0, 0, 0, 0, 0, 0, 0, 1], -8],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1], 8],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0], -9],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 9],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1], -10],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0], 10],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], -11],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1], 11],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0], -12],
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 12],
			// A difference no code names is the escape of the walk, of the top count of places.
			[[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], -13],
		];
		for (const [bits, want] of cases) {
			const stream = Buffer.concat([
				Buffer.from([0x10, 0x20, 0x30]),
				writeLsbBits(bits),
			]);
			const reader = Pt1Bits.seeded(stream);
			reader.readNext();
			expect([bits.length, reader.difference()]).toEqual([bits.length, want]);
		}
	});

	it("walks the places of the kind of the predictor", () => {
		const file = buildPt1({ kind: 2, stream: predictorStream() });
		const layout = readPt1Layout(file);
		if (!layout) throw new Error("no layout");
		expect([...unpackPt1Picture(file, layout)]).toEqual(PREDICTOR_PIXELS);
	});

	it("walks the place of the alpha of the kind of three", () => {
		const file = buildPt1({
			kind: 3,
			stream: predictorStream(),
			alpha: Buffer.from([0xff, 0xaa, 0xbb, 0xcc, 0xdd]),
		});
		const layout = readPt1Layout(file);
		if (!layout) throw new Error("no layout");
		expect([...unpackPt1Picture(file, layout)]).toEqual([
			0x10, 0x20, 0x30, 0xaa, 0x10, 0x20, 0x30, 0xbb, 0x10, 0x20, 0x30, 0xcc,
			0x0f, 0x20, 0x30, 0xdd,
		]);
	});

	it("walks every branch of the places of the newer kinds", () => {
		// A picture of four by four pixels whose every place stands of a step of its own, so that the
		// branches of the walk the picture of two by two pixels above does not reach are checked as
		// well. The stream is written from the steps, lowest place of a byte first, and the pixel of
		// every place stands of the step of it and of the places it reads:
		//
		//   place 1  a difference of each colour from the place to its left, of one, nothing and minus
		//            one, so it is 02 02 02
		//   place 2  the place to its left again
		//   place 3  a pixel of its own, aa bb cc
		//   place 4  the first of row one: a difference of each colour from the place above, of
		//            nothing, two and nothing, so it is 01 04 03
		//   place 5  the gradient of the left, the up-left and the up places with a difference of
		//            three, so 01-01+02+3, 04-02+02, 03-03+02 is 05 04 02
		//   place 6  the same gradient without a difference, which is 05 04 02 as well
		//   place 7  the place to its left again, of the third step of two places
		//   place 8  the first of row two: a pixel of its own, 11 22 33
		//   place 9  a pixel of its own, of the second step of two places, 44 55 66
		//   place 10 a difference from the place to its left, of nothing, nothing and one, so 44 55 67
		//   place 11 the up-left pixel, of the first step of four places, which is place 7
		//   place 12 the first of row three: the place above, which is place 8
		//   place 13 the pixel above, of the second step of four places, which is place 9
		//   place 14 a difference from the up-left pixel, of one for every colour, so 45 56 67
		//   place 15 a difference from the pixel above, of two for every colour, so 07 06 04
		const stream = Buffer.from(
			"0102032aa3bacb6c1bbe4c84c80c125599d10208082409c4cc00",
			"hex",
		);
		const file = buildPt1({
			kind: 2,
			stream,
			width: 4,
			height: 4,
			unpackedSize: 48,
		});
		const layout = readPt1Layout(file);
		if (!layout) throw new Error("no layout");
		expect([...unpackPt1Picture(file, layout)]).toEqual([
			0x01, 0x02, 0x03, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0xaa, 0xbb, 0xcc,
			0x01, 0x04, 0x03, 0x05, 0x04, 0x02, 0x05, 0x04, 0x02, 0x05, 0x04, 0x02,
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x44, 0x55, 0x67, 0x05, 0x04, 0x02,
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x45, 0x56, 0x67, 0x07, 0x06, 0x04,
		]);
	});

	it("reads the picture through the format", async () => {
		const archive = buildPt1({
			kind: 0,
			stream: Buffer.from([0x01, 0x41, 0x00, 0x03, 0x00, 0x02]),
		});
		const handle = await ffaPt1ImageFormat.open(
			new BufferByteSource(archive),
			"sample.pt1",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(2);
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(bmp.readUInt16LE(28)).toBe(24);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect([...read.pixels]).toEqual([
			0x41,
			...(new Array(11).fill(0) as number[]),
		]);
	});

	it("reads a picture of the kind of the predictor through the format", async () => {
		const handle = await ffaPt1ImageFormat.open(
			new BufferByteSource(
				buildPt1({
					kind: 3,
					stream: predictorStream(),
					alpha: Buffer.from([0xff, 0xaa, 0xbb, 0xcc, 0xdd]),
				}),
			),
			"sample.pt1",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readUInt16LE(28)).toBe(32);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect([...read.pixels]).toEqual([
			0x10, 0x20, 0x30, 0xaa, 0x10, 0x20, 0x30, 0xbb, 0x10, 0x20, 0x30, 0xcc,
			0x0f, 0x20, 0x30, 0xdd,
		]);
	});

	it("turns away what is not one of its pictures", async () => {
		const stream = Buffer.from([0x01, 0x41]);
		const wrongKind = buildPt1({ kind: 0, stream });
		wrongKind.writeInt32LE(4, 0);
		expect(
			await ffaPt1ImageFormat.detect(new BufferByteSource(wrongKind)),
		).toBe(false);
		const wrongMarker = buildPt1({ kind: 0, stream, marker: 0 });
		expect(
			await ffaPt1ImageFormat.detect(new BufferByteSource(wrongMarker)),
		).toBe(false);
		const wrongSize = buildPt1({ kind: 0, stream, unpackedSize: 11 });
		expect(
			await ffaPt1ImageFormat.detect(new BufferByteSource(wrongSize)),
		).toBe(false);
		const cut = buildPt1({ kind: 0, stream });
		expect(
			await ffaPt1ImageFormat.detect(
				new BufferByteSource(cut.subarray(0, 0x20 + 1)),
			),
		).toBe(false);
		// A picture of the kind of three whose alpha stream is not there is broken as well.
		const noAlpha = buildPt1({ kind: 3, stream });
		expect(await ffaPt1ImageFormat.detect(new BufferByteSource(noAlpha))).toBe(
			false,
		);
		expect(
			await ffaPt1ImageFormat.detect(
				new BufferByteSource(buildPt1({ kind: 1, stream })),
			),
		).toBe(true);
		expect(
			await ffaPt1ImageFormat.detect(
				new BufferByteSource(buildPt1({ kind: 2, stream: predictorStream() })),
			),
		).toBe(true);
	});
});

void GarbroError;
