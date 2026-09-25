import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	clsImageFormat,
	readClsLayout,
	unpackCls,
} from "../../packages/formats/src/lambda/cls-image.js";

const FRAME_POINTER = 0x80;
const FRAME = 0x200;
const CHANNELS_AT = 0x300;
const PALETTE_AT = 0x400;
const FILE_SIZE = 0x800;
/** The three depths the format byte names. */
const FORMAT_8 = 2;
const FORMAT_24 = 4;
const FORMAT_32 = 5;

interface Wanted {
	width: number;
	height: number;
	format: number;
	compressed: boolean;
	/** One buffer per channel, the method word already written for a packed picture. */
	channels: Buffer[];
	palette?: Buffer;
	version?: number;
}

/** A texture of this engine: the head, the place that names the frame, the frame's head and its channels. */
function buildTexture(wanted: Wanted): Buffer {
	const data = Buffer.alloc(FILE_SIZE, 0x00);
	data.write("CLS_TEXFILE", 0, "latin1");
	data.writeUInt32LE(FRAME_POINTER, 0x14);
	data.writeInt32LE(FRAME, FRAME_POINTER);
	data.writeUInt16LE(wanted.version ?? 1, FRAME + 4);
	data.writeUInt32LE(wanted.width, FRAME + 0x1c);
	data.writeUInt32LE(wanted.height, FRAME + 0x20);
	data.writeInt32LE(0x20, FRAME + 0x24);
	data.writeInt32LE(0x30, FRAME + 0x28);
	data.writeUInt8(wanted.compressed ? 1 : 0, FRAME + 0x30);
	data.writeUInt8(wanted.format, FRAME + 0x31);
	// The places the frame names are counted from the frame's own head, as the reference counts them.
	let at = CHANNELS_AT;
	for (const [number, channel] of wanted.channels.entries()) {
		data.writeInt32LE(at - FRAME, FRAME + 0x48 + number * 4);
		data.writeInt32LE(channel.length, FRAME + 0x58 + number * 4);
		channel.copy(data, at);
		at += channel.length;
	}
	if (wanted.palette) {
		data.writeInt32LE(PALETTE_AT - FRAME, FRAME + 0x68);
		data.writeInt32LE(wanted.palette.length, FRAME + 0x6c);
		wanted.palette.copy(data, PALETTE_AT);
	}
	return data;
}

/** One stored channel: the method word and the rows of the plane behind it. */
function storedChannel(rows: Buffer): Buffer {
	const method = Buffer.alloc(2, 0x00);
	return Buffer.concat([method, rows]);
}

/**
 * One packed channel: the method word, then the lengths of the chunks one after another - as the reference's
 * own walk reads them - and the bodies of the chunks behind those.
 */
