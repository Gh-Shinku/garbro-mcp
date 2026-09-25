import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { crxImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readCrxLayout } from "../../packages/formats/src/circus/crx-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

interface CrxParts {
	width: number;
	height: number;
	/** The places of a place of the picture as the head names them: nothing, one, or a colour map. */
	depth: number;
	compression: number;
	flags?: number;
	mode?: number;
	offsetX?: number;
	offsetY?: number;
	palette?: Buffer;
	body: Buffer;
}

/** A picture of the Circus engine: its head, the colour map of it and the walks behind them. */
function crxFile(parts: CrxParts): Buffer {
	const head: Buffer = Buffer.alloc(0x14, 0x00);
	head.write("CRXG", 0, "latin1");
	head.writeInt16LE(parts.offsetX ?? 0, 4);
	head.writeInt16LE(parts.offsetY ?? 0, 6);
	head.writeUInt16LE(parts.width, 8);
	head.writeUInt16LE(parts.height, 0xa);
	head.writeUInt16LE(parts.compression, 0xc);
	head.writeUInt16LE(parts.flags ?? 0, 0xe);
	head.writeInt16LE(parts.depth, 0x10);
	head.writeUInt16LE(parts.mode ?? 0, 0x12);
	const body: Buffer[] = [head];
	if (parts.palette) body.push(parts.palette);
	body.push(parts.body);
	return Buffer.concat(body);
}

/** The walks of the engine, of places standing as they stand: one control place to eight of them. */
function walkLiterals(places: number[]): Buffer {
	const parts: Buffer[] = [];
	for (let at = 0; at < places.length; at += 8) {
		parts.push(Buffer.from([0xff]));
		parts.push(Buffer.from(places.slice(at, at + 8)));
	}
	return Buffer.concat(parts);
}

