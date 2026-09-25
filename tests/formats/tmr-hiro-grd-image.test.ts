import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readTmrHiroGrdLayout,
	tmrHiroGrdImageFormat,
	unpackTmrHiroGrdHuffman,
} from "../../packages/formats/src/tmr-hiro/grd-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0x20;
const LEAVES = 0x100;
const NODES = 0x200;
const ROOT = 0x1fe;

interface Channel {
	alpha?: number[];
	red: number[];
	green: number[];
	blue: number[];
}

/** `GrdReader.UnpackRLE` written the other way round: raw runs of at most a hundred and twenty seven bytes. */
function rle(values: number[]): Buffer {
	const parts: number[] = [];
	let at = 0;
	while (at < values.length) {
		const count = Math.min(0x7f, values.length - at);
		parts.push(count, ...values.slice(at, at + count));
		at += count;
	}
	return Buffer.from(parts);
}

/** One value written over and over, as the RLE of a channel writes it. */
function rleRepeat(value: number, count: number): Buffer {
	return Buffer.from([0x80 | count, value]);
}

function picture(
	channels: Channel,
	packType: number,
	bits: number,
	options: { width?: number; height?: number; screenHeight?: number } = {},
): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const screenHeight = options.screenHeight ?? 4;
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.writeUInt16LE(0x0101, 0);
	head[1] = packType;
	head.writeUInt16LE(8, 2);
	head.writeUInt16LE(screenHeight, 4);
	head.writeUInt16LE(bits, 6);
	head.writeUInt16LE(1, 8);
	head.writeUInt16LE(1 + width, 0x0a);
	head.writeUInt16LE(2, 0x0c);
	head.writeUInt16LE(2 + height, 0x0e);
	head.writeInt32LE(channels.alpha ? 5 : 0, 0x10);
	head.writeInt32LE(5, 0x14);
	head.writeInt32LE(5, 0x18);
	head.writeInt32LE(5, 0x1c);
	const body = Buffer.concat([
		...(channels.alpha ? [rle(channels.alpha)] : []),
		rle(channels.red),
		rle(channels.green),
		rle(channels.blue),
	]);
	return Buffer.concat([head, body]);
}

/**
 * The tree of a channel and the codes it stands for, written the other way round: the nodes are taken two at
 * a time from the lowest count up, out of a list that keeps its own order among counts that stand equal, and
 * a byte's code is the way from the root down to it, a right step written as a set bit. This mirrors the
 * rules of the reader rather than the reader itself.
 */
function treeOf(frequencies: number[]): number[] {
	const nodes = Array.from({ length: NODES }, () => ({
		frequency: 0,
		left: 0,
		right: 0,
	}));
	const order: number[] = [];
	for (let leaf = 0; leaf < LEAVES; leaf += 1) {
		const node = nodes[leaf];
		if (node) node.frequency = frequencies[leaf] ?? 0;
		let at = 0;
		while (at < order.length) {
			const other = nodes[order[at] ?? 0];
			if (other && other.frequency > (node?.frequency ?? 0)) break;
			at += 1;
		}
		order.splice(at, 0, leaf);
	}
	let last = LEAVES;
	while (order.length > 1) {
		const left = order.shift() ?? 0;
		const right = order.shift() ?? 0;
		const node = nodes[last];
		if (!node) break;
		node.frequency =
			(nodes[left]?.frequency ?? 0) + (nodes[right]?.frequency ?? 0);
		node.left = left;
		node.right = right;
		let at = 0;
		while (at < order.length) {
			const other = nodes[order[at] ?? 0];
			if (other && other.frequency > node.frequency) break;
			at += 1;
		}
		order.splice(at, 0, last);
		last += 1;
	}
	return nodes.flatMap((node) => [node.left, node.right]);
}

function codesOf(tree: number[]): (number[] | undefined)[] {
	const codes: (number[] | undefined)[] = Array.from({ length: LEAVES });
	const walk = (node: number, path: number[]): void => {
		if (node <= 0xff) {
			codes[node] = path;
			return;
		}
		const left = tree[node * 2] ?? 0;
		const right = tree[node * 2 + 1] ?? 0;
		walk(left, [...path, 0]);
		walk(right, [...path, 1]);
	};
	walk(ROOT, []);
	return codes;
}

