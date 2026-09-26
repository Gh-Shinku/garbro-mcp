// The adaptive Huffman tree of the Entis engine, of the reference `ArcFormats/Entis/EriReader.cs`
// (`Erina`, `HuffmanNode`, `HuffmanTree`).
//
// The tree stands of a run of the places of it (0x201 of them), of the places of a name of a place of the
// walk of it (0x100 of them) and of the counts of the places of the walk of it. Every place of the tree
// stands of the count of the walks of it, of the place of the tree in front of it and of the name of the
// kind of the place of it: the name of a place of a name of the tree (the *leaves*, of the highest place of
// a count of the name set) or the count of the places of the two places behind it (the places of the walk
// of the tree itself).
//
// The engine stands of the walk of the tree of the counts of the walks of it (`IncreaseOccuredCount`, of
// the places of a name of the walk of it moved over the places of the tree of the count of them), of the
// places of the tree of the counts of it halved where the count of the root of the tree stands past the
// count of the walk of the engine (`HalfAndRebuild`), and of the places of a name of the tree itself
// (`AddNewEntry`). The places of the walk of the tree stand of the place of the count of the root of it
// every place of it, which is the walk of the counts of the walk of the engine the counts of the tree
// behind it stand of.

/** The places of the tree of the engine. */
const HUFFMAN_ROOT = 0x200;
const HUFFMAN_NULL = 0x8000;
const HUFFMAN_MAX = 0x4000;
const HUFFMAN_ESCAPE = 0x7fffffff;
/** The highest place of a count of the name of a place of the tree: the place of a name rather than a walk. */
const CODE_FLAG = -2147483648;
const SYMBOL_COUNT = 0x100;
const TREE_PLACES = 0x201;
const PLACE_MASK = 0xffff;
const PLACE_NAMES = 0xff;

/** A place of the tree of the engine. */
export interface ErisaHuffmanNode {
	weight: number;
	parent: number;
	childCode: number;
}

function nodeOf(weight = 0, parent = 0, childCode = 0): ErisaHuffmanNode {
	return { weight, parent, childCode };
}

/** The tree of the engine, of the walks of the counts of its places and of the names of them. */
export class ErisaHuffmanTree {
	tree: ErisaHuffmanNode[];
	symbolLookup: number[];
	escape: number;
	treePointer: number;

	constructor() {
		this.tree = [];
		this.symbolLookup = [];
		this.escape = HUFFMAN_NULL;
		this.treePointer = HUFFMAN_ROOT;
		this.initialize();
	}

	/** `HuffmanTree.Initialize`: the tree of no place of a name at all. */
	initialize(): void {
		this.tree = [];
		for (let at = 0; at < TREE_PLACES; at += 1) this.tree.push(nodeOf());
		this.symbolLookup = [];
		for (let at = 0; at < SYMBOL_COUNT; at += 1) {
			this.symbolLookup.push(HUFFMAN_NULL);
		}
		this.escape = HUFFMAN_NULL;
		this.treePointer = HUFFMAN_ROOT;
		const root = this.tree[HUFFMAN_ROOT];
		if (root) {
			root.weight = 0;
			root.parent = HUFFMAN_NULL;
			root.childCode = HUFFMAN_NULL;
		}
	}

	/** `HuffmanTree.RecountOccuredCount`: the count of a place of the walk of the tree. */
	private recount(parent: number): void {
		const node = this.tree[parent];
		if (!node) return;
		const child = node.childCode;
		node.weight =
			((this.tree[child]?.weight ?? 0) + (this.tree[child + 1]?.weight ?? 0)) &
			PLACE_MASK;
	}

