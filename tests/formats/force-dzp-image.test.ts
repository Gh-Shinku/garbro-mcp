import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { forceDzpImageFormat } from "../../packages/formats/src/force/dzp-image.js";

const HEADER_SIZE = 0x0c;

interface DzpOptions {
	/** The width of the picture in pixels; the header keeps it in blocks of four. */
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The colour map of a picture of eight bits, already four bytes to a colour. */
	palette?: Buffer;
	body: Buffer;
}

function dzpFile(options: DzpOptions): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.writeInt32LE(options.bitsPerPixel, 0);
	header.writeUInt32LE(options.width / 4, 4);
	header.writeUInt32LE(options.height / 4, 8);
	return Buffer.concat([
		header,
		options.palette ?? Buffer.alloc(0),
		options.body,
	]);
}

function paletteWith(index: number, colour: number[]): Buffer {
	const palette: Buffer = Buffer.alloc(0x400, 0);
	palette[index * 4] = colour[0] ?? 0;
	palette[index * 4 + 1] = colour[1] ?? 0;
	palette[index * 4 + 2] = colour[2] ?? 0;
	palette[index * 4 + 3] = colour[3] ?? 0;
	return palette;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.dzp"): Promise<Buffer> {
	const handle = await forceDzpImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Force image", () => {
	it("finds a picture of its own name and depth", async () => {
		const picture = dzpFile({
			width: 4,
			height: 4,
			bitsPerPixel: 24,
			body: Buffer.alloc(48, 0x11),
		});
		expect(await forceDzpImageFormat.detect(sourceOf(picture), "cg.dzp")).toBe(
			true,
		);
		// The reference reads this format from the name alone, and from one of two depths.
		expect(await forceDzpImageFormat.detect(sourceOf(picture), "cg.dat")).toBe(
			false,
		);
		const four = dzpFile({
			width: 4,
			height: 4,
			bitsPerPixel: 4,
			body: Buffer.alloc(24, 0x11),
		});
		expect(await forceDzpImageFormat.detect(sourceOf(four), "cg.dzp")).toBe(
			false,
		);
	});

	it("declines a picture of more blocks than the reference reads", async () => {
		const wide: Buffer = Buffer.alloc(0x14, 0);
		wide.writeInt32LE(24, 0);
		wide.writeUInt32LE(0x1001, 4);
		wide.writeUInt32LE(1, 8);
		expect(await forceDzpImageFormat.detect(sourceOf(wide), "cg.dzp")).toBe(
			false,
		);
	});

	it("counts the width and the height in blocks of four", async () => {
		const picture = dzpFile({
			width: 8,
			height: 4,
			bitsPerPixel: 24,
			body: Buffer.alloc(96, 0x11),
		});
		const handle = await forceDzpImageFormat.open(sourceOf(picture), "cg.dzp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 8,
			height: 4,
			bitsPerPixel: 24,
		});
	});

	it("writes a picture of twenty four bits whose pixel repeats", async () => {
		// One pixel and the count of times it is repeated, which the reference copies over itself.
		const out = await extract(
			dzpFile({
				width: 4,
				height: 4,
				bitsPerPixel: 24,
				body: Buffer.from([1, 2, 3, 15, 9, 8, 7, 1]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(24);
		const pixels = Buffer.alloc(48, 0);
		for (let i = 0; i < 15; i += 1) {
			pixels[i * 3] = 1;
			pixels[i * 3 + 1] = 2;
			pixels[i * 3 + 2] = 3;
		}
		pixels[45] = 9;
		pixels[46] = 8;
		pixels[47] = 7;
		expect(out.subarray(54, 54 + 48)).toEqual(pixels);
	});

	it("writes a pixel with nothing behind it over the one before", async () => {
		// A count of nothing does not move where the picture is being written, so such a pixel lands on the one
		// the op before it wrote and the op that follows fills the rest of the picture from it.
		const out = await extract(
			dzpFile({
				width: 4,
				height: 4,
				bitsPerPixel: 24,
				body: Buffer.from([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 15]),
			}),
		);
		const pixels: Buffer = Buffer.alloc(48, 0);
		for (let i = 0; i < 15; i += 1) {
			pixels[i * 3] = 7;
			pixels[i * 3 + 1] = 8;
			pixels[i * 3 + 2] = 9;
		}
		expect(out.subarray(54, 54 + 48)).toEqual(pixels);
	});

	it("writes a picture of eight bits with its colour map", async () => {
		const out = await extract(
			dzpFile({
				width: 4,
				height: 4,
				bitsPerPixel: 8,
				palette: paletteWith(0x11, [0x33, 0x22, 0x11, 0x00]),
				body: Buffer.from([0x11, 10, 0x22, 6]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(8);
		expect(out.subarray(54 + 0x11 * 4, 54 + 0x11 * 4 + 4)).toEqual(
			Buffer.from([0x33, 0x22, 0x11, 0x00]),
		);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 16)).toEqual(
			Buffer.from([
				0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x22, 0x22,
				0x22, 0x22, 0x22, 0x22,
			]),
		);
	});

	it("leaves the rest of the picture as it was when the stream stops", async () => {
		const out = await extract(
			dzpFile({
				width: 4,
				height: 4,
				bitsPerPixel: 8,
				palette: paletteWith(0, [1, 2, 3, 0]),
				body: Buffer.from([0x11, 4]),
			}),
		);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 16)).toEqual(
			Buffer.from([0x11, 0x11, 0x11, 0x11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
		);
	});

	it("refuses a run that reaches outside its picture", async () => {
		await expect(
			extract(
				dzpFile({
					width: 4,
					height: 4,
					bitsPerPixel: 8,
					palette: paletteWith(0, [1, 2, 3, 0]),
					body: Buffer.from([0x11, 200]),
				}),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
		await expect(
			extract(
				dzpFile({
					width: 4,
					height: 4,
					bitsPerPixel: 24,
					body: Buffer.from([1, 2, 3, 200]),
				}),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a picture of eight bits with no room for its colour map", async () => {
		await expect(
			extract(
				dzpFile({
					width: 4,
					height: 4,
					bitsPerPixel: 8,
					palette: Buffer.alloc(0x10, 0x11),
					body: Buffer.alloc(0),
				}),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
