import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readJbpLayout,
	sviuJbpImageFormat,
} from "../../packages/formats/src/sviu/jbp-image.js";

const DATA_POS = 0x30;
const WALK_PLACES = 0x10;
const FREQUENCY_SIZE = 0x40;
const QUANT_FIELD = 0x80;

/** A picture of sixteen places: the words of its head, the places that name how many places of the walk of its
 * places stand, the words of the walks themselves, the places the walks stand for themselves, and the two
 * walks of the places of its colours. Every place of the walk of its places stands as the same place of the
 * walk, so every place of the picture of every colour stands as nothing and the picture stands as the places
 * of the colours of the picture that stand as the place of the picture itself. */
function buildPicture(): Buffer {
	const head = Buffer.alloc(DATA_POS, 0x00);
	head.write("JBP1", 0, "latin1");
	head.writeInt32LE(DATA_POS, 4);
	head.writeUInt32LE(0, 8);
	head.writeUInt16LE(16, 0x10);
	head.writeUInt16LE(16, 0x12);
	head.writeInt32LE(3, 0x1c);
	head.writeInt32LE(3, 0x20);
	const frequencies = Buffer.alloc(FREQUENCY_SIZE * 2, 0x00);
	// Every one of the sixteen places of the walk of the places that stand for the places of a colour stands
	// for one place of the walk of the picture, so every place of the walk of the picture stands as the same
	// place of the walk as the others.
	for (let at = 0; at < WALK_PLACES; at += 1) {
		frequencies.writeUInt32LE(1, at * 4);
		frequencies.writeUInt32LE(1, FREQUENCY_SIZE + at * 4);
	}
	// The words of the walks of the places of the picture, every one of which names one place of the walk of
	// the picture and stands as the place one.
	const words = Buffer.alloc(WALK_PLACES, 0x00);
	const quant = Buffer.alloc(QUANT_FIELD, 0x00);
	// The walks of the places that stand for the places of a colour: the places 0000 stand for no places of
	// the walk of the picture, and the places 1111 name the end of the places of a colour.
	const dcWalk = Buffer.alloc(3, 0x00);
	const acWalk = Buffer.alloc(3, 0xff);
	return Buffer.concat([head, frequencies, words, quant, dcWalk, acWalk]);
}

const PICTURE = buildPicture();

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await sviuJbpImageFormat.open(
		new BufferByteSource(data),
		"picture.jbp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("SVIU System image format", () => {
	it("reads the head of a picture", () => {
		expect(readJbpLayout(PICTURE, PICTURE.length)).toEqual({
			width: 16,
			height: 16,
			bitsPerPixel: 24,
		});
	});

	it("turns away a head that names no picture", () => {
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.write("JBP2", 0, "latin1");
		expect(readJbpLayout(wrongMark, wrongMark.length)).toBeUndefined();
		const noPlaces = Buffer.from(PICTURE);
		noPlaces.writeUInt16LE(0, 0x10);
		expect(readJbpLayout(noPlaces, noPlaces.length)).toBeUndefined();
		expect(readJbpLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("stands the places of the picture as a picture of its own", async () => {
		const out = await extract(PICTURE);
		expect(out.readUInt32LE(0x12)).toBe(16);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-16);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// Every place of the picture of every colour stands as nothing, so every place of the picture stands as
		// the places of the colours of the picture that stand as the place of the picture itself.
		const pixels = out.subarray(0x36);
		expect(pixels.length).toBe(16 * 16 * 3);
		for (let at = 0; at < pixels.length; at += 3) {
			expect([pixels[at], pixels[at + 1], pixels[at + 2]]).toEqual([
				0x80, 0x80, 0x80,
			]);
		}
	});

	it("hands the picture out as the words of its head name it", async () => {
		const handle = await sviuJbpImageFormat.open(
			new BufferByteSource(PICTURE),
			"picture.jbp",
		);
		expect(handle.entries[0]?.path).toBe("picture.bmp");
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 16,
			height: 16,
			bitsPerPixel: 24,
		});
	});

	it("turns a file whose places stand as no walk at all away", async () => {
		const walkAt = DATA_POS + 0x80 + WALK_PLACES + QUANT_FIELD;
		const cut = Buffer.from(PICTURE.subarray(0, walkAt + 1));
		await expect(extract(cut)).rejects.toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(sviuJbpImageFormat.descriptor.id).toBe("sviu-jbp-image");
		expect(sviuJbpImageFormat.descriptor.extensions).toEqual(["jbp"]);
		await expect(
			sviuJbpImageFormat.detect(new BufferByteSource(PICTURE)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.write("JBP2", 0, "latin1");
		await expect(
			sviuJbpImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
