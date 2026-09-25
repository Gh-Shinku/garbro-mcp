// The walk of the places of a BOM GRP picture. The streams are written off the reference on their own - a
// reading of `GrpReader` of `Legacy/Bom/ImageGRP.cs` with a writer of the bits the walk reads (from the
// highest place of a byte down), of the code of a place in the adaptive tree of the walk and of the update
// of that tree behind every place - and the places the walk turns out are read off the steps of the stream
// by hand, which the comments below write down.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { bomGrpImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readBomGrpLayout,
	unpackBomGrpPicture,
} from "../../packages/formats/src/bom/grp-image.js";

/** `GrpFormat.ReadMetaData`: a head of 0x24 places, of the kind and the box of the picture in it. */
function buildGrp(spec: {
	kind: number;
	width: number;
	height: number;
	stride: number;
	places: Buffer;
	stored?: boolean;
	offset?: number;
	mark?: boolean;
}): Buffer {
	const head = Buffer.alloc(0x24, 0);
	head[0] = 0x52;
	head[1] = 0x47;
	head[2] = 0x01;
	head[3] = 0x00;
	head[4] = spec.kind;
	head[6] = spec.mark === false ? 0 : 0x80;
	head.writeUInt16LE(spec.width, 8);
	head.writeUInt16LE(spec.height, 10);
	head.writeInt32LE(spec.stride, 0x18);
	head.writeUInt16LE(spec.offset ?? 0x24, 0x22);
	const size = Buffer.alloc(4, 0);
	size.writeUInt32LE(
		spec.stored === true ? 0x80000000 + spec.places.length : spec.places.length,
		0,
	);
	return Buffer.concat([head, size, spec.places]);
}

function placesOf(...values: readonly (number | number[])[]): number[] {
	const out: number[] = [];
	for (const value of values) {
		if (Array.isArray(value)) out.push(...value);
		else out.push(value);
	}
	return out;
}

