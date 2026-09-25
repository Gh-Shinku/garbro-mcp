import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { dacDgcImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readDgcLayout } from "../../packages/formats/src/dac/dgc-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const FLAG_ALPHA = 0x4000000;
const FLAG_DICT = 0x2000000;

/** A picture of the engine: the mark, the head of it and the rows of the places of it. */
function dgcFile(input: {
	width: number;
	height: number;
	flags?: number;
	body: Buffer;
}): Buffer {
	const head: Buffer = Buffer.alloc(12, 0x00);
	head.write("DGC\0", 0, "latin1");
	head.writeUInt32LE(input.flags ?? 0, 4);
	head.writeUInt16LE(input.width, 8);
	head.writeUInt16LE(input.height, 10);
	return Buffer.concat([head, input.body]);
}

/** A row of the picture: the count of the places of its walk and the walk of them. */
function row(walk: Buffer, size?: number): Buffer {
	const head: Buffer = Buffer.alloc(2, 0x00);
	head.writeInt16LE(size ?? walk.length, 0);
	return Buffer.concat([head, walk]);
}

/** A walk of a row of the places of the file itself: `count` places as they stand. */
function literal(places: number[][]): Buffer {
	const bytes: number[] = [];
	const control: Buffer = Buffer.alloc(2, 0x00);
	control.writeInt16LE(places.length, 0);
	bytes.push(...control);
	for (const place of places) bytes.push(...place);
	return Buffer.from(bytes);
}

/** A walk of a row standing of the places before it: a place as it stands and then two of them. */
function withBackReference(place: number[]): Buffer {
	const bytes: number[] = [0x01, 0x00, ...place, 0xc1, 0xff];
	return Buffer.from(bytes);
}

async function pictureOf(data: Buffer) {
	const handle = await dacDgcImageFormat.open(
		new BufferByteSource(data),
		"cg.dgc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("DAC engine image", () => {
	it("reads the head of a picture", () => {
		const layout = readDgcLayout(
			dgcFile({ width: 4, height: 2, body: Buffer.alloc(4) }),
		);
		expect(layout).toEqual({
			flags: 0,
			width: 4,
			height: 2,
			hasAlpha: false,
			useDictionary: false,
			maxDictionarySize: 0,
		});
		const withAlpha = readDgcLayout(
			dgcFile({
				width: 4,
				height: 2,
				flags: FLAG_ALPHA | FLAG_DICT | 0x120,
				body: Buffer.alloc(4),
			}),
		);
		expect(withAlpha?.hasAlpha).toBe(true);
		expect(withAlpha?.useDictionary).toBe(true);
		expect(withAlpha?.maxDictionarySize).toBe(0x120);
		expect(
			readDgcLayout(
				dgcFile({
					width: 0x80000000 & 0xffff,
					height: 2,
					body: Buffer.alloc(4),
				}),
			),
		).toBeUndefined();
		expect(readDgcLayout(Buffer.alloc(12, 0x00))).toBeUndefined();
	});

	it("reads the rows of a picture of the walks of the file itself", async () => {
		const body = Buffer.concat([
			row(
				literal([
					[1, 2, 3],
					[4, 5, 6],
				]),
			),
			// The second row stands of the row before it.
			row(Buffer.alloc(0), -1),
		]);
		const image = await pictureOf(dgcFile({ width: 2, height: 2, body }));
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6]);
	});

	it("reads a walk of a row standing of the places before it", async () => {
		const body = Buffer.concat([row(withBackReference([7, 8, 9]))]);
		const image = await pictureOf(dgcFile({ width: 3, height: 1, body }));
		expect([...image.pixels]).toEqual([7, 8, 9, 7, 8, 9, 7, 8, 9]);
	});

	it("reads a picture of a small colour table", async () => {
		// The colour table stands behind the head, of three colours, and the rows of the picture stand of
		// a place of one colour and then of the places of the colours of the table.
		const body = Buffer.concat([
			Buffer.from([2]),
			Buffer.from([10, 11, 12, 20, 21, 22, 30, 31, 32]),
			row(Buffer.from([2, 1, 0, 0, 0, 2])),
		]);
		const image = await pictureOf(
			dgcFile({ width: 4, height: 1, flags: FLAG_DICT | 3, body }),
		);
		expect([...image.pixels]).toEqual([
			20, 21, 22, 20, 21, 22, 10, 11, 12, 30, 31, 32,
		]);
	});

	it("reads a picture of a colour table of its own", async () => {
		// The colour table of a picture of more than 256 colours stands of a count of two places and of
		// the rows of the group behind them; the places of the table stand of words.
		const dictionary = Buffer.alloc(257 * 3, 0x00);
		dictionary[6] = 30;
		dictionary[7] = 31;
		dictionary[8] = 32;
		const body = Buffer.concat([
			Buffer.from([0x00, 0x01]),
			dictionary,
			Buffer.from([2, 0]),
			row(Buffer.from([0x01, 0x40, 2, 0])),
			row(Buffer.from([2, 0]), 0),
		]);
		const image = await pictureOf(
			dgcFile({ width: 1, height: 2, flags: FLAG_DICT | 0x120, body }),
		);
		expect([...image.pixels]).toEqual([30, 31, 32, 30, 31, 32]);
	});

	it("reads the alpha behind the places of a picture", async () => {
		const body = Buffer.concat([
			row(literal([[1, 2, 3]])),
			row(literal([[4, 5, 6]])),
			// The alpha of the first row stands of one place, of the places of the second as they stand.
			row(Buffer.from([1, 0x80])),
			row(Buffer.alloc(0), 0),
			Buffer.from([0x40]),
		]);
		const image = await pictureOf(
			dgcFile({ width: 1, height: 2, flags: FLAG_ALPHA, body }),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([1, 2, 3, 0x80, 4, 5, 6, 0x40]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = dgcFile({
			width: 2,
			height: 1,
			body: row(literal([[1, 2, 3]])),
		});
		expect(await dacDgcImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await dacDgcImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(12, 0x00)),
			),
		).toBe(false);
		await expect(
			dacDgcImageFormat.open(
				new BufferByteSource(Buffer.alloc(12, 0x00)),
				"cg.dgc",
			),
		).rejects.toThrow(GarbroError);
	});
});
