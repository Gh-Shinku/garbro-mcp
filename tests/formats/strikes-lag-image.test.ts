import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	lagImageFormat,
	readLagLayout,
	unpackLag,
	unpackLagLzss,
	unpackLagRle,
} from "../../packages/formats/src/strikes/lag-image.js";

const HEAD_SIZE = 0x20;
/** The stored length of a scanline is counted in whole units of this many bytes. */
const SCANLINE_UNIT = 0x100;
const BITS_24 = 24;

interface Wanted {
	width: number;
	height: number;
	scanLineSize: number;
	alpha?: boolean;
	/** The packed rows of the picture, in the order they stand in. */
	rows: { flags: number; data: Buffer }[];
	/** Whether the rows stand as chunks of their own, as streams of their own. */
	streamed?: boolean;
	palette?: boolean;
}

/** A picture of this engine: the head the other way round, the colour map and the chunks of its rows. */
function buildLag(wanted: Wanted): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	Buffer.from([0x01, 0x10, 0x4c, 0x41]).copy(head, 0);
	head.writeUInt16BE(wanted.width, 4);
	head.writeUInt16BE(wanted.height, 6);
	head.writeUInt16BE(wanted.scanLineSize, 8);
	head[10] = BITS_24 | (wanted.alpha ? 0x20 : 0) | (wanted.palette ? 0x80 : 0);
	const rows: Buffer[] = [];
	for (const row of wanted.rows) {
		// The length of a stored row that is not a stream is written in whole units of the count above.
		const unit = Math.ceil(row.data.length / SCANLINE_UNIT) * SCANLINE_UNIT;
		const record = Buffer.alloc(4 + unit, 0x00);
		record.writeUIntBE(unit / SCANLINE_UNIT, 0, 3);
		record[3] = row.flags;
		row.data.copy(record, 4);
		rows.push(record);
	}
	const body = Buffer.concat(rows);
	const parts = [head];
	if (wanted.palette) parts.push(Buffer.alloc(0x300, 0x00));
	if (wanted.streamed) {
		const packed = deflateSync(body);
		const length = Buffer.alloc(4, 0x00);
		length.writeInt32BE(-packed.length, 0);
		parts.push(length, packed);
		head.writeUInt16BE(0, 0x18);
		head.writeInt32BE(0x10000, 0x14);
	} else {
		const length = Buffer.alloc(4, 0x00);
		length.writeInt32BE(body.length, 0);
		parts.push(length, body);
		head.writeUInt16BE(0, 0x18);
		head.writeInt32BE(0x10000, 0x14);
	}
	return Buffer.concat(parts);
}

/** The planes of one row of a picture: red, green and blue one behind the other, and the alpha behind them. */
function planes(
	width: number,
	red: number,
	green: number,
	blue: number,
	alpha = 0,
): Buffer {
	const row = Buffer.alloc(width * (alpha ? 4 : 3), 0x00);
	for (let column = 0; column < width; column += 1) {
		row[column] = red + column;
		row[width + column] = green + column;
		row[width * 2 + column] = blue + column;
		if (alpha) row[width * 3 + column] = alpha + column;
	}
	return row;
}