/** A channel packed with a tree of its own: its head, its table of counts and the bits of its bytes. */
function huffmanChannel(values: number[], frequencies?: number[]): Buffer {
	const counts = frequencies ?? Array.from({ length: LEAVES }, () => 0);
	if (!frequencies) {
		for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
	}
	const tree = treeOf(counts);
	const codes = codesOf(tree);
	const bits: number[] = [];
	for (const value of values) {
		const code = codes[value];
		if (!code) throw new Error(`no code for ${value}`);
		bits.push(...code);
	}
	const packed = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	bits.forEach((bit, index) => {
		if (0 === bit) return;
		const at = Math.trunc(index / 8);
		packed[at] = (packed[at] ?? 0) | (1 << (index % 8));
	});
	const head = Buffer.alloc(8 + LEAVES * 4, 0x00);
	head.writeInt32LE(values.length, 0);
	head.writeInt32LE(packed.length, 4);
	for (let leaf = 0; leaf < LEAVES; leaf += 1) {
		head.writeUInt32LE(counts[leaf] ?? 0, 8 + leaf * 4);
	}
	return Buffer.concat([head, packed]);
}

/**
 * A channel packed with a walk of its own: the bytes a tree of its own unfolds to open with a word the ninth
 * byte of which the walk watches for, and behind it stand the bytes and copies themselves.
 */
function lz77Channel(values: number[], special: number): Buffer {
	const parts: number[] = Array.from({ length: 12 }, () => 0);
	parts[8] = special;
	for (const step of values) parts.push(step);
	const packed = Buffer.from(parts);
	return huffmanChannel([...packed]);
}

