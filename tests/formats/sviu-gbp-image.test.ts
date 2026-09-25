import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { gbpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readGbpLayout } from "../../packages/formats/src/sviu/gbp-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

interface GbpParts {
	width: number;
	height: number;
	bits: number;
	method: number;
	/** The places the words of every colour stand of, and the places of every colour behind them. */
	bitRegions: Buffer[];
	dataRegions: Buffer[];
	key?: Buffer;
}

/** The key a picture carries at its own end: the places of it the head stands hidden behind. */
function gbpKey(places: number[]): Buffer {
	const key: Buffer = Buffer.alloc(0x13, 0x00);
	for (let at = 0; at < 0x13; at += 1) key[at] = places[at] ?? 0;
	return key;
}

/** A picture of the SVIU system: its head, hidden behind the key at the end of it, and its places. */
function gbpFile(parts: GbpParts): Buffer {
	const channels = parts.bits / 8;
	const key =
		parts.key ??
		gbpKey([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 0x5a, 0xa5, 0x3c,
		]);
	const bitsTable: Buffer = Buffer.alloc(4 * channels, 0x00);
	for (let at = 0; at < channels; at += 1) {
		bitsTable.writeInt32LE(parts.bitRegions[at]?.length ?? 0, at * 4);
	}
	const dataTable: Buffer = Buffer.alloc(4 * channels, 0x00);
	for (let at = 0; at < channels; at += 1) {
		dataTable.writeInt32LE(parts.dataRegions[at]?.length ?? 0, at * 4);
	}
	const head: Buffer = Buffer.alloc(0x14, 0x00);
	head.write("GYBP", 0, "latin1");
	const headerSize = head.length;
	const dataOffset =
		headerSize +
		bitsTable.length +
		parts.bitRegions.reduce((sum, r) => sum + r.length, 0);
	head.writeInt32LE(headerSize, 4);
	head.writeInt32LE(dataOffset, 8);
	head.writeUInt16LE(parts.method, 0xc);
	head.writeUInt16LE(parts.width, 0xe);
	head.writeUInt16LE(parts.height, 0x10);
	head.writeUInt16LE(parts.bits, 0x12);
	// The head stands hidden: a place of the key comes onto every place of it, and then every pair of them
	// turns about.
	for (let at = 0; at < 0x10; at += 1) {
		head[at + 4] = ((head[at + 4] ?? 0) + (key[at] ?? 0)) & 0xff;
	}
	for (let at = 4; at < 0x14; at += 2) {
		head[at] = (head[at] ?? 0) ^ (key[0x10] ?? 0);
		head[at + 1] = (head[at + 1] ?? 0) ^ (key[0x11] ?? 0);
	}
	return Buffer.concat([
		head,
		bitsTable,
		...parts.bitRegions,
		dataTable,
		...parts.dataRegions,
		key,
	]);
}