	/** The place of the tree the walk of a name of the tree hands over, of a place of it. */
	private placeOfNode(place: number, other: number): void {
		const node = this.tree[place];
		if (!node) return;
		if (0 === (node.childCode & CODE_FLAG)) {
			// The place stands of a walk of the tree rather than of a name: the places behind it stand of it.
			const child = node.childCode;
			const left = this.tree[child];
			const right = this.tree[child + 1];
			if (left) left.parent = other & PLACE_MASK;
			if (right) right.parent = other & PLACE_MASK;
			return;
		}
		const code = node.childCode & ~CODE_FLAG;
		if (HUFFMAN_ESCAPE !== code) {
			this.symbolLookup[code & PLACE_NAMES] = other;
		} else {
			this.escape = other;
		}
	}

	/** `HuffmanTree.Normalize`: the place of the count of a name of the tree over the places of it. */
	private normalize(place: number): void {
		let entry = place;
		while (entry < HUFFMAN_ROOT) {
			let swap = entry + 1;
			const weight = this.tree[entry]?.weight ?? 0;
			while (swap < HUFFMAN_ROOT) {
				if ((this.tree[swap]?.weight ?? 0) >= weight) break;
				swap += 1;
			}
			swap -= 1;
			if (entry === swap) {
				entry = this.tree[entry]?.parent ?? HUFFMAN_NULL;
				this.recount(entry);
				continue;
			}
			const entryParent = this.tree[entry]?.parent ?? HUFFMAN_NULL;
			const swapParent = this.tree[swap]?.parent ?? HUFFMAN_NULL;
			this.placeOfNode(entry, swap);
			this.placeOfNode(swap, entry);
			const left = nodeOf(
				this.tree[entry]?.weight ?? 0,
				0,
				this.tree[entry]?.childCode ?? 0,
			);
			const right = nodeOf(
				this.tree[swap]?.weight ?? 0,
				0,
				this.tree[swap]?.childCode ?? 0,
			);
			this.tree[swap] = { ...left, parent: swapParent };
			this.tree[entry] = { ...right, parent: entryParent };
			this.recount(swapParent);
			entry = swapParent;
		}
	}

	/** `HuffmanTree.IncreaseOccuredCount`: the count of the walk of a place of a name of the tree. */
	increaseOccuredCount(place: number): void {
		const node = this.tree[place];
		if (!node) return;
		node.weight = (node.weight + 1) & PLACE_MASK;
		this.normalize(place);
		if ((this.tree[HUFFMAN_ROOT]?.weight ?? 0) >= HUFFMAN_MAX) {
			this.halfAndRebuild();
		}
	}

	/** `HuffmanTree.AddNewEntry`: the places of a name of the walk of the tree. */
	addNewEntry(code: number): void {
		if (this.treePointer > 0) {
			this.treePointer -= 2;
			const at = this.treePointer;
			const created = this.tree[at];
			if (!created) return;
			created.weight = 1;
			created.childCode = CODE_FLAG | code | 0;
			this.symbolLookup[code & PLACE_NAMES] = at;
			const root = this.tree[HUFFMAN_ROOT];
			if (!root) return;
			if (root.childCode !== HUFFMAN_NULL) {
				const parent = this.tree[at + 2];
				const child = this.tree[at + 1];
				if (!parent || !child) return;
				child.weight = parent.weight;
				child.parent = parent.parent;
				child.childCode = parent.childCode;
				if (0 !== (child.childCode & CODE_FLAG)) {
					const name = child.childCode & ~CODE_FLAG;
					if (HUFFMAN_ESCAPE !== name) {
						this.symbolLookup[name & PLACE_NAMES] = at + 1;
					} else {
						this.escape = at + 1;
					}
				}
				parent.weight = (created.weight + child.weight) & PLACE_MASK;
				parent.parent = child.parent;
				parent.childCode = at;
				created.parent = (at + 2) & PLACE_MASK;
				child.parent = (at + 2) & PLACE_MASK;
				this.normalize(at + 2);
				return;
			}
			created.parent = HUFFMAN_ROOT;
			this.escape = at + 1;
			const escapeNode = this.tree[this.escape];
			if (escapeNode) {
				escapeNode.weight = 1;
				escapeNode.parent = HUFFMAN_ROOT;
				escapeNode.childCode = CODE_FLAG | HUFFMAN_ESCAPE | 0;
			}
			root.weight = 2;
			root.childCode = at;
			return;
		}
		let entry = this.tree[this.treePointer];
		if (entry?.childCode === (CODE_FLAG | HUFFMAN_ESCAPE | 0)) {
			entry = this.tree[this.treePointer + 1];
		}
		if (entry) entry.childCode = CODE_FLAG | code | 0;
	}

