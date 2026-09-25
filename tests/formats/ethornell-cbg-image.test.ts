// The walk of the places of the file of a compressed picture of the Ethornell engine, against fixtures
// written out of the reference's own head, key walk and weight tables.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ethornellCbgImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	buildCbgHuffmanTree,
	readCbgHeader,
} from "../../packages/formats/src/ethornell/cbg-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/**
 * `CbgReader.UpdateKey`, written out of the reference for the fixture alone so the stored stream does not
 * lean on the port's own arithmetic.
 */
function updateKey(state: { key: number; magic: number }): number {
	const low = 20021 * (state.key & 0xffff);
	let high = (state.magic | (state.key >>> 16)) >>> 0;
	high = (Math.imul(high, 20021) + Math.imul(state.key, 346)) >>> 0;
	high = (high + (low >>> 16)) & 0xffff;
	state.key = ((high << 16) + (low & 0xffff) + 1) >>> 0;
	return high & 0xff;
}

/** `ReadInteger`: a count of places, seven bits to a letter with the high bit of the last one clear. */
function varint(value: number): number[] {
	const out: number[] = [];
	let left = value;
	for (;;) {
		const letter = left & 0x7f;
		left >>>= 7;
		if (0 === left) {
			out.push(letter);
			return out;
		}
		out.push(letter | 0x80);
	}
}

/** The counts of a run of weights, a letter of its own each. */
function varints(values: readonly number[]): number[] {
	return values.flatMap((value) => varint(value));
}

/** The weights of a tree of a fixture: the leaves of the alphabet carry one and the rest none. */
function weightsOf(leaves: number): number[] {
	const weights: number[] = new Array(256).fill(0);
	for (let i = 0; i < leaves; i += 1) weights[i] = 1;
	return weights;
}

/** The codes the reference's own join rule hands a tree of one weight each, derived by hand. */
const SIX_LEAF_CODES: Record<number, string> = {
	0: "100",
	1: "101",
	2: "110",
	3: "111",
	4: "00",
	5: "01",
};

const EIGHT_LEAF_CODES: Record<number, string> = {
	0: "000",
	1: "001",
	2: "010",
	3: "011",
	4: "100",
	5: "101",
	6: "110",
	7: "111",
};

/**
 * A tree of thirty two leaves of one weight each is a whole tree of five leaves to a place, so every
 * place carries its own letters and the counts of the runs of the walk are covered as well.
 */
const THIRTY_TWO_LEAF_CODES: Record<number, string> = Object.fromEntries(
	Array.from({ length: 32 }, (_place, symbol) => [
		symbol,
		symbol.toString(2).padStart(5, "0"),
	]),
);

interface CbgSpec {
	width: number;
	height: number;
	bitsPerPixel: number;
	key?: number;
	leaves: number;
	codes: Record<number, string>;
	/** The places of the picture before the average walk, one literal run of them. */
	literals: number[];
	version?: number;
	encodedLength?: number;
	checkSum?: number;
	checkXor?: number;
}

/** `CbgReader.ReadEncoded` and the head of the engine, written the way the reference reads them. */
function buildCbg(spec: CbgSpec): Buffer {
	const symbols = [...varint(spec.literals.length), ...spec.literals];
	const bits: number[] = [];
	for (const symbol of symbols) {
		const code = spec.codes[symbol];
		if (code === undefined) throw new Error(`no code for ${symbol}`);
		for (const letter of code) bits.push("1" === letter ? 1 : 0);
	}
	// The walked stream of the head holds the weights of the leaves alone; the coded places stand behind it
	// in the clear, which is where the bit reader of the picture finds them.
	const payload: number[] = [...weightsOf(spec.leaves)];
	const coded: number[] = [];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let i = 0; i < 8; i += 1) {
			value = (value << 1) | (bits[at + i] ?? 0);
		}
		coded.push(value);
	}
	const key = spec.key ?? 0x12345678;
	let sum = 0;
	let xor = 0;
	for (const value of payload) {
		sum = (sum + value) & 0xff;
		xor ^= value;
	}
	const header = Buffer.alloc(0x30, 0);
	header.write("CompressedBG___", 0, "latin1");
	header.writeUInt16LE(spec.width, 0x10);
	header.writeUInt16LE(spec.height, 0x12);
	header.writeInt32LE(spec.bitsPerPixel, 0x14);
	header.writeInt32LE(symbols.length, 0x20);
	header.writeUInt32LE(key, 0x24);
	header.writeInt32LE(spec.encodedLength ?? payload.length, 0x28);
	header[0x2c] = spec.checkSum ?? sum;
	header[0x2d] = spec.checkXor ?? xor;
	header.writeUInt16LE(spec.version ?? 1, 0x2e);
	const state = { key, magic: 0 };
	const stored = Buffer.alloc(payload.length, 0);
	for (let at = 0; at < payload.length; at += 1) {
		// The reference takes the key of the engine off every place it reads, so the writer of the fixture
		// puts it on.
		stored[at] = ((payload[at] ?? 0) + updateKey(state)) & 0xff;
	}
	return Buffer.concat([header, stored, Buffer.from(coded)]);
}

