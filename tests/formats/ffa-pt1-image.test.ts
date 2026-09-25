// The walk of the places of an FFA System PT1 picture of the first two kinds, against streams written by
// hand: a flag byte and, behind it, a place of its own and runs whose place and count stand in the frame
// the walk fills itself. Every place the walk has to turn out is known from the stream, so the places of
// the picture are the ones the fixture asks for rather than a recording of what the walk did.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ffaPt1ImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	populatePt1Frame,
	readPt1Layout,
	unpackPt1Picture,
} from "../../packages/formats/src/ffa/pt1-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** `Pt1Format.ReadMetaData`: the kind, the word behind it, the box and the two counts. */
function buildPt1(spec: {
	kind: number;
	stream: Buffer;
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
	return Buffer.concat([head, spec.stream]);
}

/** The frame of the walk: thirteen of every place of a byte, and then the tail of the frame. */
const FRAME = populatePt1Frame();

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
		expect(readPt1Layout(buildPt1({ kind: 3, stream }))?.bitsPerPixel).toBe(32);
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

	it("refuses the kinds of two and three", async () => {
		for (const kind of [2, 3]) {
			const handle = await ffaPt1ImageFormat.open(
				new BufferByteSource(
					buildPt1({ kind, stream: Buffer.from([0x01, 0x41]) }),
				),
				"sample.pt1",
			);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle.openEntry(entry.id)).rejects.toThrow(GarbroError);
		}
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
		expect(
			await ffaPt1ImageFormat.detect(
				new BufferByteSource(buildPt1({ kind: 1, stream })),
			),
		).toBe(true);
	});
});
