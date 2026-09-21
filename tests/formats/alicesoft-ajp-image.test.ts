import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	alicesoftAjpImageFormat,
	decryptAjpRun,
	readAjpLayout,
	readAjpMask,
} from "../../packages/formats/src/alicesoft/ajp-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const MARK = Buffer.from("AJP", "latin1");
const HEADER_SIZE = 0x24;
const KEY = [
	0x5d, 0x91, 0xae, 0x87, 0x4a, 0x56, 0x41, 0xcd, 0x83, 0xec, 0x4c, 0x92, 0xb5,
	0xcb, 0x16, 0x34,
];
/** The picture of the fixture: four by three, with a JPEG run and an alpha run behind it. */
const IMAGE_OFFSET = 0x28;
const IMAGE_SIZE = 0x20;
const ALPHA_OFFSET = IMAGE_OFFSET + IMAGE_SIZE;
const MASK_WIDTH = 4;
const MASK_HEIGHT = 3;
const MASK_HEADER_SIZE = 0x40;
const MASK_PALETTE_SIZE = 0x300;

/** The alpha run of the fixture: a byte, a saved byte, a filled run, then a pair copied over and over. */
const MASK_RUN = Buffer.from([
	0x07, 0xf8, 0x09, 0xfd, 0x00, 0x0b, 0xfc, 0x00, 0xaa, 0xbb,
]);
/** What that run stands for, before its palette is laid over it. */
const MASK_PIXELS = [
	0x07, 0x09, 0x0b, 0x0b, 0x0b, 0x0b, 0xaa, 0xbb, 0xaa, 0xbb, 0xaa, 0xbb,
];

function buildMask(): Buffer {
	const dataAt = MASK_HEADER_SIZE;
	const paletteAt = dataAt + MASK_RUN.length;
	const out = Buffer.alloc(paletteAt + MASK_PALETTE_SIZE, 0x00);
	out.writeInt32LE(MASK_WIDTH, 0x18);
	out.writeInt32LE(MASK_HEIGHT, 0x1c);
	out.writeInt32LE(dataAt, 0x20);
	out.writeInt32LE(paletteAt, 0x24);
	MASK_RUN.copy(out, dataAt);
	// A palette of three bytes a colour, the grey of which is what the run's own bytes become.
	for (let index = 0; index < 0x100; index += 1) {
		out[paletteAt + index * 3 + 0] = index;
		out[paletteAt + index * 3 + 1] = index;
		out[paletteAt + index * 3 + 2] = index;
	}
	out[paletteAt + 0x0b * 3 + 0] = 3;
	out[paletteAt + 0x0b * 3 + 1] = 6;
	out[paletteAt + 0x0b * 3 + 2] = 9;
	return out;
}

/** The picture's own JPEG run, whose first sixteen bytes the key stands over. */
function jpegRun(): Buffer {
	const out = Buffer.alloc(IMAGE_SIZE, 0x11);
	out.writeUInt16BE(0xffd8, 0);
	out.writeUInt16BE(0xffd9, IMAGE_SIZE - 2);
	return out;
}

function buildAjp(): Buffer {
	const mask = buildMask();
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	MARK.copy(head, 0);
	head.writeInt32LE(1, 4);
	head.writeUInt32LE(MASK_WIDTH, 0x0c);
	head.writeUInt32LE(MASK_HEIGHT, 0x10);
	head.writeUInt32LE(IMAGE_OFFSET, 0x14);
	head.writeUInt32LE(IMAGE_SIZE, 0x18);
	head.writeUInt32LE(ALPHA_OFFSET, 0x1c);
	head.writeUInt32LE(mask.length, 0x20);
	const unpacked = Buffer.alloc(4, 0x00);
	unpacked.writeUInt32LE(MASK_PIXELS.length, 0);
	return Buffer.concat([head, unpacked, jpegRun(), mask]);
}

async function open(data: Buffer) {
	return alicesoftAjpImageFormat.open(
		new BufferByteSource(data),
		"picture.ajp",
	);
}

