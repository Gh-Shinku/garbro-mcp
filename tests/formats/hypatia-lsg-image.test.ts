import { Buffer } from "node:buffer";
import { FileByteSource, BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { hypatiaLsgImageFormat } from "../../packages/formats/src/hypatia/lsg-image.js";
import { withCompanionFiles } from "../helpers/companion.js";

const HEADER_SIZE = 0x14;

interface LsgOptions {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
	bitmapSize?: number;
}

/** A picture: the word of a bitmap, the four fields of this format, and then the pixels. */
function lsgFile(options: LsgOptions): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.write("BM", 0, "latin1");
	header.writeInt32LE(options.bitmapSize ?? options.pixels.length, 4);
	header.writeInt32LE(options.bitsPerPixel, 8);
	header.writeUInt32LE(options.width, 0x0c);
	header.writeUInt32LE(options.height, 0x10);
	return Buffer.concat([header, options.pixels]);
}

/** The colour map of a companion file, three bytes to a colour, red first. */
function paletteFile(colours: number[][]): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 3, 0);
	for (const [index, colour] of colours.entries()) {
		palette[index * 3] = colour[0] ?? 0;
		palette[index * 3 + 1] = colour[1] ?? 0;
		palette[index * 3 + 2] = colour[2] ?? 0;
	}
	return palette;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function consume(stream: NodeJS.ReadableStream): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
	return Buffer.concat(chunks);
}

async function extract(data: Buffer, sourcePath = "cg.lsg"): Promise<Buffer> {
	const handle = await hypatiaLsgImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consume(await handle.openEntry(entry.id));
}

/** Extracts a picture that needs the files beside it, from a directory of its own. */
async function extractBeside(
	mainName: string,
	files: Record<string, Buffer | string>,
): Promise<Buffer> {
	let result: Buffer = Buffer.alloc(0);
	await withCompanionFiles(mainName, files, async (mainPath) => {
		const source = await FileByteSource.open(mainPath);
		const handle = await hypatiaLsgImageFormat.open(source, mainPath);
		try {
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			result = await consume(await handle.openEntry(entry.id));
		} finally {
			await handle.close();
		}
	});
	return result;
}

/** Runs a callback against a picture that needs the files beside it. */
async function withPictureBeside(
	mainName: string,
	files: Record<string, Buffer | string>,
	run: (open: () => Promise<NodeJS.ReadableStream>) => Promise<void>,
): Promise<void> {
	await withCompanionFiles(mainName, files, async (mainPath) => {
		const source = await FileByteSource.open(mainPath);
		const handle = await hypatiaLsgImageFormat.open(source, mainPath);
		try {
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await run(() => handle.openEntry(entry.id));
		} finally {
			await handle.close();
		}
	});
}

describe("Kogado image", () => {
	it("finds a picture of eight or twenty four bits", async () => {
		const grey = lsgFile({
			width: 2,
			height: 1,
			bitsPerPixel: 8,
			pixels: Buffer.from([1, 2]),
		});
		expect(await hypatiaLsgImageFormat.detect(sourceOf(grey))).toBe(true);
		const other = lsgFile({
			width: 2,
			height: 1,
			bitsPerPixel: 4,
			pixels: Buffer.from([1, 2]),
		});
		expect(await hypatiaLsgImageFormat.detect(sourceOf(other))).toBe(false);
	});

	it("lists the picture with the length of its pixels", async () => {
		const data = lsgFile({
			width: 4,
			height: 2,
			bitsPerPixel: 24,
			pixels: Buffer.alloc(24, 0x11),
		});
		const handle = await hypatiaLsgImageFormat.open(
			sourceOf(data),
			"dir/cg.lsg",
		);
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 2,
			bitsPerPixel: 24,
			bitmapSize: 24,
		});
	});

	it("writes a picture of twenty four bits with its rows padded", async () => {
		// A row of six bytes is padded to eight in a bitmap, which the writer behind the picture takes care of.
		const pixels: Buffer = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const out = await extract(
			lsgFile({ width: 2, height: 2, bitsPerPixel: 24, pixels }),
		);
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 54 + 16)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0]),
		);
	});

	it("hands a picture of eight bits the ramp of greys when it has no colour map", async () => {
		const out = await extract(
			lsgFile({
				width: 2,
				height: 1,
				bitsPerPixel: 8,
				pixels: Buffer.from([0x05, 0x06]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(8);
		// The ramp of greys a bitmap without a colour map is handed carries a colour and a byte behind it.
		expect(out.subarray(54 + 4 * 5, 54 + 4 * 6)).toEqual(
			Buffer.from([0x05, 0x05, 0x05, 0x00]),
		);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 2)).toEqual(
			Buffer.from([0x05, 0x06]),
		);
	});

	it("reads the colour map of a companion named after the picture", async () => {
		const out = await extractBeside("cg.lsg", {
			"cg.lsg": lsgFile({
				width: 2,
				height: 1,
				bitsPerPixel: 8,
				pixels: Buffer.from([0x05, 0x06]),
			}),
			"cg.pal": paletteFile([[0x11, 0x22, 0x33]]),
		});
		// A colour map is red, green and blue where a bitmap keeps blue, green and red.
		expect(out.subarray(54, 58)).toEqual(Buffer.from([0x33, 0x22, 0x11, 0x00]));
	});

	it("falls back to the colour map beside every other picture", async () => {
		const out = await extractBeside("cg.lsg", {
			"cg.lsg": lsgFile({
				width: 2,
				height: 1,
				bitsPerPixel: 8,
				pixels: Buffer.from([0x05, 0x06]),
			}),
			"base.pal": paletteFile([[0x44, 0x55, 0x66]]),
		});
		expect(out.subarray(54, 58)).toEqual(Buffer.from([0x66, 0x55, 0x44, 0x00]));
	});

	it("refuses a picture that is cut short of its pixels", async () => {
		const data = lsgFile({
			width: 4,
			height: 2,
			bitsPerPixel: 24,
			pixels: Buffer.alloc(6, 0x11),
		});
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses a companion that holds no whole colour map", async () => {
		await withPictureBeside(
			"cg.lsg",
			{
				"cg.lsg": lsgFile({
					width: 2,
					height: 1,
					bitsPerPixel: 8,
					pixels: Buffer.from([0x05, 0x06]),
				}),
				"cg.pal": Buffer.alloc(4, 0x11),
			},
			async (open) => {
				await expect(open()).rejects.toMatchObject({
					code: "INVALID_ARCHIVE",
				});
			},
		);
	});

	it("refuses a picture of nothing", async () => {
		const data = lsgFile({
			width: 0,
			height: 2,
			bitsPerPixel: 24,
			pixels: Buffer.alloc(4, 0x11),
		});
		await expect(extract(data)).rejects.toMatchObject({
			code: "UNSUPPORTED_FEATURE",
		});
	});
});
