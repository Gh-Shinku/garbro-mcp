import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { fc01McgImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { MrgDecoder } from "../../packages/formats/src/fc01/mrg-decoder.js";
import { readFc01McgLayout } from "../../packages/formats/src/fc01/mcg-image.js";

/** The walk of the places of the file of one plane of the engine: one cell of the counts of the table. */
function planeBlock(cell: number): Buffer {
	const counts: Buffer = Buffer.alloc(0x100, 0x00);
	counts[cell] = 0xff;
	return Buffer.concat([
		counts,
		Buffer.alloc(4, 0x00),
		Buffer.alloc(0x400, 0x00),
	]);
}

/**
 * The walks of the places of the file of the three planes of a picture one behind another: every walk
 * stands of the place of the file the walk before it ends at, of the count of the places of the picture
 * of the walk of it.
 */
function mcgWalks(cells: number[], count: number): Buffer {
	let payload: Buffer = Buffer.alloc(0, 0x00);
	for (let plane = 0; plane < cells.length; plane += 1) {
		payload = Buffer.concat([payload, planeBlock(cells[plane] ?? 0)]);
		const decoder = new MrgDecoder(payload, 0, count);
		let at = payload.length;
		for (let place = 0; place <= plane; place += 1) {
			decoder.unpack();
			at = decoder.cursor;
		}
		payload = Buffer.from(payload.subarray(0, at));
	}
	return payload;
}

/** A picture of the engine of the places of the file of the walk of the words of it. */
function mcgFile(input: {
	version: string;
	width: number;
	height: number;
	bpp: number;
	channels: number;
	planes: number[];
	masks?: Buffer;
}): Buffer {
	const head: Buffer = Buffer.alloc(0x40, 0x00);
	head.write(input.version, 0, "latin1");
	head.writeInt32LE(0x40, 0x10);
	head.writeInt32LE(0, 0x14);
	head.writeInt32LE(0, 0x18);
	head.writeUInt32LE(input.width, 0x1c);
	head.writeUInt32LE(input.height, 0x20);
	head.writeInt32LE(input.bpp, 0x24);
	head.writeInt32LE(input.channels, 0x34);
	head.writeInt32LE(0, 0x38);
	const count = input.width * input.height;
	const walk = mcgWalks(input.planes, count);
	return Buffer.concat([head, input.masks ?? Buffer.alloc(0), walk]);
}

async function bytesOf(data: Buffer): Promise<Buffer> {
	const handle = await fc01McgImageFormat.open(
		new BufferByteSource(data),
		"image.mcg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/**
 * The places of the colours of a picture of the bitmap of the engine, of the rows of it the display the
 * first: every row of the places of the file stands of four places of the file four places over.
 */
function rowsOf(bytes: Buffer, width: number, height: number): number[] {
	const stride = (width * 3 + 3) & ~3;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let at = 0; at < width * 3; at += 1) {
			out.push(bytes[0x36 + row * stride + at] ?? 0);
		}
	}
	return out;
}

/** The places of a picture of two rows of two places of the file, of the three places of a place. */
const PLANES = [0x10, 0x20, 0x30];

/**
 * The places of the picture of the engine behind the walks of the places of the file of it, of the places
 * of the file of the picture the other way round: the blue, the green and the red of a place of it. The
 * walk of the places of the rows of the picture stands of one place of the display behind the place of it:
 * of a picture of two rows, the places of the row of the display the first stand of the places of the file
 * of them, and the places of the row behind them stand of the places behind them of the count of the walk.
 */
const EXPECTED = [
	0xdc, 0x3c, 0xec, 0xdc, 0x3c, 0xec, 0xdc, 0x3c, 0xec, 0xb8, 0x78, 0xd8,
];

describe("F&C MCG image", () => {
	it("reads the head of a picture of the engine", () => {
		const layout = readFc01McgLayout(
			mcgFile({
				version: "MCG 2.00",
				width: 2,
				height: 2,
				bpp: 24,
				channels: 0,
				planes: PLANES,
			}),
		);
		expect(layout).toMatchObject({
			version: 200,
			width: 2,
			height: 2,
			offsetX: 0,
			offsetY: 0,
			bitsPerPixel: 24,
			channelsCount: 0,
			dataOffset: 0x40,
			packedSize: 0,
		});
		// A picture of no mark of the engine and one of a version the engine knows none of.
		expect(
			readFc01McgLayout(
				mcgFile({
					version: "MCG 9.00",
					width: 2,
					height: 2,
					bpp: 24,
					channels: 0,
					planes: PLANES,
				}),
			),
		).toBeUndefined();
		expect(readFc01McgLayout(Buffer.alloc(0x40, 0x00))).toBeUndefined();
	});

	it("reads the places of a picture of the walks of the words of it", async () => {
		const data = mcgFile({
			version: "MCG 2.00",
			width: 2,
			height: 2,
			bpp: 24,
			channels: 0,
			planes: PLANES,
		});
		const bytes = await bytesOf(data);
		expect(rowsOf(bytes, 2, 2)).toEqual(EXPECTED);
	});

	it("reads the places of a picture of the masks of the channels of it", async () => {
		// The masks of the channels of the picture stand behind the places of the head of it.
		const data = mcgFile({
			version: "MCG 2.00",
			width: 2,
			height: 2,
			bpp: 24,
			channels: 3,
			planes: PLANES,
			masks: Buffer.alloc(12, 0x00),
		});
		const bytes = await bytesOf(data);
		expect(rowsOf(bytes, 2, 2)).toEqual(EXPECTED);
	});

	it("reads the head of a picture of the engine of a version behind 2.00", () => {
		const layout = readFc01McgLayout(
			mcgFile({
				version: "MCG 1.01",
				width: 2,
				height: 2,
				bpp: 24,
				channels: 0,
				planes: PLANES,
			}),
		);
		expect(layout?.version).toBe(101);
	});

	it("stands of the places of the file of a picture of a version behind 2.00", async () => {
		// The places of the file of a picture of a version behind 2.00 stand of the password of the
		// picture, of the medium of the engine.
		const data = mcgFile({
			version: "MCG 1.01",
			width: 2,
			height: 2,
			bpp: 24,
			channels: 0,
			planes: PLANES,
		});
		await expect(bytesOf(data)).rejects.toThrow(GarbroError);
	});

	it("stands of the places of the file of a picture of eight places to a place", async () => {
		const data = mcgFile({
			version: "MCG 2.00",
			width: 2,
			height: 2,
			bpp: 8,
			channels: 0,
			planes: PLANES,
		});
		await expect(bytesOf(data)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = mcgFile({
			version: "MCG 2.00",
			width: 2,
			height: 2,
			bpp: 24,
			channels: 0,
			planes: PLANES,
		});
		expect(await fc01McgImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await fc01McgImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
			),
		).toBe(false);
		await expect(
			fc01McgImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"image.mcg",
			),
		).rejects.toThrow(GarbroError);
	});
});
