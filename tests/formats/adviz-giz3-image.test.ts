import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	advizGiz3ImageFormat,
	readGiz3Layout,
	readGiz3Palette,
	readGiz3Tree,
	unpackGiz3Tokens,
} from "../../packages/formats/src/adviz/giz3-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0x10;
const STRIP_SIZE = 0x200;
const PLACES_PER_STRIP = 8;
const LEAF_BIT = 0x800;
const RUN_TOKEN = 0x10;
const RUN_BIAS = 2;
/** The token the walk of a plane of a picture of this engine is written with. */
type Token = number;

interface Node {
	symbol?: number;
	left?: Node;
	right?: Node;
}

/**
 * The tree of the tokens of a picture, written the other way round from the reader: the nodes of it are laid
 * out so that the two of a node stand side by side and the root stands last, which is where the reader looks
 * for it. The codes are read off the very tree that is laid out. This mirrors the rules of the reader.
 */
function buildTree(symbols: number[]): {
	head: Buffer;
	codes: Map<number, number[]>;
} {
	let level: Node[] = symbols.map((symbol) => ({ symbol }));
	while (level.length > 1) {
		const next: Node[] = [];
		for (let at = 0; at + 1 < level.length; at += 2) {
			const left = level[at];
			const right = level[at + 1];
			if (!left || !right) throw new Error("a tree of two stands of two");
			next.push({ left, right });
		}
		if (1 === level.length % 2) next.push(level[level.length - 1] as Node);
		level = next;
	}
	const root = level[0] as Node;
	const values: number[] = [];
	const lay = (node: Node): number => {
		if (undefined !== node.symbol) return LEAF_BIT | node.symbol;
		const left = lay(node.left as Node);
		const right = lay(node.right as Node);
		const at = values.length;
		values.push(left, right);
		return 2 * at + 2;
	};
	lay(root);
	const codes = new Map<number, number[]>();
	const walk = (node: Node, path: number[]): void => {
		if (undefined !== node.symbol) {
			codes.set(node.symbol, path);
			return;
		}
		walk(node.left as Node, [...path, 0]);
		walk(node.right as Node, [...path, 1]);
	};
	walk(root, []);
	const records = Buffer.alloc((values.length / 2) * 3, 0x00);
	for (let at = 0; at < values.length; at += 2) {
		const first = values[at] ?? 0;
		const second = values[at + 1] ?? 0;
		records.writeUInt16LE(
			(first & 0xfff) | ((second & 0xf) << 12),
			(at / 2) * 3,
		);
		records[(at / 2) * 3 + 2] = (second >> 4) & 0xff;
	}
	const head = Buffer.alloc(2 + records.length, 0x00);
	head.writeUInt16LE(head.length, 0);
	records.copy(head, 2);
	return { head, codes };
}

/** The bits of a picture, written from the highest bit of every word down. */
function bitsOf(bits: number[]): Buffer {
	const parts: Buffer[] = [];
	for (let at = 0; at < bits.length; at += 16) {
		let value = 0;
		for (let bit = 0; bit < 16; bit += 1) {
			value = (value << 1) | (bits[at + bit] ?? 0);
		}
		const word = Buffer.alloc(2, 0x00);
		word.writeUInt16LE(value, 0);
		parts.push(word);
	}
	return Buffer.concat(parts);
}

interface Wanted {
	width: number;
	height: number;
	planeMap: number;
	/** The places every plane of every half of the picture is written with, in the order the reader asks. */
	planes: Token[][];
	palette?: number[];
}

/**
 * A picture of this engine: its head, its colour map when it carries one, the tree of its tokens and the bits
 * behind it. The planes stand in the order the reader walks them: strip by strip, half by half, plane by plane,
 * every plane the map of the places does not name.
 */
function buildGiz3(wanted: Wanted): Buffer {
	const symbols = new Set<Token>();
	for (const plane of wanted.planes)
		for (const token of plane) symbols.add(token);
	if (0 === symbols.size) symbols.add(0);
	// A tree needs two of them to stand of, so a picture of one token takes another beside it.
	if (1 === symbols.size) symbols.add(symbols.has(0) ? 1 : 0);
	const { head, codes } = buildTree([...symbols].sort((a, b) => a - b));
	const bits: number[] = [];
	for (const plane of wanted.planes) {
		for (const token of plane) {
			const code = codes.get(token);
			if (!code) throw new Error(`the tree stands no code for ${token}`);
			bits.push(...code);
		}
	}
	const top = Buffer.alloc(HEAD_SIZE, 0x00);
	top.write("GIZ3", 0, "latin1");
	top.writeUInt16LE(0x28, 4);
	top.writeUInt16LE(wanted.width / PLACES_PER_STRIP, 6);
	top.writeUInt16LE(wanted.height, 8);
	top[0xc] = wanted.palette ? 1 : 0;
	top[0xe] = wanted.planeMap;
	const parts: Buffer[] = [top];
	if (wanted.palette) parts.push(Buffer.from(wanted.palette));
	parts.push(head, bitsOf(bits));
	return Buffer.concat(parts);
}

