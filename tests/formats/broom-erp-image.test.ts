import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { broomErpImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readErpLayout,
	type ErpLayout,
} from "../../packages/formats/src/broom/erp-image.js";
import {
	ERP_FORMAT_KEY,
	ERP_HEAD_KEY,
	ERP_READER_KEY,
} from "../../packages/formats/src/broom/erp-tables.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0x14;
const COLORS = 0x100;
const COUNT_XOR = 0xe9;
const CHANNELS: number[][] = [
	[0, 1, 2],
	[0, 2, 1],
	[1, 0, 2],
	[1, 2, 0],
	[2, 0, 1],
	[2, 1, 0],
];

/** `ErpKey` stood the other way round: the place of the key before the places of the walk of it. */
class WalkKey {
	value: number;

	constructor(
		value: number,
		private readonly step: number,
	) {
		this.value = value;
	}

	get byte(): number {
		return this.value & 0xff;
	}

	next(): void {
		this.value += this.step;
		if (this.value > 0xff) this.value -= 0xff;
	}
}

const at = (
	table: number[][][],
	row: number,
	keyIndex: number,
	id: number,
): number => table[row]?.[keyIndex]?.[id] ?? 0;

/** The four keys of the walks of the engine, of the head of a picture. */
function walkKeys(layout: ErpLayout, channel: number) {
	return {
		count: new WalkKey(
			layout.id ^ 0x68,
			at(ERP_READER_KEY, 6, layout.keyIndex, layout.id),
		),
		pixel: new WalkKey(
			at(ERP_READER_KEY, channel, layout.keyIndex, layout.id),
			at(ERP_READER_KEY, channel + 3, layout.keyIndex, layout.id),
		),
	};
}

/** The head of a picture of the engine, of the key of it. */
function erpFile(input: {
	id: number;
	method: number;
	bitsPerPixel: number;
	keyIndex: number;
	width: number;
	height: number;
	body: Buffer;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEAD_SIZE, 0x00);
	const depth =
		input.bitsPerPixel ^ at(ERP_FORMAT_KEY, 0, input.keyIndex, input.id);
	const width =
		(input.width / 4) ^ at(ERP_FORMAT_KEY, 1, input.keyIndex, input.id);
	const height =
		(input.height / 4) ^ at(ERP_FORMAT_KEY, 2, input.keyIndex, input.id);
	header[0] = input.id ^ (ERP_HEAD_KEY[0] ?? 0);
	header[1] = 0x45;
	header[2] = 0x59;
	header[3] = 0x26;
	header.writeInt32LE(depth, 4);
	header.writeUInt32LE(width >>> 0, 8);
	header.writeUInt32LE(height >>> 0, 12);
	header.writeInt32LE(input.method ^ input.id, 16);
	for (let place = 4; place < HEAD_SIZE; place += 1) {
		header[place] = (header[place] ?? 0) ^ (ERP_HEAD_KEY[place] ?? 0);
	}
	return Buffer.concat([header, input.body]);
}

/** The walks of the first kind: a run of one colour of the picture after another. */
function walkV0(
	layout: ErpLayout,
	runs: { blue: number; green: number; red: number; count: number }[],
): Buffer {
	const count = new WalkKey(
		layout.id ^ 0x68,
		at(ERP_READER_KEY, 6, layout.keyIndex, layout.id),
	);
	const keys = [0, 1, 2].map(
		(channel) =>
			new WalkKey(
				at(ERP_READER_KEY, channel, layout.keyIndex, layout.id),
				at(ERP_READER_KEY, channel + 3, layout.keyIndex, layout.id),
			),
	);
	const bytes: number[] = [];
	for (const run of runs) {
		bytes.push(
			run.blue ^ (keys[2]?.byte ?? 0),
			run.green ^ (keys[1]?.byte ?? 0),
			run.red ^ (keys[0]?.byte ?? 0),
			(run.count ^ count.byte ^ COUNT_XOR) & 0xff,
		);
		for (const key of keys) key.next();
		count.next();
	}
	return Buffer.from(bytes);
}

