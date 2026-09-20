import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeGrc,
	readGrcLayout,
	studioJikkenshitsuGrcImageDescriptor,
	studioJikkenshitsuGrcImageFormat,
} from "../../packages/formats/src/studio-jikkenshitsu/grc-image.js";

/** A Studio Jikkenshitsu picture of the kind its own places stand as: the head, the colours of the picture,
 * the places that name how the steps of every row stand, the places the walk names, and the places of the
 * picture that stand as they stand. */
function grcFile(input: {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	flags?: number;
	rows?: Buffer;
	bits?: Buffer;
	data?: Buffer;
	colours?: Buffer;
	bitsOffset?: number;
	dataOffset?: number;
}): Buffer {
	const rows = input.rows ?? Buffer.from([3, 2, 1, 0]);
	const bits = input.bits ?? Buffer.from([0x00, 0x11, 0x6c, 0x1b]);
	const data = input.data ?? Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
	const colours = input.colours ?? coloursOf();
	const head = Buffer.alloc(0x20, 0x00);
	head[0] = input.bitsPerPixel ?? 8;
	head[1] = input.flags ?? 0;
	head.writeUInt16LE(input.width ?? 4, 4);
	head.writeUInt16LE(input.height ?? 4, 6);
	const bitsOffset = input.bitsOffset ?? 0x420 + rows.length;
	head.writeInt32LE(bitsOffset, 8);
	head.writeInt32LE(bits.length, 12);
	const dataOffset = input.dataOffset ?? bitsOffset + bits.length;
	head.writeInt32LE(dataOffset, 16);
	head.writeInt32LE(data.length, 20);
	return Buffer.concat([head, colours, rows, bits, data]);
}

/** The colours of a picture, four places a colour: its blue, its green, its red and a place that counts for
 * nothing. */
function coloursOf(count = 0x100): Buffer {
	const out: Buffer = Buffer.alloc(count * 4, 0x00);
	for (let entry = 0; entry < count; entry += 1) {
		out[entry * 4] = entry & 0xff;
		out[entry * 4 + 1] = (entry * 3) & 0xff;
		out[entry * 4 + 2] = (entry * 7) & 0xff;
	}
	return out;
}

describe("Studio Jikkenshitsu picture of the kind its own places stand as", () => {
	it("reads the head of a picture", () => {
		expect(readGrcLayout(grcFile({}), 0x430)).toEqual({
			width: 4,
			height: 4,
			stride: 4,
			encrypted: false,
			bitsOffset: 0x424,
			bitsLength: 4,
			dataOffset: 0x428,
			dataLength: 8,
			alphaOffset: 0,
			alphaLength: 0,
		});
	});

	it("turns away a file whose head does not hold its own words", () => {
		expect(readGrcLayout(grcFile({ bitsPerPixel: 16 }), 0x430)).toBeUndefined();
		expect(readGrcLayout(grcFile({ width: 0 }), 0x430)).toBeUndefined();
		expect(readGrcLayout(grcFile({ width: 3 }), 0x430)).toBeUndefined();
		expect(readGrcLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("turns away a picture whose places stand under a key of its own", () => {
		// The key of such a picture stands in the reference's own settings, which this project does not carry.
		expect(readGrcLayout(grcFile({ flags: 0x80 }), 0x430)).toBeUndefined();
	});

	it("turns away a picture whose walk stands outside the file", () => {
		expect(
			readGrcLayout(grcFile({ bitsOffset: 0x500 }), 0x430),
		).toBeUndefined();
		expect(
			readGrcLayout(grcFile({ dataOffset: 0x900 }), 0x430),
		).toBeUndefined();
	});

	it("stands the places of every step of a row behind the places the row names", () => {
		// The steps of the four rows stand the four ways of the walk in turn: every step of four places stands
		// behind one place of its row, the four places of the step standing four pairs of places of it, the
		// highest pair first.
		const layout = readGrcLayout(grcFile({}), 0x430);
		if (!layout) throw new Error("the picture stands in the file");
		const bmp = decodeGrc(grcFile({}), layout);
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readInt32LE(0x16)).toBe(4);
		expect(bmp.subarray(0x436, 0x446)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 2, 6, 4, 4, 4, 4, 7, 8, 8, 4, 4]),
		);
	});

	it("stands the colours of the picture beside the places of it", () => {
		const layout = readGrcLayout(grcFile({}), 0x430);
		if (!layout) throw new Error("the picture stands in the file");
		const bmp = decodeGrc(grcFile({}), layout);
		// The colours of the file stand as the blue, the green, the red and a place of nothing, and a bitmap
		// stands them as the red, the green and the blue.
		expect(bmp.subarray(0x36, 0x42)).toEqual(
			Buffer.from("0000000703010e0602150903", "hex"),
		);
	});

	it("hands out the places of a picture as a bitmap of eight bits", async () => {
		const file = grcFile({});
		const handle = await studioJikkenshitsuGrcImageFormat.open(
			new BufferByteSource(file),
			"scene.grc",
		);
		expect(handle.entries[0]?.path).toBe("scene.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 4,
			bitsPerPixel: 8,
		});
		const bmp = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(bmp.subarray(0x436, 0x446)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 2, 6, 4, 4, 4, 4, 7, 8, 8, 4, 4]),
		);
	});

	it("reads a picture of its own kind only where its name stands as the name of one", async () => {
		expect(studioJikkenshitsuGrcImageDescriptor.id).toBe(
			"studio-jikkenshitsu-grc-image",
		);
		await expect(
			studioJikkenshitsuGrcImageFormat.detect(
				new BufferByteSource(grcFile({})),
				"scene.grc",
			),
		).resolves.toBe(true);
		await expect(
			studioJikkenshitsuGrcImageFormat.detect(
				new BufferByteSource(grcFile({})),
				"scene.dat",
			),
		).resolves.toBe(false);
		await expect(
			studioJikkenshitsuGrcImageFormat.detect(
				new BufferByteSource(Buffer.from("not a picture at all")),
				"scene.grc",
			),
		).resolves.toBe(false);
	});
});
