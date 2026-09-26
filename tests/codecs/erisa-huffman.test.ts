// The adaptive Huffman tree of the Entis engine, against walks built in the test: the counts of the walks
// of the places of a name of the tree, the places of a name of the tree itself, and the counts of the tree
// halved where the count of the root of it stands past the count of the walk of the engine. The tree of the
// engine stands of the walk of the counts of the places of the tree itself, of the two places behind every
// place of the walk of it: the place of a walk of the tree stands of the counts of the places behind it
// (the sibling property of the walk of the counts of the tree), and the places of the names of the tree
// stand of the places of the walk of them.
import { Buffer } from "node:buffer";
import { ErisaHuffmanTree } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const HUFFMAN_ROOT = 0x200;
const HUFFMAN_NULL = 0x8000;
const HUFFMAN_MAX = 0x4000;
const HUFFMAN_ESCAPE = 0x7fffffff;
const CODE_FLAG = -2147483648;

/** Whether a place of the tree stands of a name rather than of a walk of the tree. */
function isName(code: number): boolean {
	return 0 !== (code & CODE_FLAG);
}

/** The name of a place of a name of the tree, of the escape place of it. */
function nameOf(node: { childCode: number }): number {
	return node.childCode & ~CODE_FLAG;
}

/**
 * The walk of the places of the tree, of the place of the root of it: every place of the walk of the tree
 * stands of the counts of the two places behind it, and every place behind a walk of the tree stands of the
 * place of the walk in front of it. The names of the places of the walk of the tree stand handed over as
 * well, of the place of every one of them.
 */
function walkTree(
	tree: ErisaHuffmanTree,
	at: number,
	names: Map<number, number>,
): number {
	const node = tree.tree[at];
	if (!node) throw new Error(`no place of the tree at ${at}`);
	if (isName(node.childCode)) {
		names.set(nameOf(node), at);
		return node.weight;
	}
	const left = node.childCode;
	const right = node.childCode + 1;
	const leftWeight = walkTree(tree, left, names);
	const rightWeight = walkTree(tree, right, names);
	expect(node.weight).toBe((leftWeight + rightWeight) & 0xffff);
	expect(tree.tree[left]?.parent).toBe(at);
	expect(tree.tree[right]?.parent).toBe(at);
	return node.weight;
}

function checkTree(tree: ErisaHuffmanTree): void {
	walkTree(tree, HUFFMAN_ROOT, new Map());
}

/** The places of the names of the tree, of the walk of the tree from the place of the root of it. */
function namesOfTree(tree: ErisaHuffmanTree): Map<number, number> {
	const names = new Map<number, number>();
	walkTree(tree, HUFFMAN_ROOT, names);
	return names;
}

/** The counts of the walks of the places of the tree, one place a count. */
function walk(tree: ErisaHuffmanTree, places: readonly number[]): void {
	for (const place of places) {
		const node = tree.tree[place];
		if (!node) throw new Error(`no place of the tree at ${place}`);
		tree.increaseOccuredCount(place);
	}
}

