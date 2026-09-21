import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	ismIsgImageFormat,
	readIsgLayout,
	unpackIsgLzss,
	unpackIsgRuns,
} from "../../packages/formats/src/ism/isg-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const MARK = "ISM IMAGEFILE\0";
const DATA_START = 0x30;
/** The two ways a picture of this engine is packed that stand on the file itself. */
const TYPE_RUNS = 0x10;
const TYPE_LZSS = 0x21;
const TYPE_OVERLAY = 0x34;
const COLOUR_BYTES = 3;

/** A palette of three bytes a colour, the first entries differing so a wrong one shows. */
function palette(colours: number): Buffer {
	const out = Buffer.alloc(colours * COLOUR_BYTES, 0x00);
	for (let index = 0; index < colours; index += 1) {
		out[index * 3 + 0] = index;
		out[index * 3 + 1] = (index * 2) & 0xff;
		out[index * 3 + 2] = (index * 3) & 0xff;
	}
	return out;
}

function buildIsg(options: {
	width: number;
	height: number;
	type: number;
	colours?: number;
	packed: number;
	body: Buffer;
}): Buffer {
	const colours = options.colours ?? 0;
	const head = Buffer.alloc(DATA_START, 0x00);
	head.write(MARK, 0, "latin1");
	head[0x10] = options.type;
	head[0x1d] = options.width & 0xff;
	head[0x1e] = options.width >> 8;
	head[0x1f] = options.height & 0xff;
	head[0x20] = options.height >> 8;
	head[0x23] = colours & 0xff;
	head.writeUInt32LE(options.packed, 0x11);
	return Buffer.concat([
		head,
		palette(0x100 === colours ? 0x100 : colours),
		options.body,
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await ismIsgImageFormat.open(
		new BufferByteSource(data),
		"picture.isg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("ISM engine image format", () => {
	it("unpacks the packed way, control word high bit first", () => {
		// Four bytes stand as they are, and a copy takes them back from the frame's own first place.
		const stream = Buffer.from([0x08, 0x01, 0x02, 0x03, 0x04, 0x0f, 0xf7]);
		const out = Buffer.alloc(8, 0x00);
		unpackIsgLzss(stream, 0, stream.length, out);
		expect([...out]).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
	});

	it("unpacks the simple way, where a set bit brings a length behind its byte", () => {
		// The first decision fills two bytes with one, and the second fills two more with another.
		const stream = Buffer.from([0x03, 0x05, 0x00, 0x07, 0x00]);
		const out = Buffer.alloc(4, 0x00);
		unpackIsgRuns(stream, 0, stream.length, out);
		expect([...out]).toEqual([5, 5, 7, 7]);
	});

	it("reads the head of the picture", () => {
		const body = Buffer.from([0x00, 0x05]);
		expect(
			readIsgLayout(
				buildIsg({
					width: 4,
					height: 2,
					type: TYPE_RUNS,
					colours: 0,
					packed: body.length,
					body,
				}),
			),
		).toMatchObject({
			type: TYPE_RUNS,
			width: 4,
			height: 2,
			bitsPerPixel: 8,
			colours: 0x100,
		});
		expect(
			readIsgLayout(
				buildIsg({
					width: 4,
					height: 2,
					type: TYPE_LZSS,
					colours: 4,
					packed: body.length,
					body,
				}),
			),
		).toMatchObject({ type: TYPE_LZSS, colours: 4 });
	});

	it("hands a picture of the simple way over through its own palette", async () => {
		const body = Buffer.from([0x03, 0x05, 0x00, 0x07, 0x00]);
		const out = await extract(
			buildIsg({
				width: 4,
				height: 1,
				type: TYPE_RUNS,
				colours: 0x100,
				packed: body.length,
				body,
			}),
		);
		const image = readBmpImage(out);
		expect(image).toMatchObject({ width: 4, height: 1, bitsPerPixel: 8 });
		// The picture is kept bottom up, as the reference hands it over.
		expect([...(image?.pixels ?? [])]).toEqual([5, 5, 7, 7]);
	});

	it("hands a picture of the packed way over through its own palette", async () => {
		const body = Buffer.from([0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0f, 0xf7]);
		const out = await extract(
			buildIsg({
				width: 4,
				height: 2,
				type: TYPE_LZSS,
				colours: 0x100,
				packed: body.length,
				body,
			}),
		);
		const image = readBmpImage(out);
		expect(image).toMatchObject({ width: 4, height: 2, bitsPerPixel: 8 });
		expect([...(image?.pixels ?? [])]).toEqual([9, 10, 11, 12, 9, 10, 11, 12]);
	});

	it("turns away the way that stands on a baseline picture of its own name", async () => {
		const body = Buffer.from([0x00]);
		const data = buildIsg({
			width: 4,
			height: 1,
			type: TYPE_OVERLAY,
			colours: 4,
			packed: body.length,
			body,
		});
		await expect(
			ismIsgImageFormat.open(new BufferByteSource(data), "picture.isg"),
		).rejects.toThrow(GarbroError);
	});

	it("turns away a file that is not a picture of this engine", () => {
		const good = buildIsg({
			width: 4,
			height: 1,
			type: TYPE_RUNS,
			colours: 4,
			packed: 2,
			body: Buffer.from([0x00, 0x05]),
		});
		const wrongWord = Buffer.from(good);
		wrongWord.write("XXX\0", 0, "latin1");
		expect(readIsgLayout(wrongWord)).toBeUndefined();
		expect(readIsgLayout(good.subarray(0, 0x20))).toBeUndefined();
		const noSize = Buffer.from(good);
		noSize.writeUInt16LE(0, 0x1d);
		expect(readIsgLayout(noSize)).toBeUndefined();
	});

	it("is told by the word of the picture", async () => {
		expect(ismIsgImageFormat.descriptor.id).toBe("ism-isg-image");
		const good = buildIsg({
			width: 2,
			height: 1,
			type: TYPE_RUNS,
			colours: 4,
			packed: 2,
			body: Buffer.from([0x00, 0x01]),
		});
		expect(
			await ismIsgImageFormat.detect(new BufferByteSource(good), "picture.isg"),
		).toBe(true);
		await expect(
			ismIsgImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"picture.isg",
			),
		).rejects.toThrow(GarbroError);
	});
});