/** The walks of the second kind: a list of counts and then the runs of every colour of the picture. */
function walkV1(
	layout: ErpLayout,
	counts: number[],
	colors: number[][],
): Buffer {
	const countKey = new WalkKey(
		layout.id ^ 0x68,
		at(ERP_READER_KEY, 6, layout.keyIndex, layout.id),
	);
	const bytes: number[] = [];
	for (const count of counts) {
		bytes.push((count ^ countKey.byte ^ COUNT_XOR) & 0xff);
		countKey.next();
	}
	// The walks of the engine stand of no count of their own where the count of the key stands at nought.
	bytes.push((countKey.byte ^ COUNT_XOR) & 0xff);
	for (const [at2, channel] of (CHANNELS[layout.method - 1] ?? []).entries()) {
		const pixel = new WalkKey(
			at(ERP_READER_KEY, channel ?? 0, layout.keyIndex, layout.id),
			at(ERP_READER_KEY, (channel ?? 0) + 3, layout.keyIndex, layout.id),
		);
		const places = colors[at2] ?? [];
		for (let run = 0; run < counts.length; run += 1) {
			bytes.push((places[run] ?? 0) ^ pixel.byte);
			pixel.next();
		}
	}
	return Buffer.from(bytes);
}

/** The walks of the third kind: the runs of every colour of the picture behind one another. */
function walkV7(
	layout: ErpLayout,
	colors: { counts: number[]; places: number[] }[],
): Buffer {
	const bytes: number[] = [];
	for (const [at2, channel] of (CHANNELS[layout.method - 7] ?? []).entries()) {
		const keys = walkKeys(layout, channel ?? 0);
		const color = colors[at2];
		for (const [run, count] of (color?.counts ?? []).entries()) {
			bytes.push(
				(color?.places[run] ?? 0) ^ keys.pixel.byte,
				(count ^ keys.count.byte ^ COUNT_XOR) & 0xff,
			);
			keys.count.next();
			keys.pixel.next();
		}
		// The walks of the channels stand of a place and a count of their own, of the count of the key
		// standing at nought where the runs of the channel stand behind them.
		bytes.push(0, (keys.count.byte ^ COUNT_XOR) & 0xff);
	}
	return Buffer.from(bytes);
}