describe("BOM GRP picture", () => {
	it("reads the head of the picture", () => {
		const head = buildGrp({
			kind: 3,
			width: 0x40,
			height: 0x20,
			stride: 0x80,
			places: Buffer.alloc(0),
		});
		const layout = readBomGrpLayout(head);
		expect(layout?.kind).toBe(3);
		expect(layout?.width).toBe(0x40);
		expect(layout?.height).toBe(0x20);
		expect(layout?.bitsPerPixel).toBe(16);
		expect(layout?.stride).toBe(0x80);
		expect(layout?.dataOffset).toBe(0x24);
		// The kind stands of the places of a colour of the picture, of thirty two down to four.
		for (const [kind, bits] of [
			[1, 32],
			[2, 24],
			[3, 16],
			[4, 8],
			[5, 4],
		] as const) {
			const data = buildGrp({
				kind,
				width: 4,
				height: 1,
				stride: 12,
				places: Buffer.alloc(0),
			});
			expect(readBomGrpLayout(data)?.bitsPerPixel).toBe(bits);
		}
	});

	it("turns away what is not one of its pictures", () => {
		const good = buildGrp({
			kind: 2,
			width: 4,
			height: 1,
			stride: 12,
			places: Buffer.alloc(0),
		});
		expect(readBomGrpLayout(good)).toBeDefined();
		// The word whose top place must be set, and the kinds the engine has none of.
		const noMark = buildGrp({
			kind: 2,
			width: 4,
			height: 1,
			stride: 12,
			places: Buffer.alloc(0),
			mark: false,
		});
		expect(readBomGrpLayout(noMark)).toBeUndefined();
		const badKind = buildGrp({
			kind: 6,
			width: 4,
			height: 1,
			stride: 12,
			places: Buffer.alloc(0),
		});
		expect(readBomGrpLayout(badKind)).toBeUndefined();
		expect(readBomGrpLayout(good.subarray(0, 0x20))).toBeUndefined();
	});

	it("hands a picture of its places as they stand over", () => {
		// A picture whose word in front of the walk has its top place set stands of the places themselves.
		const places = Buffer.from("0102030405060708090a0b0c", "hex");
		const data = buildGrp({
			kind: 2,
			width: 4,
			height: 1,
			stride: 12,
			places,
			stored: true,
		});
		const layout = readBomGrpLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackBomGrpPicture(data, layout)]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
	});

	it("walks the places of a picture of its own places one after the other", () => {
		// Seventeen places of their own, one after the other, of two values that differ: the walk hands a
		// place over only when the one behind it is another one, so the places of a picture of twelve come
		// of the first twelve of them and the place that stands in front at the end is dropped, which is
		// what the reference does.
		const data = buildGrp({
			kind: 2,
			width: 4,
			height: 1,
			stride: 12,
			places: Buffer.from("e2f1b02faedbbf76ba6caaeb2fb640", "hex"),
		});
		const layout = readBomGrpLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackBomGrpPicture(data, layout)]).toEqual([
			0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42,
		]);
	});

	it("walks a run of the frame of the walk", () => {
		// The frame stands of three thousand and sixteen places of a space and of sixty four of nothing,
		// and the walk starts at the end of the spaces. A run of three places of the frame that reaches
		// back to the last of them brings three spaces, and the run of the places behind the walk reads
		// them as a count: the first space stands in front, the second begins a run and the third is its
		// count of thirty two, which hands thirty two spaces over. Then the places of the stream follow.
		const fortyFour = [
			0x42, 0x43, 0x42, 0x43, 0x42, 0x43, 0x42, 0x43, 0x42, 0x43, 0x42, 0x43,
		];
		const data = buildGrp({
			kind: 2,
			width: 44,
			height: 1,
			stride: 44,
			places: Buffer.from("840071b8f7d7972d5fbb5d36556d77db284e338d24", "hex"),
		});
		const layout = readBomGrpLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackBomGrpPicture(data, layout)]).toEqual(
			placesOf(new Array(32).fill(0x20), fortyFour),
		);
	});

	it("walks a run that reaches back to the places it has written itself", () => {
		// A place 0x44 and one 0x45 of its own, then a run of three places of the frame that reaches back
		// two places: it brings the two places behind it and the place they wrote themselves, so the walk
		// hands 0x44, 0x45, 0x44, 0x45 and 0x44 over - the last of them from the two places in front -
		// and the places of the stream behind them follow.
		const data = buildGrp({
			kind: 2,
			width: 28,
			height: 1,
			stride: 28,
			places: Buffer.from(
				"e47261003cae5dd5c5ab17eed545955955f6ca138ce34900",
				"hex",
			),
		});
		const layout = readBomGrpLayout(data);
		if (!layout) throw new Error("no layout");
		expect([...unpackBomGrpPicture(data, layout)]).toEqual([
			0x44, 0x45, 0x44, 0x45, 0x44, 0x46, 0x47, 0x46, 0x47, 0x46, 0x47, 0x46,
			0x47, 0x46, 0x47, 0x46, 0x47, 0x46, 0x47, 0x46, 0x47, 0x46, 0x47, 0x46,
			0x47, 0x46, 0x47, 0x46,
		]);
	});

	it("reads the picture through the format", async () => {
		const data = buildGrp({
			kind: 2,
			width: 4,
			height: 1,
			stride: 12,
			places: Buffer.from("e2f1b02faedbbf76ba6caaeb2fb640", "hex"),
		});
		const handle = await bomGrpImageFormat.open(
			new BufferByteSource(data),
			"sample.grp",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(4);
		expect(bmp.readInt32LE(22)).toBe(-1);
		expect(bmp.readUInt16LE(28)).toBe(24);
		expect([...bmp.subarray(0x36)]).toEqual([
			0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42,
		]);
	});

	it("hands a picture of eight places a colour over as a picture of its own places", async () => {
		// The kinds of four and of eight places a colour carry no palette, and the reference hands them
		// over as Gray8 of the places as they stand: this port writes them of one place each, in a picture
		// as wide as the places of a row of the head.
		const places = Buffer.from("00112233445566778899aabbccddeeff", "hex");
		const data = buildGrp({
			kind: 4,
			width: 8,
			height: 1,
			stride: 16,
			places,
			stored: true,
		});
		const handle = await bomGrpImageFormat.open(
			new BufferByteSource(data),
			"sample.grp",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(16);
		expect(bmp.readUInt16LE(28)).toBe(8);
		expect([...bmp.subarray(1078, 1094)]).toEqual([...places]);
	});

	it("takes the places of a picture of the walk through the format", async () => {
		const data = buildGrp({
			kind: 3,
			width: 2,
			height: 1,
			stride: 4,
			places: Buffer.from("e2f1b02faedbbf76ba6caaeb2fb640", "hex"),
		});
		const handle = await bomGrpImageFormat.open(
			new BufferByteSource(data),
			"sample.grp",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readUInt16LE(28)).toBe(16);
		expect(bmp.readInt32LE(18)).toBe(2);
		expect([...bmp.subarray(0x42, 0x46)]).toEqual([0x41, 0x42, 0x41, 0x42]);
	});
});