interface CbgSecondSpec {
	width: number;
	height: number;
	bitsPerPixel: number;
	key?: number;
	/** The count of the letters of a colour of a block and the places it carries, a block of a plane each. */
	deltas: { count: number; value: number }[];
	/** One coded place of the first plane, as the second tree of the reference carries it. */
	coefficient?: { value: number };
	/** The alpha places of the padded picture, in order. */
	alpha?: number[];
}

/**
 * A picture of the second walk of the engine: the table of the places of the colour stands in the walked
 * stream of the head, and the two trees, the places of the blocks of rows and the blocks themselves stand
 * behind it in the clear. The first tree carries sixteen leaves of one weight each (so a count of letters
 * is its own four letters) and the second carries the leaves 0 and 0x12, whose codes are one letter each.
 */
function buildCbgSecondWalk(spec: CbgSecondSpec): Buffer {
	const bits: number[] = [];
	for (const delta of spec.deltas) {
		const code = delta.count.toString(2).padStart(4, "0");
		for (const letter of code) bits.push("1" === letter ? 1 : 0);
		for (let i = delta.count - 1; i >= 0; i -= 1) {
			bits.push((delta.value >> i) & 1);
		}
	}
	// The reference drops the letters of the byte its bit walk stands in before it reads the places of
	// the blocks, so the letters of the second tree begin at a byte.
	while (0 !== bits.length % 8) bits.push(0);
	const planes = spec.deltas.length / 3;
	for (let plane = 0; plane < planes; plane += 1) {
		if (0 === plane && spec.coefficient) {
			// The leaf 0x12 of the second tree: one letter, then the letters of its place.
			bits.push(1);
			const count = 0x12 >> 4;
			for (let i = count - 1; i >= 0; i -= 1) {
				bits.push((spec.coefficient.value >> i) & 1);
			}
		}
		// The leaf 0 of the second tree stops the walk of a block.
		bits.push(0);
	}
	const block: number[] = [...varint(spec.deltas.length * 64)];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let i = 0; i < 8; i += 1) value = (value << 1) | (bits[at + i] ?? 0);
		block.push(value);
	}
	const weights1: number[] = new Array(16).fill(1);
	const weights2: number[] = new Array(0xb0).fill(0);
	weights2[0] = 1;
	weights2[0x12] = 1;
	const stream: number[] = [...varints(weights1), ...varints(weights2)];
	const width8 = (spec.width + 7) & -8;
	const padSkip = ((width8 >> 3) + 7) >> 3;
	const blocks = ((spec.height + 7) & -8) / 8;
	const alpha: number[] = [];
	if (spec.alpha) {
		// The mark of the alpha stream, then a control letter of nothing and the eight places it covers.
		alpha.push(1, 0, 0, 0);
		for (let at = 0; at < spec.alpha.length; at += 8) {
			alpha.push(0);
			for (let i = 0; i < 8 && at + i < spec.alpha.length; i += 1) {
				alpha.push(spec.alpha[at + i] ?? 0);
			}
		}
	}
	const blockData: number[] = [
		...new Array(padSkip).fill(0),
		...block,
		...alpha,
	];
	const words = blocks + 1;
	const inputBase = stream.length + words * 4;
	const offsets: number[] = [inputBase, inputBase + padSkip + block.length];
	const payload: number[] = new Array(0x80).fill(0x10);
	let sum = 0;
	let xor = 0;
	for (const value of payload) {
		sum = (sum + value) & 0xff;
		xor ^= value;
	}
	const key = spec.key ?? 0x12345678;
	const header = Buffer.alloc(0x30, 0);
	header.write("CompressedBG___", 0, "latin1");
	header.writeUInt16LE(spec.width, 0x10);
	header.writeUInt16LE(spec.height, 0x12);
	header.writeInt32LE(spec.bitsPerPixel, 0x14);
	header.writeUInt32LE(key, 0x24);
	header.writeInt32LE(0x80, 0x28);
	header[0x2c] = sum;
	header[0x2d] = xor;
	header.writeUInt16LE(2, 0x2e);
	const state = { key, magic: 0 };
	const stored = Buffer.from(
		payload.map((value) => (value + updateKey(state)) & 0xff),
	);
	const tail: number[] = [...stream];
	for (const offset of offsets) {
		tail.push(
			offset & 0xff,
			(offset >> 8) & 0xff,
			(offset >> 16) & 0xff,
			(offset >> 24) & 0xff,
		);
	}
	tail.push(...blockData);
	return Buffer.concat([header, stored, Buffer.from(tail)]);
}

