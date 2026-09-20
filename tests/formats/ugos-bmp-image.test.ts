import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readDetLayout,
	ugosDetBmpImageFormat,
} from "../../packages/formats/src/ugos/det-image.js";
import { unpackDetPicture } from "../../packages/formats/src/ugos/det-bmp-reader.js";

const HEAD_SIZE = 0x10;
const MARK = 0x46;
const KIND = 0x45;
const BPP_8 = 8;
const BPP_24 = 0x18;
const BPP_32 = 0x20;

/** The places a picture of the test stands walked from, whose places were computed from the reference by an
 * account of its own that was stood against the walk of it: the account was walked over the places below and
 * every place it named outside the picture of the test was refused. */
const STREAM = Buffer.from(
	"15375f8dc1fb3b81cd1f77d539a3138905870f9d31cb6b11bd6f27e5a9734319f5d7bfada19b9ba1adbfd7f5194373a9e5276fbd116bcb319d0f87058913a339d5771fcd813bfbc18d5f3715f9e3d3c9c5c7cfddf10b2b517dafe72569b30359",
	"hex",
);

/** The places of the picture of the test, of four places by four, as the walk of the reference stands them
 * with the places behind them standing walked as well. */
const WALKED = Buffer.from(
	"3e1c160000000000000000000000000000000000000000000000000000000000000000000000000000000000fffffcff00000000000000000000000000000000",
	"hex",
);

/** The places of the picture of the test, of four places by four, with the places behind them standing walked
 * from the stream of their own. */
const WALKED_WITH_ALPHA = Buffer.from(
	"3e1c16bc000000bc000000bc000000bc000000f9000000f9000000a9000000a9000000cd0000003100000031fffffc3100000031000000f5000000f5000000f5",
	"hex",
);

function buildPicture(bitsPerPixel = BPP_32, width = 4, height = 4): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head[0] = MARK;
	head[1] = KIND;
	head[2] = bitsPerPixel;
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	return Buffer.concat([head, STREAM]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await ugosDetBmpImageFormat.open(
		new BufferByteSource(data),
		"picture.bmp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The places of a picture stand behind the places of its head. */
function pixelsOf(bmp: Buffer, from = 0x36): Buffer {
	return bmp.subarray(from);
}

describe("μ-GameOperationSystem compressed bitmap", () => {
	it("reads the head of a picture", () => {
		expect(readDetLayout(buildPicture(), HEAD_SIZE + STREAM.length)).toEqual({
			width: 4,
			height: 4,
			bitsPerPixel: BPP_32,
			method: KIND,
		});
		// The reference reads the kind of the picture with the places of the words behind the word of its head
		// dropped, so a head that names the kind in the places beneath it stands as one that names it above.
		const lower = buildPicture();
		lower[1] = 0x65;
		expect(readDetLayout(lower, HEAD_SIZE + STREAM.length)?.method).toBe(KIND);
	});

	it("turns away a head that names no picture of this kind", () => {
		const wrongMark = buildPicture();
		wrongMark[0] = 0x42;
		expect(readDetLayout(wrongMark, HEAD_SIZE + STREAM.length)).toBeUndefined();
		const wrongKind = buildPicture();
		wrongKind[1] = 0x41;
		expect(readDetLayout(wrongKind, HEAD_SIZE + STREAM.length)).toBeUndefined();
		const wrongBpp = buildPicture();
		wrongBpp[2] = 0x10;
		expect(readDetLayout(wrongBpp, HEAD_SIZE + STREAM.length)).toBeUndefined();
		expect(readDetLayout(Buffer.alloc(4), 4)).toBeUndefined();
	});

	it("walks the places of a picture", () => {
		// The account of the reference of its own that computed these places named no place outside the
		// picture of the test, so the walk stands as the reference stands it.
		expect(unpackDetPicture(STREAM, 4, 4, BPP_24)).toEqual(WALKED);
	});

	it("hands the places of the picture out as a picture of four places", async () => {
		const bmp = await extract(buildPicture());
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(bmp.readInt32LE(0x12)).toBe(4);
		// A picture of this kind stands from its top rather than from its bottom, which a picture of this
		// project names by standing its rows from the height of it downwards.
		expect(bmp.readInt32LE(0x16)).toBe(-4);
		expect(bmp.readUInt32LE(0x22)).toBe(64);
		// The places behind the places of the picture stand in a stream of their own.
		expect(pixelsOf(bmp)).toEqual(WALKED_WITH_ALPHA);
	});

	it("stands a picture of four and twenty places with the place behind it clear of its stream", async () => {
		// The reference walks the places behind the places of a picture of four and twenty places from the
		// stream of the picture itself, so those places stand as the picture stands them, and it names the kind
		// of such a picture as a picture of thirty-two places when it hands it out.
		const bmp = await extract(buildPicture(BPP_24));
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(pixelsOf(bmp)).toEqual(WALKED);
	});

	it("stands a picture of eight places as one place for every place of it", async () => {
		const bmp = await extract(buildPicture(BPP_8));
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		// Every place of the picture stands for the first place of four of the walk of it.
		const grey = Buffer.alloc(16);
		for (let at = 0; at < 16; at += 1) grey[at] = WALKED[at * 4] ?? 0;
		expect(pixelsOf(bmp, 0x436)).toEqual(grey);
	});

	it("turns a picture cut short of its places away", async () => {
		const cut = buildPicture();
		await expect(
			extract(Buffer.from(cut.subarray(0, HEAD_SIZE + 8))),
		).rejects.toThrow(GarbroError);
	});

	it("is told by the words of the head", async () => {
		expect(ugosDetBmpImageFormat.descriptor.id).toBe("ugos-bmp-image");
		await expect(
			ugosDetBmpImageFormat.detect(new BufferByteSource(buildPicture())),
		).resolves.toBe(true);
		const wrongBpp = buildPicture();
		wrongBpp[2] = 0x10;
		await expect(
			ugosDetBmpImageFormat.detect(new BufferByteSource(wrongBpp)),
		).resolves.toBe(false);
	});
});