async function pictureOf(data: Buffer) {
	const handle = await broomErpImageFormat.open(
		new BufferByteSource(data),
		"cg.erp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("Studio B-Room image", () => {
	it("reads the head of a picture, of the first place of it", () => {
		const layout = readErpLayout(
			erpFile({
				id: 1,
				method: 0,
				bitsPerPixel: 24,
				keyIndex: 0,
				width: 8,
				height: 4,
				body: Buffer.alloc(16, 0x00),
			}),
		);
		expect(layout).toEqual({
			id: 1,
			method: 0,
			keyIndex: 0,
			bitsPerPixel: 24,
			width: 8,
			height: 4,
		});
		const eight = readErpLayout(
			erpFile({
				id: 2,
				method: 0,
				bitsPerPixel: 8,
				keyIndex: 1,
				width: 8,
				height: 8,
				body: Buffer.alloc(16, 0x00),
			}),
		);
		expect(eight?.bitsPerPixel).toBe(8);
		expect(eight?.keyIndex).toBe(1);
		// A place of the head beyond the keys of the engine, a kind of walk the engine knows none of and
		// a word of the file that stands of no picture.
		expect(
			readErpLayout(
				erpFile({
					id: 40,
					method: 0,
					bitsPerPixel: 24,
					keyIndex: 0,
					width: 8,
					height: 4,
					body: Buffer.alloc(4),
				}),
			),
		).toBeUndefined();
		expect(
			readErpLayout(
				erpFile({
					id: 1,
					method: 13,
					bitsPerPixel: 24,
					keyIndex: 0,
					width: 8,
					height: 4,
					body: Buffer.alloc(4),
				}),
			),
		).toBeUndefined();
		expect(readErpLayout(Buffer.alloc(HEAD_SIZE, 0x00))).toBeUndefined();
	});

	it("reads a picture of eight places to a place, of a run of its colours", async () => {
		const data = erpFile({
			id: 3,
			method: 0,
			bitsPerPixel: 8,
			keyIndex: 0,
			width: 8,
			height: 4,
			body: Buffer.concat([
				Buffer.alloc(COLORS * 4, 0x00),
				// Two places of the colour at 4 and then thirty of the colour at 7.
				Buffer.from([4 ^ 13, 2 ^ 9, 7 ^ 13, 30 ^ 9]),
			]),
		});
		const image = await pictureOf(data);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([4, 4, ...Array(30).fill(7)]);
	});

	it("reads a picture of a run of one colour of it after another", async () => {
		const head = erpFile({
			id: 4,
			method: 0,
			bitsPerPixel: 24,
			keyIndex: 0,
			width: 4,
			height: 4,
			body: Buffer.alloc(0),
		});
		const layout = readErpLayout(head);
		if (!layout)
			throw new Error("the head of the picture stands of no picture");
		const data = erpFile({
			id: 4,
			method: 0,
			bitsPerPixel: 24,
			keyIndex: 0,
			width: 4,
			height: 4,
			body: walkV0(layout, [{ blue: 1, green: 2, red: 3, count: 16 }]),
		});
		const image = await pictureOf(data);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual(Array(16).fill([1, 2, 3]).flat());
	});

	it("reads a picture of the runs of every colour of it", async () => {
		const head = erpFile({
			id: 5,
			method: 1,
			bitsPerPixel: 24,
			keyIndex: 0,
			width: 4,
			height: 4,
			body: Buffer.alloc(0),
		});
		const layout = readErpLayout(head);
		if (!layout)
			throw new Error("the head of the picture stands of no picture");
		// The counts stand of the places of every colour: twelve places and then four.
		const data = erpFile({
			id: 5,
			method: 1,
			bitsPerPixel: 24,
			keyIndex: 0,
			width: 4,
			height: 4,
			body: walkV1(
				layout,
				[12, 4],
				[
					[0x30, 0x40],
					[0x20, 0x30],
					[0x10, 0x20],
				],
			),
		});
		const image = await pictureOf(data);
		expect(image.bitsPerPixel).toBe(24);
		// Every run of the walks stands of the colour of its own colour of the picture, of the places of it.
		expect([...image.pixels]).toEqual([
			...Array(12).fill([0x10, 0x20, 0x30]).flat(),
			...Array(4).fill([0x20, 0x30, 0x40]).flat(),
		]);
	});

	it("reads a picture of the runs of every colour of it behind one another", async () => {
		const head = erpFile({
			id: 6,
			method: 7,
			bitsPerPixel: 24,
			keyIndex: 0,
			width: 4,
			height: 4,
			body: Buffer.alloc(0),
		});
		const layout = readErpLayout(head);
		if (!layout)
			throw new Error("the head of the picture stands of no picture");
		const data = erpFile({
			id: 6,
			method: 7,
			bitsPerPixel: 24,
			keyIndex: 0,
			width: 4,
			height: 4,
			body: walkV7(layout, [
				{ counts: [12, 4], places: [0x30, 0x40] },
				{ counts: [12, 4], places: [0x20, 0x30] },
				{ counts: [12, 4], places: [0x10, 0x20] },
			]),
		});
		const image = await pictureOf(data);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([
			...Array(12).fill([0x10, 0x20, 0x30]).flat(),
			...Array(4).fill([0x20, 0x30, 0x40]).flat(),
		]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = erpFile({
			id: 7,
			method: 0,
			bitsPerPixel: 24,
			keyIndex: 0,
			width: 4,
			height: 4,
			body: Buffer.alloc(8, 0x00),
		});
		expect(await broomErpImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await broomErpImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x11)),
			),
		).toBe(false);
		await expect(
			broomErpImageFormat.open(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x11)),
				"cg.erp",
			),
		).rejects.toThrow(GarbroError);
	});
});