/** The alpha places of a padded picture, every place of a row of the picture in its own column. */
function paddedAlpha(
	width: number,
	height: number,
	values: Map<string, number>,
): number[] {
	const width8 = (width + 7) & -8;
	const height8 = (height + 7) & -8;
	const out: number[] = [];
	for (let y = 0; y < height8; y += 1) {
		for (let x = 0; x < width8; x += 1) {
			out.push(values.get(`${x},${y}`) ?? 0);
		}
	}
	return out;
}

async function pictureOf(archive: Buffer): Promise<Buffer> {
	const handle = await ethornellCbgImageFormat.open(
		new BufferByteSource(archive),
		"sample.bgi",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Ethornell compressed picture", () => {
	it("reads the head of the picture", () => {
		const header = readCbgHeader(
			buildCbg({
				width: 2,
				height: 2,
				bitsPerPixel: 8,
				leaves: 6,
				codes: SIX_LEAF_CODES,
				literals: [0, 1, 2, 3],
			}),
		);
		expect(header?.width).toBe(2);
		expect(header?.height).toBe(2);
		expect(header?.bitsPerPixel).toBe(8);
		expect(header?.version).toBe(1);
		expect(header?.key).toBe(0x12345678);
		// The weights of the six leaves stand as a letter each inside the walked stream of the head.
		expect(header?.encodedLength).toBe(0x100);
	});

	it("joins the weights of the leaves the way the reference does", () => {
		// The codes are derived from the reference's own join rule by hand: the lightest leaves first, the
		// lower place winning a draw, and the walk ends once the joined weight reaches the sum of the
		// weights of the leaves.
		const codesOf = (leaves: number): Record<number, string> => {
			const nodes = buildCbgHuffmanTree(weightsOf(leaves));
			const codes: Record<number, string> = {};
			const walk = (at: number, bits: string): void => {
				const node = nodes[at];
				if (!node) return;
				if (!node.isParent) {
					codes[at] = bits;
					return;
				}
				walk(node.left, `${bits}0`);
				walk(node.right, `${bits}1`);
			};
			walk(nodes.length - 1, "");
			return codes;
		};
		expect(codesOf(6)).toEqual(SIX_LEAF_CODES);
		expect(codesOf(8)).toEqual(EIGHT_LEAF_CODES);
		expect(codesOf(32)).toEqual(THIRTY_TWO_LEAF_CODES);
		// Two leaves of one weight each stand under a root of their own, so a place costs a single bit.
		const two = buildCbgHuffmanTree([1, 1, ...new Array(254).fill(0)]);
		expect(two.length).toBe(257);
		expect(two[256]?.left).toBe(0);
		expect(two[256]?.right).toBe(1);
	});

	it("reads a picture of one place to a colour", async () => {
		const bmp = await pictureOf(
			buildCbg({
				width: 2,
				height: 2,
				bitsPerPixel: 8,
				leaves: 6,
				codes: SIX_LEAF_CODES,
				literals: [0, 1, 2, 3],
			}),
		);
		const image = readBmpImage(bmp);
		// The places stand as they were stored, then the place before them and the place above them are
		// added: 0, 0+1, 0+2, 3 + (1+2)/2.
		expect([...(image?.pixels ?? [])]).toEqual([0, 1, 2, 4]);
		// The reference hands a picture of one place to a colour over as a grey picture, whose ramp the
		// bitmap writer of this port lays down with the fourth place of an entry left at nothing.
		expect([...(image?.palette.subarray(0, 8) ?? [])]).toEqual([
			0, 0, 0, 0, 1, 1, 1, 0,
		]);
	});

	it("reads a picture of the three colours of a place", async () => {
		const bmp = await pictureOf(
			buildCbg({
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				leaves: 32,
				codes: THIRTY_TWO_LEAF_CODES,
				literals: [1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4],
			}),
		);
		const image = readBmpImage(bmp);
		expect(image?.width).toBe(2);
		expect(image?.height).toBe(2);
		expect([...(image?.pixels ?? [])]).toEqual([
			1, 2, 3, 5, 7, 9, 8, 2, 4, 8, 7, 10,
		]);
	});

	it("reads a picture of the four places of a colour", async () => {
		const bmp = await pictureOf(
			buildCbg({
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				leaves: 32,
				codes: THIRTY_TWO_LEAF_CODES,
				literals: [7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 0],
			}),
		);
		const image = readBmpImage(bmp);
		expect([...(image?.pixels ?? [])]).toEqual([
			7, 6, 5, 4, 10, 8, 6, 4, 8, 8, 8, 8, 14, 14, 14, 6,
		]);
	});

	it("refuses a stream the sum of which does not stand", async () => {
		const archive = buildCbg({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
			leaves: 6,
			codes: SIX_LEAF_CODES,
			literals: [0, 1, 2, 3],
			checkSum: 0x01,
		});
		await expect(pictureOf(archive)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		// A key of the head that differs leaves a stream that does not walk either.
		const wrongKey = buildCbg({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
			key: 0x87654321,
			leaves: 6,
			codes: SIX_LEAF_CODES,
			literals: [0, 1, 2, 3],
		});
		wrongKey.writeUInt32LE(0x11111111, 0x24);
		await expect(pictureOf(wrongKey)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses the heads the walk of the engine cannot read", async () => {
		// A head of the second walk whose stored stream does not hold the places it declares.
		const second = buildCbg({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			leaves: 32,
			codes: THIRTY_TWO_LEAF_CODES,
			literals: [7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6, 7, 0],
			version: 2,
			encodedLength: 0x200,
		});
		expect(
			await ethornellCbgImageFormat.detect(new BufferByteSource(second)),
		).toBe(true);
		await expect(pictureOf(second)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		// The reference refuses a shorter encoded stream of the second walk before it walks it.
		const shortSecond = buildCbg({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			leaves: 32,
			codes: THIRTY_TWO_LEAF_CODES,
			literals: [1, 2, 3, 4],
			version: 2,
			// The reference looks at the count of the places of the file of the stream of the head before it
			// walks anything.
			encodedLength: 0x40,
		});
		await expect(pictureOf(shortSecond)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		const third = buildCbg({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			leaves: 32,
			codes: THIRTY_TWO_LEAF_CODES,
			literals: [1, 2, 3, 4],
			version: 3,
		});
		await expect(pictureOf(third)).rejects.toMatchObject({
			code: "UNSUPPORTED_FEATURE",
		});
	});

	it("reads a picture of the second walk", async () => {
		const bmp = await pictureOf(
			buildCbgSecondWalk({
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				deltas: [
					{ count: 3, value: 4 },
					{ count: 4, value: 10 },
					{ count: 2, value: 0 },
				],
			}),
		);
		const image = readBmpImage(bmp);
		expect(image?.width).toBe(2);
		expect(image?.height).toBe(2);
		// The places of the colour of the three planes stand as the walk of the engine laid them down:
		// 4, 4 + 10 and 4 + 10 - 3, each turned by the table of the head and then read out of the three
		// channels. The numbers stand from an independent transcription of the walk.
		expect([...(image?.pixels ?? [])]).toEqual([
			186, 111, 167, 186, 111, 167, 186, 111, 167, 186, 111, 167,
		]);
	});

	it("reads a picture of the second walk of places below nothing", async () => {
		const bmp = await pictureOf(
			buildCbgSecondWalk({
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				deltas: [
					{ count: 3, value: 0 },
					{ count: 3, value: 4 },
					{ count: 4, value: 10 },
				],
			}),
		);
		// The counts of the letters carry the places of the walk of the colour: a count of three with a
		// high letter of nothing stands for -7, and the walk lays 4 on top of it.
		expect([...(readBmpImage(bmp)?.pixels ?? [])]).toEqual([
			103, 106, 134, 103, 106, 134, 103, 106, 134, 103, 106, 134,
		]);
	});

	it("reads a coded place of the colour of the second walk", async () => {
		// The second tree carries one coded place of the colour of the first plane, on top of the places of
		// the walk of the colour.
		const bmp = await pictureOf(
			buildCbgSecondWalk({
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				deltas: [
					{ count: 3, value: 4 },
					{ count: 4, value: 10 },
					{ count: 2, value: 0 },
				],
				coefficient: { value: 1 },
			}),
		);
		expect([...(readBmpImage(bmp)?.pixels ?? [])]).toEqual([
			188, 113, 169, 188, 113, 169, 187, 112, 168, 187, 112, 168,
		]);
	});

	it("reads the alpha places of the second walk", async () => {
		const bmp = await pictureOf(
			buildCbgSecondWalk({
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				deltas: [
					{ count: 3, value: 4 },
					{ count: 4, value: 10 },
					{ count: 2, value: 0 },
				],
				alpha: paddedAlpha(
					2,
					2,
					new Map([
						["0,0", 0xab],
						["1,0", 0xcd],
						["0,1", 0xef],
						["1,1", 0x12],
					]),
				),
			}),
		);
		const image = readBmpImage(bmp);
		expect(image?.bitsPerPixel).toBe(32);
		// The places of the colour stand as they do without an alpha walk, and the fourth place of a
		// picture carries the place the alpha walk laid down.
		expect([...(image?.pixels ?? [])]).toEqual([
			186, 111, 167, 0xab, 186, 111, 167, 0xcd, 186, 111, 167, 0xef, 186, 111,
			167, 0x12,
		]);
	});

	it("refuses a picture of the second walk of no places of the file", async () => {
		// The places of the blocks of the engine reach past the file itself.
		const beyond = buildCbgSecondWalk({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			deltas: [
				{ count: 3, value: 4 },
				{ count: 4, value: 10 },
				{ count: 2, value: 0 },
			],
		});
		await expect(pictureOf(beyond)).resolves.toBeInstanceOf(Buffer);
		const truncated = beyond.subarray(0, 0x30 + 0x80 + 0x20);
		await expect(pictureOf(Buffer.from(truncated))).rejects.toThrow(
			GarbroError,
		);
	});

	it("refuses a head the reference cannot read", async () => {
		// A depth of four places to a colour and a sixteen bit picture of the second walk.
		const deep = buildCbg({
			width: 2,
			height: 2,
			bitsPerPixel: 4,
			leaves: 32,
			codes: THIRTY_TWO_LEAF_CODES,
			literals: [1, 2, 3, 4],
		});
		expect(
			await ethornellCbgImageFormat.detect(new BufferByteSource(deep)),
		).toBe(false);
		await expect(pictureOf(deep)).rejects.toThrow(GarbroError);
		const sixteen = buildCbg({
			width: 2,
			height: 2,
			bitsPerPixel: 16,
			leaves: 32,
			codes: THIRTY_TWO_LEAF_CODES,
			literals: [1, 2, 3, 4],
			version: 2,
			encodedLength: 0x200,
		});
		expect(
			await ethornellCbgImageFormat.detect(new BufferByteSource(sixteen)),
		).toBe(false);
		// A file of no places of the file of the mark of the engine.
		const other = Buffer.from(
			buildCbg({
				width: 2,
				height: 2,
				bitsPerPixel: 8,
				leaves: 6,
				codes: SIX_LEAF_CODES,
				literals: [0, 1, 2, 3],
			}),
		);
		other.write("CompressedBD___", 0, "latin1");
		expect(
			await ethornellCbgImageFormat.detect(new BufferByteSource(other)),
		).toBe(false);
		expect(
			await ethornellCbgImageFormat.detect(
				new BufferByteSource(Buffer.alloc(0x20)),
			),
		).toBe(false);
	});
});
