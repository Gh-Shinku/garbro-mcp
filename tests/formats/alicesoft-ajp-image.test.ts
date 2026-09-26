import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
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
import { GREY_JPEG, GREY_PIXELS } from "../helpers/jpeg.js";

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
	return Buffer.concat([head, unpacked, jpegRun(), mask]);
}

/** The key of a run: the first sixteen bytes exclusive-ored with the key of the engine, the rest as it is. */
function keyRun(data: Buffer): Buffer {
	const out = Buffer.from(data);
	for (let at = 0; at < KEY.length && at < out.length; at += 1) {
		out[at] = (out[at] ?? 0) ^ (KEY[at] ?? 0);
	}
	return out;
}

/**
 * A picture of this engine: the keyed run of a JPEG of eight places square, and the run of its alpha
 * channel. The head names the count of the places the alpha unfolds to, of the walks that stand of a zlib
 * stream, and stands of nought where the channel is a run of its own.
 */
function buildJpegAjp(input: {
	width: number;
	height: number;
	alpha: Buffer;
	unpacked: number;
}): Buffer {
	const alphaAt = IMAGE_OFFSET + GREY_JPEG.length;
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	MARK.copy(head, 0);
	head.writeInt32LE(1, 4);
	head.writeUInt32LE(input.width, 0x0c);
	head.writeUInt32LE(input.height, 0x10);
	head.writeUInt32LE(IMAGE_OFFSET, 0x14);
	head.writeUInt32LE(GREY_JPEG.length, 0x18);
	head.writeUInt32LE(alphaAt, 0x1c);
	head.writeUInt32LE(input.alpha.length, 0x20);
	const unpacked = Buffer.alloc(4, 0x00);
	unpacked.writeUInt32LE(input.unpacked, 0);
	return Buffer.concat([
		head,
		unpacked,
		keyRun(GREY_JPEG),
		keyRun(input.alpha),
	]);
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
			alphaUnpacked: 0,
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

	it("lays the alpha channel of the run of its own over the places of the picture", async () => {
		// `AjpFormat.Read` decodes the run of the JPEG with the decoder of the platform and lays the run of
		// the alpha channel, walked by `ReadMask`, over the fourth byte of every pixel. The head of this
		// fixture names no count of the places of the alpha, which is what picks that walk.
		const handle = await open(
			buildJpegAjp({
				width: MASK_WIDTH,
				height: MASK_HEIGHT,
				alpha: buildMask(),
				unpacked: 0,
			}),
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(handle.entries.map((one) => one.path)).toEqual(["picture.bmp"]);
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		if (!image) throw new Error("no bitmap");
		// The head of the picture is four places wide and three tall while the frame of the JPEG is eight
		// square, so the places of the picture itself are the first of every row of the frame.
		expect([image.width, image.height]).toEqual([MASK_WIDTH, MASK_HEIGHT]);
		const mask = [0x07, 0x09, 6, 6, 6, 6, 0xaa, 0xbb, 0xaa, 0xbb, 0xaa, 0xbb];
		const expected: number[] = [];
		for (let y = 0; y < MASK_HEIGHT; y += 1) {
			for (let x = 0; x < MASK_WIDTH; x += 1) {
				const src = (y * 8 + x) * 4;
				expected.push(
					GREY_PIXELS[src] ?? 0,
					GREY_PIXELS[src + 1] ?? 0,
					GREY_PIXELS[src + 2] ?? 0,
					mask[y * MASK_WIDTH + x] ?? 0,
				);
			}
		}
		expect([...image.pixels]).toEqual(expected);
	});

	it("lays the alpha channel of a zlib stream over the places of the picture", async () => {
		const alpha = Buffer.alloc(64);
		for (let at = 0; at < 64; at += 1) alpha[at] = at + 1;
		const handle = await open(
			buildJpegAjp({
				width: 8,
				height: 8,
				alpha: deflateSync(alpha),
				unpacked: 64,
			}),
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		if (!image) throw new Error("no bitmap");
		const expected = Buffer.from(GREY_PIXELS);
		for (let at = 0; at < 64; at += 1) expected[at * 4 + 3] = at + 1;
		expect([...image.pixels]).toEqual([...expected]);
		// A stream that stands short of the count of the places the head names leaves the places behind it
		// at nought, which is what the reference's own read of the stream does.
		const short = Buffer.alloc(4, 0x77);
		const shortHandle = await open(
			buildJpegAjp({
				width: 8,
				height: 8,
				alpha: deflateSync(short),
				unpacked: 64,
			}),
		);
		const shortEntry = shortHandle.entries[0];
		if (!shortEntry) throw new Error("no entry");
		const shortImage = readBmpImage(
			await consumeBuffer(await shortHandle.openEntry(shortEntry.id)),
		);
		if (!shortImage) throw new Error("no bitmap");
		const padded = Buffer.from(GREY_PIXELS);
		for (let at = 0; at < 64; at += 1)
			padded[at * 4 + 3] = at < 4 ? 0x77 : 0x00;
		expect([...shortImage.pixels]).toEqual([...padded]);
		// A head that names fewer places of the alpha than the picture holds stands turned away, where the
		// reference would walk past the buffer it read the channel into.
		await expect(
			open(
				buildJpegAjp({
					width: 8,
					height: 8,
					alpha: deflateSync(short),
					unpacked: 4,
				}),
			).then((handle) => {
				const first = handle.entries[0];
				if (!first) throw new Error("no entry");
				return handle.openEntry(first.id);
			}),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("turns away a run whose places are in no picture format it reads", async () => {
		const handle = await open(
			buildJpegAjp({
				width: 8,
				height: 8,
				alpha: deflateSync(Buffer.alloc(64, 0x11)),
				unpacked: 64,
			}),
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		// The run of the fixture stands of no walks of a JPEG of its own once the key is off it.
		const stray = buildAjp();
		const strayHandle = await open(stray);
		const strayEntry = strayHandle.entries[0];
		if (!strayEntry) throw new Error("no entry");
		await expect(strayHandle.openEntry(strayEntry.id)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		void handle;
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