async function extract(data: Buffer) {
	const handle = await advizGiz3ImageFormat.open(
		new BufferByteSource(data),
		"picture.giz",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no picture");
	return image;
}

describe("ADVIZ engine image", () => {
	it("reads the head of a picture and where it stands inside its screen", () => {
		const data = buildGiz3({ width: 8, height: 4, planeMap: 0xf, planes: [] });
		const layout = readGiz3Layout(data);
		expect(layout?.width).toBe(8);
		expect(layout?.height).toBe(4);
		expect(layout?.offsetX).toBe((0x28 % 0x50) * 8);
		expect(layout?.offsetY).toBe(0);
		expect(layout?.planeMap).toBe(0xf);
		expect(layout?.hasPalette).toBe(false);
		const wrong = Buffer.from(data);
		wrong.write("GIZ2", 0, "latin1");
		expect(readGiz3Layout(wrong)).toBeUndefined();
		expect(readGiz3Layout(data.subarray(0, 0x0c))).toBeUndefined();
	});

	it("draws a picture of nothing when every place of it stands still", async () => {
		// A plane the map of the places names stands as the strip before it left it, and the first strip of a
		// picture is written with nothing at all.
		const data = buildGiz3({ width: 8, height: 4, planeMap: 0xf, planes: [] });
		const image = await extract(data);
		expect(image.width).toBe(8);
		expect(image.height).toBe(4);
		expect([...image.pixels].every((place) => 0 === place)).toBe(true);
	});

	it("reads the tree of the tokens of a picture, and its codes", () => {
		const { head, codes } = buildTree([0x2, RUN_TOKEN]);
		const tree = readGiz3Tree(head, 0);
		// A tree of two tokens stands of the two of them side by side, and the root reaches the first with a
		// clear bit and the second with a set one.
		expect(tree.root).toBe(0);
		expect(tree.table).toEqual([LEAF_BIT | 0x2, LEAF_BIT | RUN_TOKEN]);
		expect(codes.get(0x2)).toEqual([0]);
		expect(codes.get(RUN_TOKEN)).toEqual([1]);
	});

	it("writes a place of its own into the plane and draws the two halves of a strip together", () => {
		// One strip of one row, its own place written in both halves of it: the first half names the places
		// above the second, and the place of the picture stands in the place of the plane the map names.
		const data = buildGiz3({
			width: 8,
			height: 1,
			planeMap: 0xe,
			planes: [[0x2], [0x2]],
		});
		const layout = readGiz3Layout(data);
		if (!layout) throw new Error("the head of the fixture stands");
		const { ring, places } = unpackGiz3Tokens(data, layout);
		// The first half of the strip stands at the place of its own, the second at the next one.
		expect([...(ring.subarray(0, 1) as Buffer)]).toEqual([0x2]);
		expect([...(ring.subarray(STRIP_SIZE, STRIP_SIZE + 1) as Buffer)]).toEqual([
			0x2,
		]);
		// Every byte of the picture holds two of its places, the place before the other.
		expect([...places]).toEqual([0x00, 0x10, 0x00, 0x10]);
	});

	it("writes a run of one value and a run that reaches back into itself", () => {
		// A run names the way it is drawn behind the token of it, and how many places it holds, smaller by two,
		// behind that. A run of nothing stands as the places of the plane it stands in.
		const data = buildGiz3({
			width: 8,
			height: 3,
			planeMap: 0xe,
			planes: [
				[0x3, RUN_TOKEN, 0],
				[0x3, RUN_TOKEN + RUN_BIAS, 0],
			],
		});
		const layout = readGiz3Layout(data);
		if (!layout) throw new Error("the head of the fixture stands");
		const { ring } = unpackGiz3Tokens(data, layout);
		// A place of its own and two places of nothing.
		expect([...(ring.subarray(0, 3) as Buffer)]).toEqual([3, 0, 0]);
		// A run of two places that stands as the place behind it does, which is the place of its own.
		expect([...(ring.subarray(STRIP_SIZE, STRIP_SIZE + 3) as Buffer)]).toEqual([
			3, 3, 3,
		]);
	});

	it("reads the colour map of a picture, and hands one over when it carries none", async () => {
		const colours = Array.from({ length: 16 }, (_, at) => [at, 15 - at, at]);
		const data = buildGiz3({
			width: 8,
			height: 4,
			planeMap: 0xf,
			planes: [],
			palette: colours.flat(),
		});
		expect(readGiz3Layout(data)?.hasPalette).toBe(true);
		// The colour map of a picture stands blue, red, green to a colour - the order a bitmap keeps - and
		// every byte of it is spread over the whole of the byte the picture is drawn with.
		const palette = readGiz3Palette(data, 0x10);
		expect([...(palette.subarray(0, 4) as Buffer)]).toEqual([
			0,
			0,
			15 * 0x11,
			0,
		]);
		expect([...(palette.subarray(4, 8) as Buffer)]).toEqual([
			0x11,
			0x11,
			14 * 0x11,
			0,
		]);
		const image = await extract(data);
		const shown = image.palette;
		if (!shown)
			throw new Error("the picture of the fixture stands a colour map");
		expect([...(shown.subarray(0, 4) as Buffer)]).toEqual([0, 0, 15 * 0x11, 0]);
		// A picture without a colour map of its own falls back on the places the reference's viewer hands it.
		const without = await extract(
			buildGiz3({ width: 8, height: 4, planeMap: 0xf, planes: [] }),
		);
		const grey = without.palette;
		if (!grey)
			throw new Error("the picture of the fixture stands a colour map");
		expect([...(grey.subarray(4, 8) as Buffer)]).toEqual([0x11, 0x11, 0x11, 0]);
	});
});