/** A row whose every byte is the sum of the one before it, as a row that carries its differences stands. */
function deltas(row: Buffer): Buffer {
	const out = Buffer.from(row);
	for (let at = out.length - 1; at > 0; at -= 1) {
		out[at] = ((out[at] ?? 0) - (out[at - 1] ?? 0)) & 0xff;
	}
	return out;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await lagImageFormat.open(
		new BufferByteSource(data),
		"picture.lag",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Strikes image", () => {
	it("reads a head that stands the other way round", () => {
		const data = buildLag({
			width: 2,
			height: 1,
			scanLineSize: 256,
			rows: [{ flags: 0, data: planes(2, 1, 11, 21) }],
		});
		expect(readLagLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			scanLineSize: 256,
			hasAlpha: false,
			hasPalette: false,
		});
		const wrongDepth = Buffer.from(data);
		wrongDepth[10] = 8;
		expect(readLagLayout(wrongDepth)?.bitsPerPixel).toBe(8);
		// A depth the reference detects and does not draw is refused when its pixels are asked for.
		return expect(extract(wrongDepth)).rejects.toThrow(/does not draw/);
	});

	it("draws the planes of a row into the order a bitmap keeps", async () => {
		const data = buildLag({
			width: 3,
			height: 1,
			scanLineSize: 256,
			rows: [{ flags: 0, data: planes(3, 1, 11, 21) }],
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(24);
		expect([...bmp.pixels]).toEqual([21, 11, 1, 22, 12, 2, 23, 13, 3]);
	});

	it("adds the differences a row stands in back together", () => {
		const row = planes(3, 1, 11, 21);
		const data = buildLag({
			width: 3,
			height: 1,
			scanLineSize: 256,
			rows: [{ flags: 1, data: deltas(row) }],
		});
		const layout = readLagLayout(data);
		if (!layout) throw new Error("no layout");
		return expect(
			unpackLag(data, layout).then((pixels) => [...pixels]),
		).resolves.toEqual([21, 11, 1, 22, 12, 2, 23, 13, 3]);
	});

	it("unpacks the frame of a packed row, whose control bits start at the lowest", () => {
		// A byte of its own and a copy of three out of the frame, whose writing place starts near its end -
		// so the copy reads the bytes it has just written.
		// The place of the copy names the byte the literal behind it has just written.
		const data = Buffer.from([0x01, 0x41, 0xee, 0xf0]);
		const output = Buffer.alloc(8, 0x00);
		const size = unpackLagLzss(data, data.length, output);
		// The byte of its own and the three the copy draws, every one of them out of the frame.
		expect(size).toBe(4);
		expect([...output.subarray(0, 4)]).toEqual([0x41, 0x41, 0x41, 0x41]);
	});

	it("unpacks the runs of a row, in all four of their ways", () => {
		const decode = (data: readonly number[], size: number): number[] => {
			const output = Buffer.alloc(size, 0x00);
			unpackLagRle(Buffer.from(data), data.length, output);
			return [...output];
		};
		// Four values of two bits to a byte, each of them a sign of its own.
		expect(decode([0x03, 0b00011011], 4)).toEqual([0, 1, 0xfe, 0xff]);
		// Two values of four bits to a byte.
		expect(decode([0x41, 0x12], 2)).toEqual([1, 2]);
		// One value of six bits, taken from the top of a byte.
		expect(decode([0x80, 0x14], 1)).toEqual([5]);
		// Three values of six bits spread across the bytes: the first takes the top of a byte, the second
		// carries the low two bits of the one before it up to its own top, and the third the low four.
		expect(decode([0x82, 0x01, 0x02, 0x03], 3)).toEqual([0, 0x10, 0x08]);
		// And the bytes themselves.
		expect(decode([0xc2, 0xaa, 0xbb, 0xcc], 3)).toEqual([0xaa, 0xbb, 0xcc]);
	});

	it("draws a picture whose rows stand in a stream of their own", async () => {
		const data = buildLag({
			width: 2,
			height: 2,
			scanLineSize: 256,
			streamed: true,
			rows: [
				{ flags: 0, data: planes(2, 1, 11, 21) },
				{ flags: 1, data: deltas(planes(2, 4, 14, 24)) },
			],
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect([...bmp.pixels]).toEqual([
			21, 11, 1, 22, 12, 2, 24, 14, 4, 25, 15, 5,
		]);
	});

	it("carries the alpha plane of a picture into the fourth byte", async () => {
		const data = buildLag({
			width: 2,
			height: 1,
			scanLineSize: 256,
			alpha: true,
			rows: [{ flags: 0, data: planes(2, 1, 11, 21, 31) }],
		});
		const bmp = readBmpImage(await extract(data));
		if (!bmp) throw new Error("no bitmap");
		expect(bmp.bitsPerPixel).toBe(32);
		expect([...bmp.pixels]).toEqual([21, 11, 1, 31, 22, 12, 2, 32]);
	});

	it("turns away a word it does not know", async () => {
		const data = buildLag({
			width: 2,
			height: 1,
			scanLineSize: 256,
			rows: [{ flags: 0, data: planes(2, 1, 11, 21) }],
		});
		const elsewhere = Buffer.from(data);
		elsewhere[2] = 0x4d;
		expect(readLagLayout(elsewhere)).toBeUndefined();
		expect(
			await lagImageFormat.detect(new BufferByteSource(elsewhere), "a.lag"),
		).toBe(false);
		await expect(
			lagImageFormat.open(new BufferByteSource(elsewhere), "a.lag"),
		).rejects.toThrow(GarbroError);
	});
});
