import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { an10Format, an20Format, anmFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { expectArchive } from "../helpers/archive.js";

interface Frame {
	width: number;
	height: number;
	depth: number;
	fill?: number;
	/** The places of the file of the frame, in the order the file holds them: the rows stand bottom up. */
	pixels?: Buffer;
	/** The place of the frame in the picture of the file itself. */
	x?: number;
	y?: number;
}

function frameBuffer(frame: Frame, headerSize: number): Buffer {
	const imageSize = frame.depth * frame.width * frame.height;
	const header = Buffer.alloc(headerSize);
	header.writeInt32LE(frame.x ?? 0, 0);
	header.writeInt32LE(frame.y ?? 0, 4);
	header.writeUInt32LE(frame.width, 8);
	header.writeUInt32LE(frame.height, 0x0c);
	if (headerSize > 0x10) header.writeUInt32LE(frame.depth, 0x10);
	const pixels = frame.pixels ?? Buffer.alloc(imageSize, frame.fill ?? 0);
	if (pixels.length !== imageSize)
		throw new Error("places do not stand of the frame");
	return Buffer.concat([header, pixels]);
}

/** Versions 00 and 10 reach their frame list through a count at 0x14 and a four-byte table behind it. */
function buildAn0x(
	signature: string,
	frames: readonly Frame[],
	headerSize: number,
	base: { x: number; y: number } = { x: 0, y: 0 },
): Buffer {
	const firstCount = 1;
	const tableEnd = 0x18 + firstCount * 4;
	const parts = frames.map((frame) => frameBuffer(frame, headerSize));
	const body = Buffer.concat(parts);
	const archive = Buffer.alloc(tableEnd + 2 + body.length);
	archive.write(signature, 0, "ascii");
	// `AnmOpenerBase.GetBaseInfo`: the place of the picture of the file itself stands at four and eight.
	archive.writeInt32LE(base.x, 4);
	archive.writeInt32LE(base.y, 8);
	archive.writeInt16LE(firstCount, 0x14);
	archive.writeInt16LE(frames.length, tableEnd);
	body.copy(archive, tableEnd + 2);
	return archive;
}

/** Version 20 walks the shared preamble, then a count, then a sixteen-byte gap before the frames. */
function buildAn20(frames: readonly Frame[]): Buffer {
	const tableEnd = 10;
	const framesStart = tableEnd + 2 + 0x10;
	const parts = frames.map((frame) => frameBuffer(frame, 0x14));
	const body = Buffer.concat(parts);
	const archive = Buffer.alloc(framesStart + body.length);
	archive.write("AN20", 0, "ascii");
	archive.writeUInt16LE(0, 4);
	archive.writeUInt16LE(0, 8);
	archive.writeInt16LE(frames.length, tableEnd);
	body.copy(archive, framesStart);
	return archive;
}

/** The bitmap a frame of a picture stands of, read back through the matching reader of this project. */
async function pictureOfFrame(
	format: typeof anmFormat,
	archive: Buffer,
	path: string,
): Promise<{
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: number[];
	palette: number[];
}> {
	const handle = await format.open(new BufferByteSource(archive), "anim.anm");
	const entry = handle.entries.find((item) => item.path === path);
	if (!entry) throw new Error(`no frame ${path}`);
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no bitmap");
	return {
		width: image.width,
		height: image.height,
		bitsPerPixel: image.bitsPerPixel,
		pixels: [...image.pixels],
		palette: [...image.palette],
	};
}

describe("KaGuYa ANM animation resources", () => {
	it("reads the version 00 layout with thirty-two bits per pixel", async () => {
		// Two rows of the file stand of a picture of two rows, the last row of the file standing first.
		const frames: Frame[] = [
			{
				width: 2,
				height: 2,
				depth: 4,
				x: 5,
				y: 7,
				pixels: Buffer.from([
					1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
				]),
			},
			{ width: 1, height: 3, depth: 4, fill: 0x22 },
		];
		const archive = buildAn0x("AN00", frames, 0x10, { x: 3, y: 4 });
		const handle = await anmFormat.open(
			new BufferByteSource(archive),
			"anim.anm",
		);
		expect(
			handle.entries.map((entry) => ({
				path: entry.path,
				size: entry.size,
				metadata: entry.metadata,
			})),
		).toEqual([
			{
				path: "anim#00",
				size: BigInt(frameBuffer(frames[0] as Frame, 0x10).length),
				metadata: {
					inferredType: "image",
					frameIndex: 0,
					x: 8,
					y: 11,
					width: 2,
					height: 2,
					depth: 4,
				},
			},
			{
				path: "anim#01",
				size: BigInt(frameBuffer(frames[1] as Frame, 0x10).length),
				metadata: {
					inferredType: "image",
					frameIndex: 1,
					x: 3,
					y: 4,
					width: 1,
					height: 3,
					depth: 4,
				},
			},
		]);
		expect(await pictureOfFrame(anmFormat, archive, "anim#00")).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			pixels: [9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8],
		});
	});

	it("reads the version 10 layout with a channel word", async () => {
		const frames: Frame[] = [
			{
				width: 2,
				height: 2,
				depth: 3,
				pixels: Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11, 12]),
			},
		];
		const archive = buildAn0x("AN10", frames, 0x14);
		expect(await pictureOfFrame(an10Format, archive, "anim#00")).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			// The second row of the file stands first in the picture.
			pixels: [3, 2, 1, 0, 11, 12, 9, 8, 7, 6, 5, 4],
		});
	});

	it("reads a version 10 frame of four places of a colour", async () => {
		const frames: Frame[] = [
			{
				width: 1,
				height: 2,
				depth: 4,
				pixels: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
			},
		];
		const archive = buildAn0x("AN10", frames, 0x14);
		expect(await pictureOfFrame(an10Format, archive, "anim#00")).toMatchObject({
			bitsPerPixel: 32,
			pixels: [5, 6, 7, 8, 1, 2, 3, 4],
		});
	});

	it("reads the version 20 layout through the shared preamble", async () => {
		const frames: Frame[] = [
			{
				width: 2,
				height: 2,
				depth: 1,
				pixels: Buffer.from([0x10, 0x20, 0x30, 0x40]),
			},
			{ width: 1, height: 1, depth: 1, fill: 0x55 },
		];
		const archive = buildAn20(frames);
		const picture = await pictureOfFrame(an20Format, archive, "anim#00");
		expect(picture).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
			// A picture of one place of a colour stands of grey, the second row of the file standing first.
			pixels: [0x30, 0x40, 0x10, 0x20],
		});
		// The colour map of a picture of one place of a colour stands of the places of a colour in grey.
		expect(picture.palette.slice(0, 8)).toEqual([0, 0, 0, 0, 1, 1, 1, 0]);
		expect(picture.palette.slice(0x40, 0x44)).toEqual([0x10, 0x10, 0x10, 0]);
	});

	it("turns away a version 20 frame of a count of places of a colour the engine knows not", async () => {
		const frames: Frame[] = [{ width: 1, height: 1, depth: 2, fill: 0x44 }];
		const archive = buildAn20(frames);
		const handle = await an20Format.open(
			new BufferByteSource(archive),
			"anim.anm",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			/stands of 2 places of a colour/,
		);
	});

	it("turns away a version 10 frame of one place of a colour", async () => {
		const frames: Frame[] = [{ width: 1, height: 1, depth: 1, fill: 0x11 }];
		const archive = buildAn0x("AN10", frames, 0x14);
		const handle = await an10Format.open(
			new BufferByteSource(archive),
			"anim.anm",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			/stands of 1 places of a colour/,
		);
	});

	it("rejects a foreign signature", async () => {
		const frames: Frame[] = [{ width: 1, height: 1, depth: 4, fill: 0 }];
		const archive = buildAn0x("AN00", frames, 0x10);
		archive.write("AN01", 0, "ascii");
		await expectArchive({
			format: anmFormat,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a frame whose span leaves the file", async () => {
		const frames: Frame[] = [{ width: 2, height: 2, depth: 4, fill: 0 }];
		const archive = buildAn0x("AN00", frames, 0x10);
		archive.writeUInt32LE(0x100, 0x18 + 4 + 2 + 8);
		await expectArchive({
			format: anmFormat,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});
});