async function imageOf(data: Buffer) {
	const handle = await gbpImageFormat.open(
		new BufferByteSource(data),
		"cg.gbp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

/** The control words of a picture standing of one place after another, and the places behind them. */
const literal = (places: number[]): [Buffer, Buffer] => [
	Buffer.alloc(Math.ceil(places.length / 8), 0x00),
	Buffer.from(places),
];

describe("SVIU system image", () => {
	it("takes the head of a picture back out of the key it carries", () => {
		const [bits, bytes] = literal([1, 2]);
		const good = gbpFile({
			width: 2,
			height: 1,
			bits: 24,
			method: 1,
			bitRegions: [bits, bits, bits],
			dataRegions: [bytes, bytes, bytes],
		});
		const layout = readGbpLayout(good);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(1);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.method).toBe(1);
		// A picture whose key stands broken at its own end leaves a head of other measurements behind.
		const other = Buffer.from(good);
		other[other.length - 0x13] = (other[other.length - 0x13] ?? 0) ^ 0x5a;
		expect(readGbpLayout(other)?.width).not.toBe(2);
		// The word of another engine, a picture of another depth, a kind of its own this engine does not
		// know, and a file standing short of its own key.
		const wrong = Buffer.from(good);
		wrong.write("XYBP", 0, "latin1");
		expect(readGbpLayout(wrong)).toBeUndefined();
		const depth = Buffer.from(good);
		depth.writeUInt16LE(16, 0x12);
		expect(readGbpLayout(depth)).toBeUndefined();
		expect(readGbpLayout(good.subarray(0, 0x14))).toBeUndefined();
	});

	it("hands the places of its colours over, every place of one standing on the place before it", async () => {
		const [bits, bytes] = literal([0x10, 0x01]);
		const other = literal([0x20, 0x02])[1];
		const third = literal([0x30, 0x03])[1];
		const image = await imageOf(
			gbpFile({
				width: 2,
				height: 1,
				bits: 24,
				method: 1,
				bitRegions: [bits, bits, bits],
				dataRegions: [bytes, other, third],
			}),
		);
		expect(image.bitsPerPixel).toBe(32);
		// The places of a colour are carried: 0x10 then 0x11, 0x20 then 0x22, 0x30 then 0x33.
		expect([...image.pixels]).toEqual([
			0x10, 0x20, 0x30, 0x00, 0x11, 0x22, 0x33, 0x00,
		]);
	});

	it("takes the places of a colour from the places behind them", async () => {
		// Two places as they stand, then a run of three places from the one two places behind them.
		const bits: Buffer = Buffer.from([0x20]);
		const bytes: Buffer = Buffer.from([0x10, 0x20, 0x10, 0x00]);
		const image = await imageOf(
			gbpFile({
				width: 5,
				height: 1,
				bits: 24,
				method: 1,
				bitRegions: [bits, bits, bits],
				dataRegions: [bytes, bytes, bytes],
			}),
		);
		// The places of the colour stand 0x10, 0x20, 0x10, 0x20, 0x10, and every one of them stands on the
		// places before it: 0x10, 0x30, 0x40, 0x60, 0x70.
		expect([...image.pixels]).toEqual([
			0x10, 0x10, 0x10, 0x00, 0x30, 0x30, 0x30, 0x00, 0x40, 0x40, 0x40, 0x00,
			0x60, 0x60, 0x60, 0x00, 0x70, 0x70, 0x70, 0x00,
		]);
	});

	it("hands the places of a picture standing of the walks of its own over", async () => {
		// A walk of this engine stands in a frame of 0x1000 from 0xFEE, so a run of the places near the end
		// of the frame stands of the places that came before it in the same walk.
		const places: Buffer = Buffer.from([0x41, 0x42, 0xe2, 0xfe]);
		const walked = await imageOf(
			gbpFile({
				width: 7,
				height: 1,
				bits: 24,
				method: 2,
				bitRegions: [
					Buffer.from([0x20]),
					Buffer.from([0x20]),
					Buffer.from([0x20]),
				],
				dataRegions: [places, places, places],
			}),
		);
		// The places of the channel stand 0x41, 0x42 and then, from 0xFEE on, 0x41, 0x42 and the three
		// places behind them, of which the last stands of the place the run wrote itself.
		expect([...walked.pixels].filter((_, at) => at % 4 === 0)).toEqual([
			0x41, 0x83, 0xc4, 0x06, 0x47, 0x89, 0xca,
		]);
		// The same places standing as they stand, for the sake of the walk behind them.
		const [bits, bytes] = literal([0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41]);
		const plain = await imageOf(
			gbpFile({
				width: 7,
				height: 1,
				bits: 24,
				method: 1,
				bitRegions: [bits, bits, bits],
				dataRegions: [bytes, bytes, bytes],
			}),
		);
		expect([...walked.pixels]).toEqual([...plain.pixels]);
	});

	it("hands a picture standing of blocks of eight places over", async () => {
		// One block, its places standing of one place of the block data and of nothing else.
		const blocks = (control: number, data: number[], chunks: Buffer): Buffer =>
			Buffer.concat([
				(() => {
					const head: Buffer = Buffer.alloc(12, 0x00);
					head.writeInt32LE(1, 0);
					head.writeInt32LE(data.length, 4);
					head.writeInt32LE(chunks.length, 8);
					return head;
				})(),
				Buffer.from([control]),
				Buffer.from(data),
				chunks,
			]);
		const image = await imageOf(
			gbpFile({
				width: 4,
				height: 4,
				bits: 24,
				method: 3,
				bitRegions: [
					blocks(0x80, [0x11], Buffer.alloc(0)),
					blocks(0x80, [0x22], Buffer.alloc(0)),
					blocks(0x80, [0x33], Buffer.alloc(0)),
				],
				dataRegions: [Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)],
			}),
		);
		expect(image.width).toBe(4);
		expect([...image.pixels].filter((_, at) => at % 4 === 0)).toEqual([
			0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11,
			0x11, 0x11, 0x11, 0x11,
		]);
		expect([...image.pixels].filter((_, at) => at % 4 === 1)).toEqual([
			0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22, 0x22,
			0x22, 0x22, 0x22, 0x22,
		]);
	});

	it("reads the alpha of a picture of four places to a pixel as runs of its own", async () => {
		const [bits, bytes] = literal([0x07, 0x08, 0x09]);
		const image = await imageOf(
			gbpFile({
				width: 3,
				height: 1,
				bits: 32,
				method: 1,
				bitRegions: [bits, bits, bits, bits],
				dataRegions: [bytes, bytes, bytes, Buffer.from([0x80, 0x00, 0x01])],
			}),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels].filter((_, at) => at % 4 === 3)).toEqual([
			0x80, 0x00, 0x00,
		]);
	});

	it("tells a picture by the word it opens with", async () => {
		const [bits, bytes] = literal([0x01]);
		const data = gbpFile({
			width: 1,
			height: 1,
			bits: 24,
			method: 1,
			bitRegions: [bits, bits, bits],
			dataRegions: [bytes, bytes, bytes],
		});
		expect(await gbpImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		const wrong = Buffer.from(data);
		wrong.write("GYBQ", 0, "latin1");
		expect(await gbpImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
