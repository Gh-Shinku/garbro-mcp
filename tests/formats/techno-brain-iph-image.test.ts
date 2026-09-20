import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readIphLayout,
	technoBrainIphImageFormat,
	unpackIph,
} from "../../packages/formats/src/techno-brain/iph-image.js";

const PICTURE_OFFSET = 0x58;

/** The head of a picture of two places in one row: the words of the head of the kind of files it stands as, the
 * words of its own head, and the words of the places of the picture. */
function buildPicture(
	picture: Buffer,
	packedSize: number,
	compressed: boolean,
): Buffer {
	const head = Buffer.alloc(PICTURE_OFFSET, 0x00);
	head.write("RIFF", 0, "latin1");
	head.writeInt32LE(0x38, 4);
	head.write("IPH ", 8, "latin1");
	head.write("fmt ", 0x0c, "latin1");
	head.write("bmp ", 0x38, "latin1");
	head.writeInt32LE(packedSize, 0x3c);
	head.writeUInt16LE(2, 0x40);
	head.writeUInt16LE(1, 0x42);
	head.writeUInt16LE(16, 0x50);
	head.writeInt16LE(compressed ? 1 : 0, 0x52);
	return Buffer.concat([head, picture]);
}

/** The walked places of a picture: a place that stands as it stands, a place that stands beside the place
 * before it by how its places of a colour stand beside those of the place before it, and the words of the end
 * of the walk of the row. The places of the walk stand worked out with a walk of the places of the reference's
 * own, so the places of the test stand under a walk this port did not work out. */
const WALKED = Buffer.concat([
	Buffer.from([1]),
	Buffer.from([0x10, 0x21]),
	Buffer.from([0x80 | 30]),
	Buffer.from([0xff]),
	Buffer.from([0x00, 0x00]),
]);
const WALKED_PICTURE = buildPicture(WALKED, WALKED.length, true);
/** What the walk of that picture stands for: the place of the walk, and the place that stands beside it. */
const WALKED_PLACES = Buffer.from([0x21, 0x10, 0x00, 0x08]);

/** The places of a picture that stands as it stands. */
const PLAIN = Buffer.from([0x21, 0x10, 0x43, 0x65]);
const PLAIN_PICTURE = buildPicture(PLAIN, PLAIN.length, false);

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await technoBrainIphImageFormat.open(
		new BufferByteSource(data),
		"picture.iph",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("TechnoBrain Inteligent Picture Format", () => {
	it("reads the head of a picture", () => {
		expect(readIphLayout(WALKED_PICTURE, WALKED_PICTURE.length)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 16,
			compressed: true,
			packedSize: WALKED.length,
			pictureOffset: PICTURE_OFFSET,
		});
	});

	it("turns away a head that names no picture", () => {
		const notRiff = Buffer.from(HEADLESS());
		notRiff.write("RIFX", 0, "latin1");
		expect(readIphLayout(notRiff, notRiff.length)).toBeUndefined();
		const wrongHead = Buffer.from(HEADLESS());
		wrongHead.writeInt32LE(0x40, 4);
		expect(readIphLayout(wrongHead, wrongHead.length)).toBeUndefined();
		const noPicture = Buffer.from(HEADLESS());
		noPicture.write("bmp!", 0x38, "latin1");
		expect(readIphLayout(noPicture, noPicture.length)).toBeUndefined();
		expect(readIphLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("stands the places of a walked picture as the walk names them", () => {
		const layout = readIphLayout(WALKED_PICTURE, WALKED_PICTURE.length);
		if (!layout) throw new Error("the head stands in the picture");
		expect(unpackIph(WALKED_PICTURE, layout)).toEqual(WALKED_PLACES);
	});

	it("stands the places of a picture that stands as they stand", () => {
		const layout = readIphLayout(PLAIN_PICTURE, PLAIN_PICTURE.length);
		if (!layout) throw new Error("the head stands in the picture");
		expect(unpackIph(PLAIN_PICTURE, layout)).toEqual(PLAIN);
	});

	it("hands the places of a picture to a bitmap", async () => {
		const out = await extract(WALKED_PICTURE);
		expect(out.readUInt32LE(0x12)).toBe(2);
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.readUInt16LE(0x1c)).toBe(16);
		// A bitmap of a picture of this kind names how the places of every colour of a place of it stand, so the
		// places of the picture stand behind those words.
		const pictureAt = out.readUInt32LE(0x0a);
		expect(out.subarray(pictureAt, pictureAt + 4)).toEqual(WALKED_PLACES);
	});

	it("turns a picture of places this project does not read away", async () => {
		const data = Buffer.from(PLAIN_PICTURE);
		data.writeUInt16LE(24, 0x50);
		expect(readIphLayout(data, data.length)).toMatchObject({
			bitsPerPixel: 24,
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(
			technoBrainIphImageFormat.detect(new BufferByteSource(data)),
		).resolves.toBe(false);
	});

	it("is told by the words of its head rather than by a word of its own", async () => {
		expect(technoBrainIphImageFormat.descriptor.id).toBe(
			"techno-brain-iph-image",
		);
		expect(technoBrainIphImageFormat.detection).toEqual({ signatures: [] });
		await expect(
			technoBrainIphImageFormat.detect(new BufferByteSource(WALKED_PICTURE)),
		).resolves.toBe(true);
		// A sound of the kind that stands as the words of the RIFF kind stands as no picture of this kind.
		const wave = Buffer.alloc(0x58, 0x00);
		wave.write("RIFF", 0, "latin1");
		wave.write("WAVE", 8, "latin1");
		wave.write("fmt ", 0x0c, "latin1");
		await expect(
			technoBrainIphImageFormat.detect(new BufferByteSource(wave)),
		).resolves.toBe(false);
	});
});

/** The words of a picture of this kind whose places of a picture stand as nothing at all. */
function HEADLESS(): Buffer {
	return buildPicture(Buffer.alloc(0, 0x00), 0, true);
}
