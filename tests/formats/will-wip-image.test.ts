import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readBmpImage,
	writeBmp8Palette,
} from "../../packages/formats/src/shared/bmp.js";
import {
	readWipLayout,
	unpackWipRun,
	willWipImageFormat,
} from "../../packages/formats/src/will/wip-image.js";

const RECORDS_BASE = 8;
const RECORD_SIZE = 0x18;

/** A picture of this engine: the head, the records of the frames behind it, then the run of the frame. */
function buildWip(options: {
	bits: number;
	width: number;
	height: number;
	frames: number;
	run: Buffer;
	palette?: Buffer;
}): Buffer {
	const recordsEnd = RECORDS_BASE + RECORD_SIZE * options.frames;
	const head = Buffer.alloc(recordsEnd, 0x00);
	head.write("WIPF", 0, "latin1");
	head.writeUInt16LE(options.frames, 4);
	head.writeUInt16LE(options.bits, 6);
	head.writeUInt32LE(options.width, 8);
	head.writeUInt32LE(options.height, 0x0c);
	head.writeInt32LE(0x10, 0x10);
	head.writeInt32LE(0x20, 0x14);
	head.writeUInt32LE(options.run.length, 0x1c);
	const parts: Buffer[] = [head];
	if (options.palette) parts.push(options.palette);
	parts.push(options.run);
	return Buffer.concat(parts);
}

/** A run whose every decision stands for a byte of its own: eight decisions to a control byte. */
function literalRun(values: readonly number[]): Buffer {
	const out: number[] = [];
	for (let at = 0; at < values.length; at += 8) {
		out.push(0xff);
		for (const value of values.slice(at, at + 8)) out.push(value);
	}
	return Buffer.from(out);
}

/** A colour map as the file stores it, three bytes to a colour. */
function buildPalette(colours: readonly [number, number, number][]): Buffer {
	const palette = Buffer.alloc(0x300, 0x00);
	for (const [index, colour] of colours.entries()) {
		palette[index * 3] = colour[0];
		palette[index * 3 + 1] = colour[1];
		palette[index * 3 + 2] = colour[2];
	}
	return palette;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await willWipImageFormat.open(
		new BufferByteSource(data),
		"picture.wip",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Will Co. image", () => {
	it("draws the three planes of a picture of twenty four bits together", async () => {
		const planes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
		const run = literalRun(planes);
		const data = buildWip({
			bits: 24,
			width: 2,
			height: 2,
			frames: 1,
			run,
		});
		expect(readWipLayout(data)).toMatchObject({
			frames: 1,
			bitsPerPixel: 24,
			width: 2,
			height: 2,
			offsetX: 0x10,
			offsetY: 0x20,
			frameSize: run.length,
			dataOffset: RECORDS_BASE + RECORD_SIZE,
			paletteOffset: undefined,
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(24);
		// The first plane is the blue of every pixel, the second the green and the third the red.
		expect([...bmp.pixels]).toEqual([1, 5, 9, 2, 6, 10, 3, 7, 11, 4, 8, 12]);
	});

	it("copies out of the window it fills as it goes", () => {
		// A byte of its own, which lands in the window's first place, then a copy of two out of that place:
		// the copy reads the byte it wrote itself as it runs on, so one literal becomes three bytes, and the
		// rest of the picture stays nothing.
		const run = Buffer.from([0x01, 0x41, 0x00, 0x10]);
		const raw = unpackWipRun(run, 0, run.length, 8);
		expect([...raw]).toEqual([0x41, 0x41, 0x41, 0x00, 0x00, 0x00, 0x00, 0x00]);
	});

	it("carries the colour map of a picture of eight bits into the bitmap", async () => {
		const data = buildWip({
			bits: 8,
			width: 2,
			height: 1,
			frames: 1,
			run: literalRun([0, 1]),
			palette: buildPalette([
				[0x01, 0x02, 0x03],
				[0x11, 0x22, 0x33],
			]),
		});
		const layout = readWipLayout(data);
		expect(layout?.paletteOffset).toBe(RECORDS_BASE + RECORD_SIZE);
		expect(layout?.dataOffset).toBe(RECORDS_BASE + RECORD_SIZE + 0x300);
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(8);
		expect([...bmp.pixels.subarray(0, 2)]).toEqual([0, 1]);
		// The colour the file stores red first reaches the bitmap blue first, as a bitmap keeps it.
		expect([...bmp.palette.subarray(4, 8)]).toEqual([0x33, 0x22, 0x11, 0x00]);
	});

	it("finds the run behind the records of every frame", async () => {
		const run = literalRun([1, 2, 3, 4, 5, 6]);
		const data = buildWip({ bits: 24, width: 1, height: 1, frames: 2, run });
		const layout = readWipLayout(data);
		expect(layout?.dataOffset).toBe(RECORDS_BASE + RECORD_SIZE * 2);
		expect(layout?.frames).toBe(2);
		const handle = await willWipImageFormat.open(
			new BufferByteSource(data),
			"picture.wip",
		);
		expect(handle.metadata).toMatchObject({ frameCount: 2, image: "bmp" });
	});

	it("turns away a picture of a depth it does not store, and one that ends short", async () => {
		const sixteen = buildWip({
			bits: 16,
			width: 2,
			height: 2,
			frames: 1,
			run: literalRun([1, 2, 3, 4]),
		});
		expect(readWipLayout(sixteen)).toBeUndefined();
		expect(
			await willWipImageFormat.detect(new BufferByteSource(sixteen), "a.wip"),
		).toBe(false);

		// A control byte alone, which asks for a copy of two bytes that the run does not hold.
		const short = buildWip({
			bits: 24,
			width: 8,
			height: 8,
			frames: 1,
			run: Buffer.from([0x00]),
		});
		await expect(extract(short)).rejects.toThrow(GarbroError);
	});

	it("reads the size and the place of a picture's own head", async () => {
		const run = literalRun([0, 0, 0, 0]);
		const data = buildWip({
			bits: 8,
			width: 1,
			height: 1,
			frames: 1,
			run,
			palette: buildPalette([[0x01, 0x02, 0x03]]),
		});
		await expect(
			willWipImageFormat.open(
				new BufferByteSource(data.subarray(0, 4)),
				"a.wip",
			),
		).rejects.toThrow(GarbroError);
		const handle = await willWipImageFormat.open(
			new BufferByteSource(data),
			"picture.wip",
		);
		expect(handle.entries[0]).toMatchObject({
			path: "picture.bmp",
			size: BigInt(data.length),
		});
		expect(handle.metadata).toMatchObject({
			width: 1,
			height: 1,
			bitsPerPixel: 8,
			offsetX: 0x10,
			offsetY: 0x20,
		});
	});

	it("keeps the bitmap writer of the project in step with the palette it is handed", () => {
		// A picture of eight bits is written through the project's own palette writer, so a change there
		// would show up as a bitmap that no longer carries the colour map of the file.
		const palette = Buffer.alloc(0x400, 0x00);
		palette[0] = 0x10;
		palette[1] = 0x20;
		palette[2] = 0x30;
		const bmp = writeBmp8Palette(1, 1, Buffer.from([0]), palette);
		const read = readBmpImage(bmp);
		expect([...(read?.palette.subarray(0, 4) ?? [])]).toEqual([
			0x10, 0x20, 0x30, 0x00,
		]);
	});
});