describe("Entis adaptive Huffman tree", () => {
	it("stands of the walk of the counts of the places of it", () => {
		const tree = new ErisaHuffmanTree();
		// The first place of a name of the tree stands of the count of the walk of the escape place of it.
		tree.addNewEntry(0x41);
		checkTree(tree);
		expect(tree.escape).toBe(HUFFMAN_ROOT - 1);
		expect(tree.symbolLookup[0x41]).toBe(HUFFMAN_ROOT - 2);
		// Every count of the place of the name of the tree stands of the place of it in the walk of the tree.
		walk(tree, new Array(0x41).fill(HUFFMAN_ROOT - 2));
		checkTree(tree);
		// The count of the root of the tree stands of the counts of the two places of the walk of it: the
		// place of the name of the tree, and the escape place behind it.
		expect(tree.tree[HUFFMAN_ROOT]?.weight).toBe(0x42 + 1);
		expect(namesOfTree(tree).get(0x41)).toBe(tree.symbolLookup[0x41]);
		expect(namesOfTree(tree).get(HUFFMAN_ESCAPE)).toBe(tree.escape);
	});

	it("stands of the counts of the walks of the places of it", () => {
		// A walk of the counts of the places of the tree, of every place of a name of it twice over, from
		// the first place of the walk of the tree up. Every count of the walk of the tree stands of the
		// counts of the two places behind it, and the walk of the counts of the tree stands of the counts of
		// the places of it (a walk of the tree of the counts of it stands of the place of the name of the
		// tree of the count of the walk of it in front of every place of it).
		const tree = new ErisaHuffmanTree();
		for (let name = 0; name < 0x40; name += 1) {
			tree.addNewEntry(name);
			checkTree(tree);
		}
		// The place of a name of the tree stands of the walk of the tree of it, so the place of it stands of
		// the walk of the tree every count of the walk of it: the walk of the engine stands of the name of
		// the tree behind the walk of the counts of it every time as well.
		for (let round = 0; round < 8; round += 1) {
			for (let name = 0x3f; name >= 0; name -= 1) {
				const place = tree.symbolLookup[name];
				if (place === undefined || place === HUFFMAN_NULL) {
					throw new Error(`no place of the name ${name}`);
				}
				tree.increaseOccuredCount(place);
			}
		}
		checkTree(tree);
		// The counts of the places of the names of the tree stand of the walk of the tree, of the count of
		// the root of it of the counts of every one of them.
		let total = 0;
		for (const place of namesOfTree(tree).values()) {
			total += tree.tree[place]?.weight ?? 0;
		}
		expect(tree.tree[HUFFMAN_ROOT]?.weight).toBe(total & 0xffff);
	});

	it("stands of the counts of the tree halved where the count of the root stands past it", () => {
		const tree = new ErisaHuffmanTree();
		tree.addNewEntry(0x7f);
		const place = tree.symbolLookup[0x7f];
		if (place === undefined)
			throw new Error("no place of the name of the tree");
		// The count of the walk of the engine stands of the count of the root of the tree of the walk of the
		// counts of it: the counts of the tree stand of the places of it halved where that count stands past.
		for (let at = 0; at < HUFFMAN_MAX + 8; at += 1) {
			tree.increaseOccuredCount(place);
		}
		checkTree(tree);
		const weight = tree.tree[HUFFMAN_ROOT]?.weight ?? 0;
		expect(weight).toBeLessThan(HUFFMAN_MAX);
		expect(weight).toBeGreaterThan(0);
		expect(namesOfTree(tree).get(0x7f)).toBe(tree.symbolLookup[0x7f]);
	});

	it("stands of the places of a name of the tree, of the walk of the tree itself", () => {
		// Every place of a name of the tree stands of the places of the walk of the tree of it, and the walk
		// of the places of the tree stands of the names of them.
		const tree = new ErisaHuffmanTree();
		for (let name = 0; name < 0x100; name += 1) {
			tree.addNewEntry(name);
		}
		checkTree(tree);
		const names = namesOfTree(tree);
		for (let name = 0; name < 0x100; name += 1) {
			expect(tree.symbolLookup[name]).toBe(names.get(name));
		}
		expect(tree.escape).toBe(names.get(HUFFMAN_ESCAPE));
		expect(tree.treePointer).toBe(0);
	});

	it("keeps an unused tree initialized", () => {
		// A tree that stands of no place of a name at all stands of the place of the root of it alone.
		const tree = new ErisaHuffmanTree();
		expect(tree.tree.length).toBe(0x201);
		expect(tree.symbolLookup.length).toBe(0x100);
		expect(tree.escape).toBe(HUFFMAN_NULL);
		expect(tree.treePointer).toBe(HUFFMAN_ROOT);
		expect(tree.tree[HUFFMAN_ROOT]?.childCode).toBe(HUFFMAN_NULL);
		expect(
			Buffer.from([tree.treePointer & 0xff, HUFFMAN_NULL & 0xff]).length,
		).toBe(2);
	});
});
