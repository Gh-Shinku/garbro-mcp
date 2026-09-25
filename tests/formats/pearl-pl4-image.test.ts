import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { pearlPl4ImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readPl4Layout } from "../../packages/formats/src/pearl/pl4-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const PALETTE_COLORS = 16;

/** A picture of the engine: the mark, the head, sixteen colours and the walks of the places. */
function pl4File(input: {
	width: number;
	height: number;
	compression: number;
	body: Buffer;
	version?: number;
}): Buffer {
	const head: Buffer = Buffer.alloc(0x10, 0x00);
	head.write("PL4 ", 0, "latin1");
	head.writeUInt16LE(input.version ?? 1, 4);
	head.writeUInt16LE(input.compression, 6);
	head.writeUInt16LE(input.width / 8, 0xc);
	head.writeUInt16LE(input.height, 0xe);
	const palette: Buffer = Buffer.alloc(PALETTE_COLORS * 3, 0x00);
	for (let at = 0; at < PALETTE_COLORS; at += 1) {
		palette[at * 3] = at;
		palette[at * 3 + 1] = 0x10 - at;
		palette[at * 3 + 2] = at * 2;
	}
	return Buffer.concat([head, palette, input.body]);
}

/** The word of the walks of the first kind that stands of four places of the picture. */
function wordOfPlaces(places: number[]): number {
	let word = 0;
	for (let place = 0; place < 4; place += 1) {
		for (let bit = 0; bit < 4; bit += 1) {
			word |= (((places[place] ?? 0) >> bit) & 1) << (15 - place - 4 * bit);
		}
	}
	return word;
}

/** The places of the walks of the first kind, of a picture of rows of four places to a group. */
function walkV0(
	width: number,
	height: number,
	steps: { places?: number[]; run?: { mixed: number; count: number } }[],
): Buffer {
	const bytes: number[] = [];
	for (const step of steps) {
		if (step.run) {
			// The lowest place of the word names no place of the picture, and a run of the engine
			// whose lowest place stands at nought would stand of the mark of the header instead.
			const word =
				((step.run.mixed - 1) << 6) | ((step.run.count - 2) << 1) | 1;
			bytes.push(0x98, word & 0xff, (word >> 8) & 0xff);
		} else {
			const word = wordOfPlaces(step.places ?? []);
			bytes.push(word & 0xff, (word >> 8) & 0xff);
		}
	}
	void width;
	void height;
	return Buffer.from(bytes);
}

/** The walks of the second kind, of the places of a picture and of the table behind them. */
class WalkV1 {
	private readonly bits: number[] = [];
	private readonly table = new Uint8Array(0x100);
	private readonly states = [0, 0, 0, 0];

	constructor() {
		for (let at = 0; at < this.table.length; at += 1) {
			this.table[at] = (at + (at >> 4)) & 0xf;
		}
	}

	private bit(value: number): void {
		this.bits.push(value & 1);
	}

	private bitsOf(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1) this.bit((value >> at) & 1);
	}

	/** `GetPixelBits` the other way round: the code of a place in the table. */
	private writePosition(at: number): void {
		if (at < 2) {
			this.bit(1);
			this.bitsOf(at, 1);
		} else if (at < 4) {
			this.bit(0);
			this.bit(1);
			this.bitsOf(at - 2, 1);
		} else if (at < 8) {
			this.bitsOf(0, 2);
			this.bit(1);
			this.bitsOf(at - 4, 2);
		} else {
			this.bitsOf(0, 3);
			this.bitsOf(at - 8, 3);
		}
	}

	/** A value of the picture standing of the places of the table before it. */
	private draw(prior: number, value: number): void {
		const row = (prior & 0xf) << 4;
		let position = 0;
		while (position < 16 && (this.table[row + position] ?? 0) !== value) {
			position += 1;
		}
		this.writePosition(position);
		let at = row + position;
		while (position > 0) {
			this.table[at] = this.table[at - 1] ?? 0;
			at -= 1;
			position -= 1;
		}
		this.table[row] = value;
	}

	/** Eight places of a row standing as they stand. */
	literal(places: number[]): void {
		this.bit(0);
		for (let state = 0; state < 4; state += 1) {
			let high = 0;
			let low = 0;
			for (let place = 0; place < 4; place += 1) {
				high |= (((places[place] ?? 0) >> state) & 1) << (3 - place);
				low |= (((places[place + 4] ?? 0) >> state) & 1) << (3 - place);
			}
			this.draw(this.states[state] ?? 0, high);
			this.draw(high, low);
			this.states[state] = (high << 4) | low;
		}
	}

	/** A row standing of the places of the row the walk names. */
	reference(selector: number, count: number): void {
		this.bit(1);
		this.bitsOf(selector, 2);
		if (1 === count) {
			this.bit(1);
			return;
		}
		const length = 31 - Math.clz32(count);
		this.bitsOf(0, length);
		this.bit(1);
		this.bitsOf(count - (1 << length), length);
	}

	bytes(): Buffer {
		const out: number[] = [];
		for (let at = 0; at < this.bits.length; at += 8) {
			let value = 0;
			for (let bit = 0; bit < 8; bit += 1) {
				value = (value << 1) | (this.bits[at + bit] ?? 0);
			}
			out.push(value);
		}
		return Buffer.from(out);
	}
}