function packedChannel(chunks: readonly Buffer[]): Buffer {
	const method = Buffer.from([0x00, 0x01]);
	const headers: Buffer[] = [];
	for (const chunk of chunks) {
		const size = Buffer.alloc(2, 0x00);
		size.writeUInt16BE(chunk.length, 0);
		headers.push(size);
	}
	return Buffer.concat([method, ...headers, ...chunks]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await clsImageFormat.open(
		new BufferByteSource(data),
		"texture.cls",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Lambda engine texture", () => {
	it("draws the channels of a packed picture into their own bytes", async () => {
		// Three channels of one row, red first and blue last, each stored as its own plane.
		const data = buildTexture({
			width: 2,
			height: 1,
			format: FORMAT_24,
			compressed: true,
			channels: [
				storedChannel(Buffer.from([0x11, 0x12])),
				storedChannel(Buffer.from([0x21, 0x22])),
				storedChannel(Buffer.from([0x31, 0x32])),
			],
		});
		expect(readClsLayout(data)).toMatchObject({
			frameOffset: FRAME,
			width: 2,
			height: 1,
			offsetX: 0x20,
			offsetY: 0x30,
			bitsPerPixel: 24,
			channels: 3,
			compressed: true,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(24);
		expect([...bmp.pixels]).toEqual([0x31, 0x21, 0x11, 0x32, 0x22, 0x12]);
	});

	it("keeps a row that is narrower than the picture as the channel before it left it", async () => {
		// Every channel stores one byte of a two wide row, so the second byte of every row is whatever the
		// place held - which for the second channel is the first channel's own byte there.
		const data = buildTexture({
			width: 2,
			height: 1,
			format: FORMAT_24,
			compressed: true,
			channels: [
				storedChannel(Buffer.from([0x11])),
				storedChannel(Buffer.from([0x21])),
				storedChannel(Buffer.from([0x31])),
			],
		});
		const layout = readClsLayout(data);
		if (!layout) throw new Error("no layout");
		const { pixels } = unpackCls(data, layout);
		// Every channel writes the one byte of its own row into the same place, so the second byte of the
		// place is never written by anybody and the second pixel comes out as nothing.
		expect([...pixels]).toEqual([0x31, 0x21, 0x11, 0x00, 0x00, 0x00]);
	});

	it("unpacks a channel whose rows are written as runs", async () => {
		// One chunk of five bytes: four bytes that stand as they are, then nothing to fill; the chunk behind
		// it names a length the reference counts but never reads, since the picture has only one row.
		const data = buildTexture({
			width: 4,
			height: 1,
			format: FORMAT_24,
			compressed: true,
			channels: [
				packedChannel([
					Buffer.from([0x03, 1, 2, 3, 4]),
					Buffer.from([0xff, 0xff]),
				]),
				storedChannel(Buffer.from([9, 9, 9, 9])),
				storedChannel(Buffer.from([8, 8, 8, 8])),
			],
		});
		const layout = readClsLayout(data);
		if (!layout) throw new Error("no layout");
		const { pixels } = unpackCls(data, layout);
		expect([...pixels]).toEqual([8, 9, 1, 8, 9, 2, 8, 9, 3, 8, 9, 4]);
	});

	it("writes a run of one byte over and over, and fills a short row with nothing", async () => {
		// The first row is two bytes that stand as they are and then two of one value; the second is two
		// bytes and then nothing, since the run leaves the rest of the row to be filled.
		const data = buildTexture({
			width: 4,
			height: 2,
			format: FORMAT_24,
			compressed: true,
			channels: [
				packedChannel([
					Buffer.from([0x01, 7, 8, 0xff, 9]),
					Buffer.from([0x01, 5, 6]),
				]),
				storedChannel(Buffer.alloc(8, 5)),
				storedChannel(Buffer.alloc(8, 6)),
			],
		});
		const layout = readClsLayout(data);
		if (!layout) throw new Error("no layout");
		const { pixels } = unpackCls(data, layout);
		expect([...pixels].filter((_, at) => at % 3 === 2)).toEqual([
			7, 8, 9, 9, 5, 6, 0, 0,
		]);
	});

	it("hands an unpacked picture over as it stands, with no channels drawn together", async () => {
		// The reference reads the first channel's block alone, so the whole picture stands in it.
		const whole = Buffer.from([0x31, 0x21, 0x11, 0x32, 0x22, 0x12]);
		const data = buildTexture({
			width: 2,
			height: 1,
			format: FORMAT_24,
			compressed: false,
			channels: [whole, Buffer.from([0, 0])],
		});
		const bmp = readBmpImage(await extract(data));
		expect([...(bmp?.pixels ?? [])]).toEqual([...whole]);
	});

	it("carries the colour map of a picture of eight bits into the bitmap", async () => {
		const palette = Buffer.from([
			0x01, 0x02, 0x03, 0xff, 0x11, 0x22, 0x33, 0xff,
		]);
		const data = buildTexture({
			width: 2,
			height: 1,
			format: FORMAT_8,
			compressed: true,
			channels: [storedChannel(Buffer.from([0, 1]))],
			palette,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(8);
		expect([...bmp.pixels.subarray(0, 2)]).toEqual([0, 1]);
		expect([...bmp.palette.subarray(0, 8)]).toEqual([...palette]);
	});

	it("turns away a depth, a version and a method it does not know", async () => {
		const wanted = {
			width: 2,
			height: 1,
			format: FORMAT_24,
			compressed: true,
			channels: [storedChannel(Buffer.from([1, 2]))],
		};
		const otherFormat = buildTexture({ ...wanted, format: 3 });
		expect(readClsLayout(otherFormat)).toBeUndefined();
		expect(
			await clsImageFormat.detect(new BufferByteSource(otherFormat), "a.cls"),
		).toBe(false);
		const otherVersion = buildTexture({ ...wanted, version: 2 });
		expect(readClsLayout(otherVersion)).toBeUndefined();

		// A method the reference does not know stops it, and so does a channel that ends inside itself.
		const otherMethod = buildTexture({
			...wanted,
			channels: [Buffer.from([0x00, 0x02, 1, 2])],
		});
		await expect(extract(otherMethod)).rejects.toThrow(/channel method 2/);
		// A texture that ends inside the channel its head names, which no read may walk past.
		const short = buildTexture({
			...wanted,
			channels: [storedChannel(Buffer.alloc(0x200, 1))],
		}).subarray(0, CHANNELS_AT);
		await expect(extract(short)).rejects.toThrow(GarbroError);
	});

	it("reads a picture of thirty two bits as four channels", async () => {
		const data = buildTexture({
			width: 1,
			height: 1,
			format: FORMAT_32,
			compressed: true,
			channels: [
				storedChannel(Buffer.from([0x11])),
				storedChannel(Buffer.from([0x22])),
				storedChannel(Buffer.from([0x33])),
				storedChannel(Buffer.from([0x44])),
			],
		});
		const layout = readClsLayout(data);
		expect(layout?.channels).toBe(4);
		const bmp = readBmpImage(await extract(data));
		expect([...(bmp?.pixels ?? [])]).toEqual([0x33, 0x22, 0x11, 0x44]);
	});
});