describe("AliceSoft JPEG image format", () => {
	it("reads the head of the picture", () => {
		expect(readAjpLayout(buildAjp())).toMatchObject({
			version: 1,
			width: MASK_WIDTH,
			height: MASK_HEIGHT,
			bitsPerPixel: 32,
			imageOffset: IMAGE_OFFSET,
			imageSize: IMAGE_SIZE,
			alphaOffset: ALPHA_OFFSET,
			alphaUnpacked: MASK_PIXELS.length,
		});
	});

	it("keys only the first sixteen bytes of a run", () => {
		const run = jpegRun();
		const keyed = decryptAjpRun(run, 0, run.length);
		for (const [index, byte] of KEY.entries()) {
			expect(keyed[index]).toBe((run[index] ?? 0) ^ byte);
		}
		// Everything behind the key stands as it is.
		for (let index = KEY.length; index < run.length; index += 1) {
			expect(keyed[index]).toBe(run[index]);
		}
		// A run shorter than the key is keyed through its whole length and cut where it ends.
		const short = decryptAjpRun(run, 0, 4);
		expect(short.length).toBe(4);
		for (const [index, byte] of short.entries()) {
			expect(byte).toBe((run[index] ?? 0) ^ (KEY[index] ?? 0));
		}
	});

	it("reads the alpha run and its own palette", () => {
		const mask = readAjpMask(buildMask());
		expect(mask).toMatchObject({ width: MASK_WIDTH, height: MASK_HEIGHT });
		// The byte of the fixture whose palette colour is not itself comes out as the grey of that colour.
		expect([...(mask?.pixels ?? [])]).toEqual([
			0x07, 0x09, 6, 6, 6, 6, 0xaa, 0xbb, 0xaa, 0xbb, 0xaa, 0xbb,
		]);
	});

	it("offers the picture and its alpha run, each as it stands", async () => {
		const handle = await open(buildAjp());
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"picture.jpg",
			"picture.alpha.bmp",
		]);
		const picture = handle.entries[0];
		const alpha = handle.entries[1];
		if (!picture || !alpha) throw new Error("no entry");
		const jpeg = await consumeBuffer(await handle.openEntry(picture.id));
		expect(jpeg).toEqual(decryptAjpRun(buildAjp(), IMAGE_OFFSET, IMAGE_SIZE));
		const mask = readBmpImage(
			await consumeBuffer(await handle.openEntry(alpha.id)),
		);
		expect(mask).toMatchObject({ width: MASK_WIDTH, height: MASK_HEIGHT });
		expect([...(mask?.pixels ?? [])]).toEqual([
			0x07, 0x09, 6, 6, 6, 6, 0xaa, 0xbb, 0xaa, 0xbb, 0xaa, 0xbb,
		]);
	});

	it("turns away a picture whose own fields stand outside the file", () => {
		const good = buildAjp();
		// A version below nothing is not a picture of this engine.
		const negative = Buffer.from(good);
		negative.writeInt32LE(-1, 4);
		expect(readAjpLayout(negative)).toBeUndefined();
		// A run that reaches past the file is refused as well.
		const outside = Buffer.from(good);
		outside.writeUInt32LE(0x1000, 0x20);
		expect(readAjpLayout(outside)).toBeUndefined();
		const wrongWord = Buffer.concat([
			Buffer.from("XXX", "latin1"),
			Buffer.alloc(HEADER_SIZE, 0x00),
		]);
		expect(readAjpLayout(wrongWord)).toBeUndefined();
	});

	it("turns away an alpha run whose marks are not ones the engine writes", () => {
		const mask = buildMask();
		mask[MASK_HEADER_SIZE] = 0xf9;
		expect(readAjpMask(mask)).toBeUndefined();
	});

	it("is told by the word of the picture", async () => {
		expect(alicesoftAjpImageFormat.descriptor.id).toBe("alicesoft-ajp-image");
		const good = buildAjp();
		expect(
			await alicesoftAjpImageFormat.detect(
				new BufferByteSource(good),
				"picture.ajp",
			),
		).toBe(true);
		const other = Buffer.from(good);
		other.write("XXX", 0, "latin1");
		expect(
			await alicesoftAjpImageFormat.detect(
				new BufferByteSource(other),
				"picture.ajp",
			),
		).toBe(false);
		await expect(
			alicesoftAjpImageFormat.open(new BufferByteSource(other), "picture.ajp"),
		).rejects.toThrow(GarbroError);
	});
});
