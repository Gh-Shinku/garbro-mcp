import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	criXtxImageFormat,
	readXtxLayout,
	tiledColumn,
	tiledRow,
	unpackXtx,
} from "../../packages/formats/src/cri/xtx-image.js";

/** A texture: the head and then the pixels. */
function xtxFile(input: {
	width: number;
	height: number;
	alignedWidth: number;
	alignedHeight: number;
	kind?: number;
	body: Buffer;
	headerSize?: number;
	mark?: boolean;
	offsetX?: number;
	offsetY?: number;
}): Buffer {
	const head = Buffer.alloc(0x20, 0x00);
	if (input.mark ?? true) Buffer.from([0x78, 0x74, 0x78, 0x00]).copy(head, 0);
	head.writeUInt8(input.kind ?? 0, 4);
	head.writeInt32BE(input.alignedWidth, 8);
	head.writeInt32BE(input.alignedHeight, 0xc);
	head.writeUInt32BE(input.width, 0x10);
	head.writeUInt32BE(input.height, 0x14);
	head.writeInt32BE(input.offsetX ?? 0, 0x18);
	head.writeInt32BE(input.offsetY ?? 0, 0x1c);
	if (input.headerSize === undefined) return Buffer.concat([head, input.body]);
	const size = Buffer.alloc(4, 0x00);
	size.writeUInt32LE(input.headerSize, 0);
	const padding = Buffer.alloc(input.headerSize - 4, 0x00);
	return Buffer.concat([size, padding, head, input.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await criXtxImageFormat.open(
		new BufferByteSource(data),
		"tex.xtx",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The four bytes of a pixel of the bitmap the picture is written to. */
function pixel(pixels: Buffer, width: number, x: number, y: number): Buffer {
	const at = (y * width + x) * 4;
	return pixels.subarray(at, at + 4);
}

describe("Xbox 360 texture", () => {
	it("reads the head as the reference does", () => {
		const data = xtxFile({
			width: 32,
			height: 32,
			alignedWidth: 32,
			alignedHeight: 32,
			body: Buffer.alloc(0, 0x00),
		});
		expect(readXtxLayout(data)).toMatchObject({
			width: 32,
			height: 32,
			kind: 0,
			alignedWidth: 32,
			alignedHeight: 32,
			bitsPerPixel: 32,
			dataOffset: 0x20,
		});
	});

	it("reads a head that stands behind a size of its own", async () => {
		const data = xtxFile({
			width: 32,
			height: 32,
			alignedWidth: 32,
			alignedHeight: 32,
			headerSize: 0x40,
			body: Buffer.alloc(0, 0x00),
		});
		expect(readXtxLayout(data)).toMatchObject({ dataOffset: 0x60 });
		// A file whose head stands behind a size of its own carries no word at all in front of it, so what
		// finds it is the extension the format registers beside the word.
		expect(await criXtxImageFormat.detect(new BufferByteSource(data))).toBe(
			true,
		);
	});

	it("gates on the marks, the kind and the sizes", () => {
		const good = xtxFile({
			width: 32,
			height: 32,
			alignedWidth: 32,
			alignedHeight: 32,
			body: Buffer.alloc(0, 0x00),
		});
		expect(readXtxLayout(good)).toBeDefined();
		// The kind of tiling stands two or less.
		expect(
			readXtxLayout(
				xtxFile({
					width: 32,
					height: 32,
					alignedWidth: 32,
					alignedHeight: 32,
					kind: 3,
					body: Buffer.alloc(0, 0x00),
				}),
			),
		).toBeUndefined();
		// A size of its own past what a head of another kind would give.
		const other = Buffer.alloc(0x40, 0x00);
		other.writeUInt32LE(0x2000, 0);
		expect(readXtxLayout(other)).toBeUndefined();
		expect(
			readXtxLayout(
				xtxFile({
					width: 32,
					height: 32,
					alignedWidth: 0,
					alignedHeight: 32,
					body: Buffer.alloc(0, 0x00),
				}),
			),
		).toBeUndefined();
	});

	it("walks the tiling of the pixels as the reference does", () => {
		// The first sixteen places of a tiling of pixels, worked out from the reference's own two walks.
		const places: Array<[number, number, number]> = [
			[0, 0, 0],
			[1, 1, 0],
			[2, 2, 0],
			[3, 3, 0],
			[4, 0, 1],
			[5, 1, 1],
			[6, 2, 1],
			[7, 3, 1],
			[8, 4, 0],
			[9, 5, 0],
			[10, 6, 0],
			[11, 7, 0],
			[12, 4, 1],
			[13, 5, 1],
			[14, 6, 1],
			[15, 7, 1],
		];
		for (const [at, x, y] of places) {
			expect([tiledColumn(at, 32, 4), tiledRow(at, 32, 4)]).toEqual([x, y]);
		}
		// Every place of a tiling of thirty two by thirty two pixels stands once and only once.
		const seen = new Set<string>();
		for (let at = 0; at < 32 * 32; at += 1) {
			seen.add(`${tiledColumn(at, 32, 4)},${tiledRow(at, 32, 4)}`);
		}
		expect(seen.size).toBe(32 * 32);
		// The tiling of the blocks of the fifth kind puts the first block of a column first.
		expect([tiledColumn(0, 8, 0x10), tiledRow(0, 8, 0x10)]).toEqual([0, 0]);
		expect([tiledColumn(1, 8, 0x10), tiledRow(1, 8, 0x10)]).toEqual([0, 1]);
		expect([tiledColumn(2, 8, 0x10), tiledRow(2, 8, 0x10)]).toEqual([1, 0]);
		expect([tiledColumn(3, 8, 0x10), tiledRow(3, 8, 0x10)]).toEqual([1, 1]);
	});

	it("reads the pixels of the first kind of tiling turned back to front", async () => {
		// Thirty two by thirty two pixels, every one of them the place it stands at over two bytes and the
		// whole for the fourth.
		const texture = Buffer.alloc(32 * 32 * 4, 0x00);
		for (let at = 0; at < 32 * 32; at += 1) {
			texture[at * 4] = 0xff;
			texture[at * 4 + 1] = at & 0xff;
			texture[at * 4 + 2] = (at >> 8) & 0xff;
			texture[at * 4 + 3] = 0x00;
		}
		const data = xtxFile({
			width: 32,
			height: 32,
			alignedWidth: 32,
			alignedHeight: 32,
			body: texture,
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-32);
		const pixels = out.subarray(0x36);
		const places: Array<[number, number, number]> = [
			[0, 0, 0],
			[4, 0, 1],
			[8, 4, 0],
			[12, 4, 1],
			[15, 7, 1],
		];
		for (const [at, x, y] of places) {
			// What stands at the place is the whole, the two bytes of the place read back to front and the
			// whole again.
			expect(pixel(pixels, 32, x, y).toString("hex")).toBe(
				`00${((at >> 8) & 0xff).toString(16).padStart(2, "0")}${(at & 0xff).toString(16).padStart(2, "0")}ff`,
			);
		}
	});

	it("reads a block of the fifth kind of tiling with its words turned around", async () => {
		// One block of four by four pixels, standing at the whole of white and the whole of alpha.
		const block = Buffer.alloc(16, 0x00);
		block[0] = 0xff;
		block[1] = 0x00;
		block.writeUInt16LE(0xffff, 8);
		block.writeUInt16LE(0x0000, 10);
		block.writeUInt32LE(0x00000000, 12);
		// Every word of two bytes of it stands turned around in the file.
		const texture = Buffer.from(block);
		for (let at = 0; at < texture.length; at += 2) {
			const first = texture[at] ?? 0;
			texture[at] = texture[at + 1] ?? 0;
			texture[at + 1] = first;
		}
		const data = xtxFile({
			width: 4,
			height: 4,
			alignedWidth: 4,
			alignedHeight: 4,
			kind: 2,
			body: texture,
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		for (let at = 0; at < 16; at += 1) {
			expect(
				pixel(out.subarray(0x36), 4, at % 4, Math.floor(at / 4)).toString(
					"hex",
				),
			).toBe("ffffffff");
		}
	});

	it("turns a texture of the second kind of tiling away", async () => {
		const data = xtxFile({
			width: 4,
			height: 4,
			alignedWidth: 4,
			alignedHeight: 4,
			kind: 1,
			body: Buffer.alloc(32, 0x00),
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Xbox 360 texture of the second kind of tiling not supported",
		);
	});

	it("turns a texture cut short of its pixels away", () => {
		const data = xtxFile({
			width: 32,
			height: 32,
			alignedWidth: 32,
			alignedHeight: 32,
			body: Buffer.alloc(16, 0x00),
		});
		const layout = readXtxLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackXtx(data, layout)).toThrow(
			"Xbox 360 texture is cut short of its pixels",
		);
	});

	it("declines a file that does not hold a texture", async () => {
		const data = xtxFile({
			width: 32,
			height: 32,
			alignedWidth: 32,
			alignedHeight: 32,
			body: Buffer.alloc(16, 0x00),
		});
		data.write("txt\0", 0, "latin1");
		await expect(
			criXtxImageFormat.open(new BufferByteSource(data), "tex.xtx"),
		).rejects.toThrow(GarbroError);
		await expect(
			criXtxImageFormat.open(new BufferByteSource(data), "tex.xtx"),
		).rejects.toThrow("Not an Xbox 360 texture");
	});
});