async function pictureOf(data: Buffer) {
	const handle = await crxImageFormat.open(
		new BufferByteSource(data),
		"cg.crx",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Circus image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const good = crxFile({
			width: 2,
			height: 1,
			depth: 0,
			compression: 1,
			offsetX: 3,
			offsetY: -4,
			body: walkLiterals(new Array(8).fill(0x00)),
		});
		const layout = readCrxLayout(good);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(1);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.offsetX).toBe(3);
		expect(layout?.offsetY).toBe(-4);
		expect(layout?.compression).toBe(1);
		// The places of a place of the picture stand of the head: nothing, one, or a colour map of eight
		// places; a picture of another word, of another kind of walks, and one of no places at all.
		expect(
			readCrxLayout(
				crxFile({
					width: 1,
					height: 1,
					depth: 1,
					compression: 2,
					body: Buffer.alloc(0),
				}),
			)?.bitsPerPixel,
		).toBe(32);
		expect(
			readCrxLayout(
				crxFile({
					width: 1,
					height: 1,
					depth: 0x102,
					compression: 3,
					body: Buffer.alloc(0),
				}),
			)?.bitsPerPixel,
		).toBe(8);
		const wrong = Buffer.from(good);
		wrong.write("CRXH", 0, "latin1");
		expect(readCrxLayout(wrong)).toBeUndefined();
		const kind = Buffer.from(good);
		kind.writeUInt16LE(4, 0xc);
		expect(readCrxLayout(kind)).toBeUndefined();
		const empty = Buffer.from(good);
		empty.writeUInt16LE(0, 8);
		expect(readCrxLayout(empty)).toBeUndefined();
		expect(readCrxLayout(good.subarray(0, 0x13))).toBeUndefined();
	});

	it("reads the colour map of a picture of eight places to a place", async () => {
		// The colour map stands of four places to a colour where it names more colours than a picture of one
		// place to a place stands of, and a colour standing of its own places stands of every place of it.
		const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
		for (let colour = 0; colour < 0x100; colour += 1) {
			palette[colour * 4] = colour & 0xff;
			palette[colour * 4 + 1] = 0x11;
			palette[colour * 4 + 2] = 0x22;
			palette[colour * 4 + 3] = 0x33;
		}
		palette[0] = 0xff;
		palette[1] = 0x00;
		palette[2] = 0xff;
		const image = await pictureOf(
			crxFile({
				width: 2,
				height: 1,
				depth: 0x102,
				compression: 2,
				palette,
				body: deflateSync(Buffer.from([1, 2])),
			}),
		);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.palette.subarray(0, 8)]).toEqual([
			0xff, 0xff, 0xff, 0x00, 0x22, 0x11, 0x01, 0x00,
		]);
		expect([...image.pixels]).toEqual([1, 2]);
	});

	it("hands the places of the walks of its own over, of the window behind them", async () => {
		// Two places as they stand, then a run of four places from the places two behind them: the places of
		// a run stand of the window itself, so the run repeats the places it has written.
		const walk = Buffer.from([
			0xff, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x00, 0x00, 0x02,
			0x00, 0x41, 0x42,
		]);
		const image = await pictureOf(
			crxFile({ width: 4, height: 1, depth: 0, compression: 1, body: walk }),
		);
		expect(image.bitsPerPixel).toBe(24);
		// 0x41..0x48 as they stand, then a run of four places from two places behind the walk: 0x47, 0x48,
		// and the two places the run has written of its own.
		expect([...image.pixels]).toEqual([
			0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x47, 0x48, 0x47, 0x48,
		]);
	});

	it("hands the places of a picture over, of the places of the row before it", async () => {
		// The places of a row stand of the places before them, of the places above them, of the places above
		// and to the left of them, or of the places above and to the right of them.
		const rows: Buffer[] = [];
		// The first row: the first place as it stands, then the places before it.
		rows.push(Buffer.from([0x00, 0x10, 0x20, 0x30, 0x01, 0x01, 0x01]));
		// The second row: every place of the row above it.
		rows.push(Buffer.from([0x01, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02]));
		// The third row: the places above and to the left of the row, then the place behind them.
		rows.push(Buffer.from([0x02, 0x10, 0x20, 0x30, 0x01, 0x01, 0x01]));
		// The fourth row: the places above and to the right of the row, read from the left of it.
		rows.push(Buffer.from([0x03, 0x01, 0x01, 0x01, 0x10, 0x20, 0x30]));
		const image = await pictureOf(
			crxFile({
				width: 2,
				height: 4,
				depth: 0,
				compression: 2,
				body: deflateSync(Buffer.concat(rows)),
			}),
		);
		expect([...image.pixels]).toEqual([
			0x10, 0x20, 0x30, 0x11, 0x21, 0x31, 0x12, 0x22, 0x32, 0x13, 0x23, 0x33,
			0x10, 0x20, 0x30, 0x13, 0x23, 0x33, 0x14, 0x24, 0x34, 0x10, 0x20, 0x30,
		]);
	});

	it("hands the places of a picture over, of runs of every colour of it", async () => {
		// Every colour of a row stands of runs of its own: a place, and where the place behind it stands of
		// the same colour, how many places stand of it.
		const rows: Buffer[] = [];
		rows.push(
			Buffer.from([
				0x04, 0x10, 0x10, 0x02, 0x10, 0x20, 0x20, 0x02, 0x20, 0x30, 0x30, 0x02,
				0x30,
			]),
		);
		const image = await pictureOf(
			crxFile({
				width: 4,
				height: 1,
				depth: 0,
				compression: 2,
				body: deflateSync(Buffer.concat(rows)),
			}),
		);
		expect([...image.pixels]).toEqual([
			0x10, 0x20, 0x30, 0x10, 0x20, 0x30, 0x10, 0x20, 0x30, 0x10, 0x20, 0x30,
		]);
	});

	it("stands the places of a colour of a picture of four places to a place the right way round", async () => {
		// A picture of four places to a place stands of the places of its alpha first, and of the three
		// colours behind them the other way round; the alpha stands of the kind of the picture.
		const body = deflateSync(
			Buffer.concat([
				Buffer.from([0x01]),
				Buffer.from([0x10, 0x20, 0x30, 0x40]),
			]),
		);
		const flipped = await pictureOf(
			crxFile({ width: 1, height: 1, depth: 1, compression: 2, mode: 0, body }),
		);
		expect(flipped.bitsPerPixel).toBe(32);
		expect([...flipped.pixels]).toEqual([0x20, 0x30, 0x40, 0xef]);
		const plain = await pictureOf(
			crxFile({ width: 1, height: 1, depth: 1, compression: 2, mode: 2, body }),
		);
		expect([...plain.pixels]).toEqual([0x20, 0x30, 0x40, 0x10]);
		// A picture whose kind names the places of the colours as they stand stands of them as they stand.
		const asIs = await pictureOf(
			crxFile({ width: 1, height: 1, depth: 1, compression: 2, mode: 1, body }),
		);
		expect([...asIs.pixels]).toEqual([0x10, 0x20, 0x30, 0x40]);
	});

	it("tells a picture by the word it opens with", async () => {
		const data = crxFile({
			width: 4,
			height: 1,
			depth: 0,
			compression: 1,
			body: walkLiterals(new Array(0x10).fill(0x11)),
		});
		expect(await crxImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await crxImageFormat.detect?.(
				new BufferByteSource(Buffer.from("CRXH", "latin1")),
			),
		).toBe(false);
		await expect(
			crxImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"cg.crx",
			),
		).rejects.toThrow(GarbroError);
	});
});
