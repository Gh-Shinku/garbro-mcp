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
	const payload: number[] = [...weightsOf(spec.leaves)];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let i = 0; i < 8; i += 1) {
			value = (value << 1) | (bits[at + i] ?? 0);
		}
		payload.push(value);
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
	return Buffer.concat([header, stored]);
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
		// The weights of the six leaves stand as a letter each and the five coded places need two bytes
		// behind them.
		expect(header?.encodedLength).toBe(0x102);
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

	it("refuses the second walk and the versions behind it", async () => {
		// The second walk reads its own weights and walks the places of the colour of a block of the
		// picture, which this port does not carry yet.
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
			code: "UNSUPPORTED_FEATURE",
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
