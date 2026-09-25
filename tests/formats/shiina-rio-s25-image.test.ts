import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { shiinaRioS25ImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readS25Layout } from "../../packages/formats/src/shiina-rio/s25-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const FRAME_HEAD_SIZE = 0x14;

/** The walks of a row of a painting of the engine: a count of places and the kind of the walk of them. */
function group(method: number, count: number): number {
	return (method << 13) | count;
}

/** A row of places standing of one colour. */
function solid(
	blue: number,
	green: number,
	red: number,
	count: number,
	alpha?: number,
): Buffer {
	if (undefined === alpha) {
		return Buffer.from([
			group(3, count) & 0xff,
			(group(3, count) >> 8) & 0xff,
			blue,
			green,
			red,
		]);
	}
	return Buffer.from([
		group(5, count) & 0xff,
		(group(5, count) >> 8) & 0xff,
		alpha,
		blue,
		green,
		red,
	]);
}

/** A row of places standing as they stand, of three places to a place. */
function asTheyStand(places: number[][]): Buffer {
	const bytes: number[] = [
		group(2, places.length) & 0xff,
		(group(2, places.length) >> 8) & 0xff,
	];
	for (const place of places) bytes.push(...place);
	return Buffer.from(bytes);
}

/** A row of places standing as they stand, of four places to a place. */
function asTheyStandAlpha(places: number[][], method = 4): Buffer {
	const bytes: number[] = [
		group(method, places.length) & 0xff,
		(group(method, places.length) >> 8) & 0xff,
	];
	for (const place of places) bytes.push(...place);
	return Buffer.from(bytes);
}

/**
 * A picture of the engine: the head of the file, the frames of it, the places of the rows of every frame
 * and the walks of them. The rows of the frames behind the first stand of the rows of the first.
 */
function s25File(input: {
	width: number;
	height: number;
	incremental?: boolean;
	offsetX?: number;
	offsetY?: number;
	rows: Buffer[];
	/** Every row of the first frame stands of the first row of it. */
	sameRow?: boolean;
	/** Further frames, standing of the rows of the first frame, of the places of the rows of them. */
	extra?: number[][];
}): Buffer {
	const frames = 1 + (input.extra?.length ?? 0);
	const headSize = 8 + frames * 4;
	const frameAt: number[] = [];
	let at = headSize + FRAME_HEAD_SIZE + input.height * 4;
	const rowAt: number[] = [];
	for (const row of input.rows) {
		rowAt.push(at);
		// The walks of a row stand of a place of the file of an even count, of a place of their own
		// standing behind the places of the row where the count of them stands of an odd one.
		at += 2 + row.length + (row.length & 1);
	}
	const firstFrameAt = headSize;
	frameAt.push(firstFrameAt);
	for (const _extra of input.extra ?? []) {
		frameAt.push(at);
		at += FRAME_HEAD_SIZE + input.height * 4;
	}
	const head: Buffer = Buffer.alloc(headSize, 0x00);
	head.write("S25\0", 0, "latin1");
	head.writeInt32LE(frames, 4);
	for (const [index, offset] of frameAt.entries()) {
		head.writeUInt32LE(offset, 8 + index * 4);
	}

	const frameHead = (
		offsetX: number,
		offsetY: number,
		flags: number,
	): Buffer => {
		const frame: Buffer = Buffer.alloc(FRAME_HEAD_SIZE, 0x00);
		frame.writeUInt32LE(input.width, 0);
		frame.writeUInt32LE(input.height, 4);
		frame.writeInt32LE(offsetX, 8);
		frame.writeInt32LE(offsetY, 0xc);
		frame.writeUInt32LE(flags, 0x10);
		return frame;
	};
	const table = (places: number[], fallback: number): Buffer => {
		const rows: Buffer = Buffer.alloc(input.height * 4, 0x00);
		for (let index = 0; index < input.height; index += 1) {
			rows.writeUInt32LE(places[index] ?? fallback, index * 4);
		}
		return rows;
	};
	const flags = input.incremental ? 0x80000000 : 0;
	const pieces: Buffer[] = [
		head,
		frameHead(input.offsetX ?? 0, input.offsetY ?? 0, flags),
		input.sameRow
			? table([], rowAt[0] ?? 0)
			: table(
					input.rows.map((_row, index) => rowAt[index] ?? 0),
					rowAt[rowAt.length - 1] ?? 0,
				),
	];
	for (const row of input.rows) {
		const length: Buffer = Buffer.alloc(2, 0x00);
		length.writeUInt16LE(row.length + (row.length & 1), 0);
		pieces.push(length, row);
		if (0 !== (row.length & 1)) pieces.push(Buffer.alloc(1, 0x00));
	}
	for (const extra of input.extra ?? []) {
		pieces.push(
			frameHead(0, 0, flags),
			table(
				extra.map((index) => rowAt[index] ?? 0),
				rowAt[extra[extra.length - 1] ?? 0] ?? 0,
			),
		);
	}
	return Buffer.concat(pieces);
}