async function extract(data: Buffer) {
	const handle = await tmrHiroGrdImageFormat.open(
		new BufferByteSource(data),
		"picture.grd",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no picture");
	return image;
}

describe("Tmr-Hiro ADV System image", () => {
	it("tells a picture of its own by the four lengths of its head", () => {
		const data = picture(
			{ red: [1, 2, 3, 4], green: [1, 2, 3, 4], blue: [1, 2, 3, 4] },
			1,
			24,
		);
		const layout = readTmrHiroGrdLayout(data);
		expect(layout).toBeDefined();
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		// The place of the picture inside the screen it was drawn on stands in its head as well.
		expect(layout?.offsetX).toBe(1);
		expect(layout?.offsetY).toBe(4 - 4);

		expect(
			readTmrHiroGrdLayout(
				picture(
					{ red: [1, 2, 3, 4], green: [1, 2, 3, 4], blue: [1, 2, 3, 4] },
					1,
					16,
				),
			),
		).toBeUndefined();
		const wordless = Buffer.from(data);
		wordless[1] = 3;
		expect(readTmrHiroGrdLayout(wordless)).toBeUndefined();
		const short = Buffer.from(data.subarray(0, data.length - 1));
		expect(readTmrHiroGrdLayout(short)).toBeUndefined();
	});

	it("draws the channels of a picture whose rows stand the other way round", async () => {
		const data = picture(
			{
				red: [1, 2, 3, 4],
				green: [10, 20, 30, 40],
				blue: [100, 110, 120, 130],
			},
			1,
			24,
		);
		const image = await extract(data);
		expect(image.width).toBe(2);
		expect(image.height).toBe(2);
		// The rows of a channel are taken from its last one up, and every channel fills its own byte.
		expect([...image.pixels]).toEqual([
			120, 30, 3, 130, 40, 4, 100, 10, 1, 110, 20, 2,
		]);
	});

	it("draws a picture of thirty two bits with the alpha channel in the fourth byte", async () => {
		const data = picture(
			{
				alpha: [5, 6, 7, 8],
				red: [1, 2, 3, 4],
				green: [10, 20, 30, 40],
				blue: [100, 110, 120, 130],
			},
			1,
			32,
		);
		const image = await extract(data);
		expect([...image.pixels]).toEqual([
			120, 30, 3, 7, 130, 40, 4, 8, 100, 10, 1, 5, 110, 20, 2, 6,
		]);
	});

	it("draws a picture of thirty two bits whose head names no alpha channel", async () => {
		const data = picture(
			{
				red: [1, 2, 3, 4],
				green: [10, 20, 30, 40],
				blue: [100, 110, 120, 130],
			},
			1,
			32,
		);
		const image = await extract(data);
		expect([...image.pixels]).toEqual([
			120, 30, 3, 0, 130, 40, 4, 0, 100, 10, 1, 0, 110, 20, 2, 0,
		]);
	});

	it("unfolds the bytes a tree of its own stands for", () => {
		// A byte of its own outweighs every other, so it stands one step from the root of the tree.
		const frequencies = Array.from({ length: LEAVES }, () => 0);
		frequencies[0x41] = 1000;
		frequencies[0x42] = 1;
		const packed = huffmanChannel([0x41, 0x41, 0x42, 0x41], frequencies);
		const output = Buffer.alloc(4, 0x00);
		expect(unpackTmrHiroGrdHuffman(packed, 0, output)).toBe(4);
		expect([...output]).toEqual([0x41, 0x41, 0x42, 0x41]);
	});

	it("unfolds a channel whose bytes stand behind a walk of their own", async () => {
		// The walk watches for the value it names in the ninth byte of the bytes a tree of its own unfolds
		// to: a byte of that value stands for a copy whose place and count follow it, a place of that value
		// again for the byte itself, and every other byte as it stands.
		const special = 0xf0;
		const redSteps = [0x41, 0x42, 0x43, special, special, special, 0x03, 0x04];
		const greenSteps = [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17];
		const blueSteps = [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27];
		const width = 8;
		const head = Buffer.alloc(HEAD_SIZE, 0x00);
		head.writeUInt16LE(0x0101, 0);
		head[1] = 0xa2;
		head.writeUInt16LE(8, 2);
		head.writeUInt16LE(4, 4);
		head.writeUInt16LE(24, 6);
		head.writeUInt16LE(0, 8);
		head.writeUInt16LE(width, 0x0a);
		head.writeUInt16LE(0, 0x0c);
		head.writeUInt16LE(1, 0x0e);
		const channels = [redSteps, greenSteps, blueSteps].map((steps) =>
			lz77Channel(steps, special),
		);
		head.writeInt32LE(0, 0x10);
		head.writeInt32LE(channels[0]?.length ?? 0, 0x14);
		head.writeInt32LE(channels[1]?.length ?? 0, 0x18);
		head.writeInt32LE(channels[2]?.length ?? 0, 0x1c);
		const data = Buffer.concat([head, ...(channels as Buffer[])]);
		expect(readTmrHiroGrdLayout(data)).toBeDefined();

		const image = await extract(data);
		expect(image.width).toBe(width);
		expect(image.height).toBe(1);
		// The red channel stands as three bytes of its own, the special value as itself, and then a copy of
		// four bytes from three back - which reaches into the bytes the copy has just written and runs on.
		expect([...image.pixels]).toEqual([
			0x20, 0x10, 0x41, 0x21, 0x11, 0x42, 0x22, 0x12, 0x43, 0x23, 0x13, 0xf0,
			0x24, 0x14, 0x42, 0x25, 0x15, 0x43, 0x26, 0x16, 0xf0, 0x27, 0x17, 0x42,
		]);
	});

	it("turns away a file that does not open with its head", async () => {
		const wanted = picture(
			{ red: [1, 2, 3, 4], green: [1, 2, 3, 4], blue: [1, 2, 3, 4] },
			1,
			24,
		);
		const wrong = Buffer.from("not a picture at all, not at all");
		expect(
			await tmrHiroGrdImageFormat.detect?.(
				new BufferByteSource(wrong),
				"file.grd",
			),
		).toBe(false);
		expect(
			await tmrHiroGrdImageFormat.detect?.(
				new BufferByteSource(wanted),
				"picture.grd",
			),
		).toBe(true);
		expect(
			await tmrHiroGrdImageFormat.detect?.(new BufferByteSource(wanted)),
		).toBe(false);
	});

	it("writes one value over and over as a run of its own", () => {
		expect([...rleRepeat(0x77, 4)]).toEqual([0x84, 0x77]);
	});
});