	/** `HuffmanTree.HalfAndRebuild`: the counts of the tree halved, and the tree stood of them again. */
	halfAndRebuild(): void {
		let next = HUFFMAN_ROOT;
		for (let at = HUFFMAN_ROOT - 1; at >= this.treePointer; at -= 1) {
			const node = this.tree[at];
			if (!node) continue;
			if (0 !== (node.childCode & CODE_FLAG)) {
				node.weight = ((node.weight + 1) >> 1) & PLACE_MASK;
				const to = this.tree[next];
				if (to) {
					to.weight = node.weight;
					to.parent = node.parent;
					to.childCode = node.childCode;
				}
				next -= 1;
			}
		}
		next += 1;
		let at = this.treePointer;
		for (;;) {
			const source = this.tree[next];
			const source2 = this.tree[next + 1];
			const left = this.tree[at];
			const right = this.tree[at + 1];
			if (!left || !right) return;
			if (source) {
				left.weight = source.weight;
				left.parent = source.parent;
				left.childCode = source.childCode;
			}
			if (source2) {
				right.weight = source2.weight;
				right.parent = source2.parent;
				right.childCode = source2.childCode;
			}
			next += 2;
			if (0 === (left.childCode & CODE_FLAG)) {
				const child = left.childCode;
				const first = this.tree[child];
				const second = this.tree[child + 1];
				if (first) first.parent = at & PLACE_MASK;
				if (second) second.parent = at & PLACE_MASK;
			} else {
				const name = left.childCode & ~CODE_FLAG;
				if (HUFFMAN_ESCAPE === name) this.escape = at;
				else this.symbolLookup[name & PLACE_NAMES] = at;
			}
			if (0 === (right.childCode & CODE_FLAG)) {
				const child = right.childCode;
				const first = this.tree[child];
				const second = this.tree[child + 1];
				if (first) first.parent = (at + 1) & PLACE_MASK;
				if (second) second.parent = (at + 1) & PLACE_MASK;
			} else {
				const name = right.childCode & ~CODE_FLAG;
				if (HUFFMAN_ESCAPE === name) this.escape = at + 1;
				else this.symbolLookup[name & PLACE_NAMES] = at + 1;
			}
			const weight = (left.weight + right.weight) & PLACE_MASK;
			if (next <= HUFFMAN_ROOT) {
				let place = next;
				for (;;) {
					if (weight <= (this.tree[place]?.weight ?? 0)) {
						const target = this.tree[place - 1];
						if (target) {
							target.weight = weight;
							target.childCode = at;
						}
						break;
					}
					const to = this.tree[place - 1];
					const from = this.tree[place];
					if (to && from) {
						to.weight = from.weight;
						to.parent = from.parent;
						to.childCode = from.childCode;
					}
					place += 1;
					if (place > HUFFMAN_ROOT) {
						const root = this.tree[HUFFMAN_ROOT];
						if (root) {
							root.weight = weight;
							root.childCode = at;
						}
						break;
					}
				}
				next -= 1;
			} else {
				const root = this.tree[HUFFMAN_ROOT];
				if (root) {
					root.weight = weight;
					root.parent = HUFFMAN_NULL;
					root.childCode = at;
				}
				left.parent = HUFFMAN_ROOT;
				right.parent = HUFFMAN_ROOT;
				return;
			}
			at += 2;
		}
	}
}