async function pictureOf(data: Buffer) {
	const handle = await shiinaRioS25ImageFormat.open(
		new BufferByteSource(data),
		"cg.s25",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("ShiinaRio image", () => {
	it("reads the head of the first frame of the file", () => {
		const data = s25File({
			width: 2,
			height: 1,
			offsetX: 3,
			offsetY: 4,
			rows: [solid(1, 2, 3, 2)],
		});
		expect(readS25Layout(data)).toEqual({
			width: 2,
			height: 1,
			offsetX: 3,
			offsetY: 4,
			incremental: false,
			rowsAt: 8 + 4 + FRAME_HEAD_SIZE,
		});
		const stray = Buffer.from(data.subarray(0, 8));
		stray.writeInt32LE(0x200000, 4);
		expect(readS25Layout(stray)).toBeUndefined();
		const empty = Buffer.alloc(0x40, 0x00);
		empty.write("S25\0", 0, "latin1");
		empty.writeInt32LE(1, 4);
		expect(readS25Layout(empty)).toBeUndefined();
		expect(readS25Layout(Buffer.alloc(0x10, 0x00))).toBeUndefined();
	});

	it("reads the rows of a picture standing as they stand", async () => {
		const image = await pictureOf(
			s25File({
				width: 2,
				height: 2,
				rows: [
					solid(5, 6, 7, 2),
					asTheyStandAlpha(
						[
							[1, 2, 3, 4],
							[5, 6, 7, 8],
						],
						4,
					),
				],
			}),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([
			5, 6, 7, 0xff, 5, 6, 7, 0xff, 2, 3, 4, 1, 6, 7, 8, 5,
		]);
	});

	it("reads a picture whose walks stand of the places of a colour behind them", async () => {
		// A row of two places: the first stands of no walk of its own, the second of one colour.
		const row = Buffer.concat([
			Buffer.from([group(0, 1) & 0xff, (group(0, 1) >> 8) & 0xff]),
			solid(9, 8, 7, 1, 0x80),
		]);
		const image = await pictureOf(
			s25File({ width: 2, height: 1, rows: [row] }),
		);
		expect([...image.pixels]).toEqual([0, 0, 0, 0, 9, 8, 7, 0x80]);
	});

	it("reads the rows of a picture standing of the rows before them", async () => {
		// Both rows of the picture stand of the same row of the file, which stands of two places: the
		// places of the row behind the first stand of the places of it, of the count of the rows.
		const row = asTheyStand([
			[10, 20, 30],
			[5, 6, 7],
		]);
		const image = await pictureOf(
			s25File({
				width: 2,
				height: 2,
				incremental: true,
				rows: [row],
				sameRow: true,
			}),
		);
		expect([...image.pixels]).toEqual([
			10, 20, 30, 0xff, 25, 46, 67, 0xff, 10, 20, 30, 0xff, 25, 46, 67, 0xff,
		]);
	});

	it("stands of the rows of the frames behind the frame of the picture", async () => {
		// A frame behind the frame of the picture stands of the row of it as well: the row of the picture
		// stands of the count of the frames that name it.
		const row = asTheyStand([
			[10, 20, 30],
			[5, 6, 7],
		]);
		const image = await pictureOf(
			s25File({
				width: 2,
				height: 1,
				incremental: true,
				rows: [row],
				extra: [[0]],
			}),
		);
		expect([...image.pixels]).toEqual([10, 20, 30, 0xff, 25, 46, 67, 0xff]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = s25File({ width: 2, height: 1, rows: [solid(1, 2, 3, 2)] });
		expect(
			await shiinaRioS25ImageFormat.detect?.(new BufferByteSource(data)),
		).toBe(true);
		expect(
			await shiinaRioS25ImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x20, 0x00)),
			),
		).toBe(false);
		await expect(
			shiinaRioS25ImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x20, 0x00)),
				"cg.s25",
			),
		).rejects.toThrow(GarbroError);
	});
});