async function pictureOf(data: Buffer) {
	const handle = await pearlPl4ImageFormat.open(
		new BufferByteSource(data),
		"cg.pl4",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("Pearl Soft image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const layout = readPl4Layout(
			pl4File({ width: 8, height: 4, compression: 0, body: Buffer.alloc(8) }),
		);
		expect(layout).toEqual({ width: 8, height: 4, compression: 0 });
		expect(
			readPl4Layout(
				pl4File({
					width: 8,
					height: 4,
					compression: 0,
					body: Buffer.alloc(8),
					version: 2,
				}),
			),
		).toBeUndefined();
		expect(
			readPl4Layout(
				pl4File({ width: 8, height: 4, compression: 3, body: Buffer.alloc(8) }),
			),
		).toBeUndefined();
		expect(readPl4Layout(Buffer.alloc(0x40, 0x00))).toBeUndefined();
	});

	it("reads a picture of places standing as they stand", async () => {
		const image = await pictureOf(
			pl4File({
				width: 8,
				height: 1,
				compression: 0,
				body: walkV0(8, 1, [
					{ places: [1, 2, 3, 4] },
					{ places: [5, 6, 7, 8] },
				]),
			}),
		);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it("reads a picture of places standing of the places of the picture itself", async () => {
		// Eight rows of eight places: the first five stand as they stand, the sixth and the seventh
		// stand of the two rows five rows above them, and the eighth stands as it stands.
		const rows: number[][] = [];
		for (let row = 0; row < 8; row += 1) {
			rows.push(
				Array.from({ length: 8 }, (_value, place) => (row * 8 + place) % 16),
			);
		}
		const walk = walkV0(8, 8, [
			{ places: rows[0]?.slice(0, 4) ?? [] },
			{ places: rows[1]?.slice(0, 4) ?? [] },
			{ places: rows[2]?.slice(0, 4) ?? [] },
			{ places: rows[3]?.slice(0, 4) ?? [] },
			{ places: rows[4]?.slice(0, 4) ?? [] },
			{ run: { mixed: 5, count: 2 } },
			{ places: rows[7]?.slice(0, 4) ?? [] },
			...Array.from({ length: 8 }, (_value, row) => ({
				places: (rows[row] ?? []).slice(4, 8),
			})),
		]);
		const image = await pictureOf(
			pl4File({ width: 8, height: 8, compression: 0, body: walk }),
		);
		// A run of the walks of the first kind stands of the four places of its own group of the row
		// five rows above it; the places of the other group of those rows stand as they stand.
		for (const [row, source] of [
			[5, 0],
			[6, 1],
		] as const) {
			for (let place = 0; place < 4; place += 1) {
				(rows[row] as number[])[place] = rows[source]?.[place] ?? 0;
			}
		}
		expect([...image.pixels]).toEqual(rows.flat());
	});

	it("reads the walks of the second kind, of the table behind the places of a picture", async () => {
		const walk = new WalkV1();
		walk.literal([1, 2, 3, 4, 5, 6, 7, 8]);
		walk.literal([9, 10, 11, 12, 13, 14, 15, 0]);
		walk.reference(3, 1);
		walk.literal([4, 4, 4, 4, 4, 4, 4, 4]);
		const image = await pictureOf(
			pl4File({ width: 8, height: 4, compression: 1, body: walk.bytes() }),
		);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 9, 10, 11, 12, 13,
			14, 15, 0, 4, 4, 4, 4, 4, 4, 4, 4,
		]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = pl4File({
			width: 8,
			height: 1,
			compression: 0,
			body: walkV0(8, 1, [{ places: [1, 2, 3, 4] }, { places: [5, 6, 7, 8] }]),
		});
		expect(await pearlPl4ImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await pearlPl4ImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
			),
		).toBe(false);
		await expect(
			pearlPl4ImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"cg.pl4",
			),
		).rejects.toThrow(GarbroError);
	});
});
