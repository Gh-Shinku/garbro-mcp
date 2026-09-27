import { Buffer } from "node:buffer";
import {
	BufferByteSource,
	FileByteSource,
	GarbroError,
} from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

/** A directory of its own for a picture and the baseline picture beside it. */
async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-ism-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

/**
 * The simple way, of every pixel of the picture its own single byte and a control byte of nought behind
 * every eight of them, which the engine writes as it goes.
 */
function runsBody(pixels: readonly number[]): Buffer {
	const parts: number[] = [];
	for (let at = 0; at < pixels.length; at += 8) {
		parts.push(0x00);
		for (let index = at; index < at + 8; index += 1)
			parts.push(pixels[index] ?? 0);
	}
	return Buffer.from(parts);
}

/**
 * A picture of the third way: the name of its baseline picture at 0x30, the count of overlay blocks and the
 * length of the overlay stream behind it, the control bytes of the blocks, and that stream, which stands of
 * literals alone here (a control byte of nought stands for eight bytes that stand as they are).
 */
function buildOverlay(options: {
	width: number;
	height: number;
	baseName: string;
	count: number;
	control: Buffer;
	blocks: Buffer;
}): Buffer {
	const stream = Buffer.concat([
		...Array.from(
			{ length: Math.ceil(options.blocks.length / 8) },
			(_, index) =>
				Buffer.concat([
					Buffer.from([0x00]),
					options.blocks.subarray(index * 8, index * 8 + 8),
				]),
		),
	]);
	const head = Buffer.alloc(DATA_START, 0x00);
	head.write(MARK, 0, "latin1");
	head[0x10] = TYPE_OVERLAY;
	head[0x1d] = options.width & 0xff;
	head[0x1e] = options.width >> 8;
	head[0x1f] = options.height & 0xff;
	head[0x20] = options.height >> 8;
	head[0x23] = 4;
	head.writeUInt32LE(stream.length, 0x11);
	const counts = Buffer.alloc(8, 0x00);
	counts.writeInt32LE(options.count, 0);
	counts.writeInt32LE(stream.length, 4);
	return Buffer.concat([
		head,
		Buffer.from(`${options.baseName}\u0000`, "latin1"),
		counts,
		options.control,
		stream,
	]);
}

/** The rows of a picture bottom up, the way the reference hands one over. */
function flippedRows(pixels: readonly number[], width: number): number[] {
	const out: number[] = [];
	const height = Math.trunc(pixels.length / width);
	for (let row = height - 1; row >= 0; row -= 1) {
		out.push(...pixels.slice(row * width, row * width + width));
	}
	return out;
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

	it("reads a picture that stands over a baseline picture of a name it carries beside it", async () => {
		// Sixteen by eight pixels, of which two blocks of four by four stand written over: the first block of
		// the walk from the overlay data's own first bytes, and the sixth from the bytes behind those.
		const width = 16;
		const height = 8;
		const base = Array.from({ length: width * height }, () => 1);
		const blocks = Buffer.from([
			...Array.from({ length: 4 }, () => [0, 1, 2, 3]).flat(),
			...Array.from({ length: 4 }, () => [3, 2, 1, 0]).flat(),
		]);
		const directory = await temporaryDirectory();
		const basePath = resolve(directory, "baseline.isg");
		await writeFile(
			basePath,
			buildIsg({
				width,
				height,
				type: TYPE_RUNS,
				colours: 4,
				packed: runsBody(base).length,
				body: runsBody(base),
			}),
		);
		const overlayPath = resolve(directory, "overlay.isg");
		await writeFile(
			overlayPath,
			buildOverlay({
				width,
				height,
				baseName: "baseline.isg",
				count: 1,
				// One control byte, one bit to a block: the first and the sixth block stand written over.
				control: Buffer.from([0x21]),
				blocks,
			}),
		);
		const handle = await ismIsgImageFormat.open(
			await FileByteSource.open(overlayPath),
			overlayPath,
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		expect(image).toMatchObject({ width, height, bitsPerPixel: 8 });
		const expected = [...base];
		for (let row = 0; row < 4; row += 1) {
			for (let column = 0; column < 4; column += 1) {
				expected[row * width + column] = blocks[row * 4 + column] ?? 0;
				expected[(row + 4) * width + column + 4] =
					blocks[16 + row * 4 + column] ?? 0;
			}
		}
		expect([...(image?.pixels ?? [])]).toEqual(flippedRows(expected, width));
		// The palette of the picture stands of the baseline picture as well.
		expect([...(image?.palette ?? [])].slice(0, 16)).toEqual([
			0, 0, 0, 255, 1, 2, 3, 255, 2, 4, 6, 255, 3, 6, 9, 255,
		]);
	});

	it("reads a baseline picture the name of which stands longer than the twelve bytes the reference falls back to", async () => {
		const width = 16;
		const height = 8;
		const base = Array.from({ length: width * height }, () => 2);
		const directory = await temporaryDirectory();
		// The name the picture carries stands nowhere; its first twelve bytes name the file beside it.
		await writeFile(
			resolve(directory, "baseline.isg"),
			buildIsg({
				width,
				height,
				type: TYPE_RUNS,
				colours: 4,
				packed: runsBody(base).length,
				body: runsBody(base),
			}),
		);
		const overlayPath = resolve(directory, "overlay.isg");
		await writeFile(
			overlayPath,
			buildOverlay({
				width,
				height,
				baseName: "baseline.isgxy",
				count: 1,
				control: Buffer.from([0x00]),
				blocks: Buffer.alloc(0, 0x00),
			}),
		);
		const handle = await ismIsgImageFormat.open(
			await FileByteSource.open(overlayPath),
			overlayPath,
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		expect([...(image?.pixels ?? [])]).toEqual(flippedRows(base, width));
	});

	it("turns away a picture whose baseline picture stands nowhere beside it", async () => {
		const directory = await temporaryDirectory();
		const overlayPath = resolve(directory, "overlay.isg");
		await writeFile(
			overlayPath,
			buildOverlay({
				width: 16,
				height: 8,
				baseName: "nowhere.isg",
				count: 1,
				control: Buffer.from([0x00]),
				blocks: Buffer.alloc(0, 0x00),
			}),
		);
		const handle = await ismIsgImageFormat.open(
			await FileByteSource.open(overlayPath),
			overlayPath,
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			/baseline picture/,
		);
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
