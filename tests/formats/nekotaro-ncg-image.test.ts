import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	ncgImageFormat,
	readNcgLayout,
	readNcgPalette,
	unpackNcg,
} from "../../packages/formats/src/nekotaro/ncg-image.js";

const HEAD_SIZE = 4;
const PALETTE_BYTES = 16 * 3;

/** A picture of this engine: the head, the colour map behind it, and the walks of its blocks. */
function buildNcg(options: {
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	tail: readonly number[];
}): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head[0] = (options.offsetX ?? 0) / 8;
	head[1] = (options.offsetY ?? 0) / 2;
	head[2] = options.width / 8;
	head[3] = options.height / 2;
	return Buffer.concat([
		head,
		Buffer.alloc(PALETTE_BYTES, 0x00),
		Buffer.from(options.tail),
	]);
}

/** The four bytes that set every place of a pattern, and the four that set none of them. */
const ALL = [0xff, 0xff, 0xff, 0xff];
const NONE = [0x00, 0x00, 0x00, 0x00];
/** The first part of a picture is closed by 0xff, and the second as well. */
const END = 0xff;

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await ncgImageFormat.open(
		new BufferByteSource(data),
		"picture.ncg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Nekotaro Game System image", () => {
	it("reads the head, whose every value stands in its own unit", () => {
		const data = buildNcg({
			width: 16,
			height: 4,
			offsetX: 8,
			offsetY: 6,
			tail: [],
		});
		expect(readNcgLayout(data)).toEqual({
			width: 16,
			height: 4,
			offsetX: 8,
			offsetY: 6,
		});
		// A picture that would reach past the screen it was drawn for is turned away.
		const tooWide = buildNcg({ width: 648, height: 4, offsetX: 8, tail: [] });
		expect(readNcgLayout(tooWide)).toBeUndefined();
		expect(readNcgLayout(data.subarray(0, 8))).toBeUndefined();
	});

	it("draws one block of the first part, of eight pixels by two", () => {
		const data = buildNcg({
			width: 8,
			height: 2,
			tail: [...ALL, ...NONE, 0xc0, 0x00, END, ...NONE, END],
		});
		const layout = readNcgLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = unpackNcg(data, layout);
		// The pattern of the first row is written four times over, one bit to a walk, and the second row
		// stands as it was read: nothing.
		expect([...pixels]).toEqual([
			0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0,
		]);
	});

	it("draws a block below another, down the grid of the screen", () => {
		const data = buildNcg({
			width: 8,
			height: 4,
			tail: [...ALL, ...NONE, 0x80, 0x00, 0x02, END, ...NONE, END],
		});
		const layout = readNcgLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = unpackNcg(data, layout);
		// The block behind the first stands a whole row below it, which the reference reaches by stepping two
		// rows and then back by the width of a block - so the second block's top row falls on the row the first
		// block drew its own bottom into, and the last row of the picture is left as nothing.
		expect([...pixels]).toEqual([
			0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f,
			0x0f, 0x0f, 0x0f, 0x0f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
		]);
	});

	it("fills whatever block no part of the picture drew, reading its pattern as it goes", () => {
		// Neither part of the picture draws anything, so the third walk fills both blocks of the picture.
		const data = buildNcg({
			width: 8,
			height: 2,
			tail: [...ALL, ...NONE, END, ...NONE, END, ...ALL, ...NONE],
		});
		const layout = readNcgLayout(data);
		if (!layout) throw new Error("no layout");
		const pixels = unpackNcg(data, layout);
		expect([...pixels]).toEqual([
			0x0f, 0x0f, 0x0f, 0x0f, 0, 0, 0, 0, 0x0f, 0x0f, 0x0f, 0x0f, 0, 0, 0, 0,
		]);
	});

	it("keys the colour map of the picture with the name of its engine", () => {
		// A colour map of nothing at all, keyed byte by byte with the name of the engine - the bytes of that
		// name taken in the order blue, red, green - and then spread from the four bits it stands for over the
		// whole byte. The first colour is worked out here by hand.
		const data = buildNcg({ width: 8, height: 2, tail: [] });
		const palette = readNcgPalette(data);
		expect([...palette.subarray(0, 4)]).toEqual([0xc1, 0xf4, 0x5a, 0x00]);
		// The rest of the map against the same arithmetic written out again: the key runs on across the colours,
		// and every colour hands its three channels over in the order blue, green, red.
		const key = Buffer.from("NEKOTARO", "latin1");
		let at = 0;
		for (let colour = 0; colour < 16; colour += 1) {
			const keyed: number[] = [];
			for (let channel = 0; channel < 3; channel += 1) {
				keyed.push(((~0 & 0xff) - (key[at++ & 7] ?? 0)) & 0xff);
			}
			expect([...palette.subarray(colour * 4, colour * 4 + 4)]).toEqual([
				((keyed[0] ?? 0) * 0x11) & 0xff,
				((keyed[2] ?? 0) * 0x11) & 0xff,
				((keyed[1] ?? 0) * 0x11) & 0xff,
				0x00,
			]);
		}
	});

	it("hands the picture over as a bitmap, and turns away one that ends inside itself", async () => {
		const data = buildNcg({
			width: 8,
			height: 2,
			tail: [...ALL, ...NONE, 0xc0, 0x00, END, ...NONE, END],
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(8);
		expect([...bmp.pixels.subarray(0, 8)]).toEqual([
			0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f, 0x0f,
		]);
		const handle = await ncgImageFormat.open(
			new BufferByteSource(data),
			"picture.ncg",
		);
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 8,
			height: 2,
			bitsPerPixel: 4,
		});

		const short = buildNcg({ width: 8, height: 2, tail: [0xc0] });
		await expect(extract(short)).rejects.toThrow(GarbroError);
	});

	it("tells a picture by the shape of its head alone", async () => {
		const data = buildNcg({
			width: 8,
			height: 2,
			tail: [...ALL, ...NONE, 0xc0, 0x00, END, ...NONE, END],
		});
		expect(
			await ncgImageFormat.detect(new BufferByteSource(data), "a.ncg"),
		).toBe(true);
		// A head whose picture would reach past the screen is not one of these.
		const elsewhere = buildNcg({ width: 640, height: 2, offsetX: 8, tail: [] });
		expect(
			await ncgImageFormat.detect(new BufferByteSource(elsewhere), "a.ncg"),
		).toBe(false);
	});
});
