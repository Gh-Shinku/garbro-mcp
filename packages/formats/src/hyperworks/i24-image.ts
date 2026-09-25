// Format reference: GARbro "Legacy/HyperWorks/ImageI24.cs", classes `I24Format` and `I24Decoder`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	BIT_MASK,
	SHIFT_B,
	SHIFT_G,
	SHIFT_R,
	SHIFT_TABLE,
} from "./i24-tables.js";

const HEAD_SIZE = 0x18;
const DATA_AT = 0x18;
const BITS_24 = 24;
const VERSION_A = 0x41;
const VERSION_SPACE = 0x20;
/** `I24Format.Signature` of the two kinds of picture of the engine. */
const MARK = [0x49, 0x32, 0x34];
const BYTE = 0xff;
/** The count of the tokens of a walk of the engine before the tables of the walk stand again. */
const TOKEN_COUNT = 0x3fff;
/** The counts of the three tables of the walk of the engine and of the places of the file of them. */
const TABLES = [
	{ nodes: 342, links: 684 },
	{ nodes: 11, links: 22 },
	{ nodes: 251, links: 502 },
];
const DICT_SIZE = 256;
const TOKEN_RUN = 216;
const RUN_BASE = 214;
/** The place of the file of the walk of a colour of the engine of no places of the file of a colour. */
const EXTENDED = -3;
const BITS_OF_PLACE = 8;
const HIGH_PLACES = 16;
const LINK_NONE = -1;

interface Node {
	/** The index of the node behind this one, of `LINK_NONE` at the end of the walk of the tree. */
	next: number;
	depth: number;
	token: number;
}

interface Link {
	children: [Link | null, Link | null];
	token: number;
}

interface DictRec {
	link: Link | null;
	bitSize: number;
	token: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw invalidPicture("A picture of the engine of no places of the file");
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

/** The head of a picture of the engine, of the kind of the walk of the picture of it. */
export interface I24Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	version: number;
}

/** `I24Format.ReadMetaData`: the head of a picture of the engine, of the walk of the places of the file. */
export function readI24Layout(data: Buffer): I24Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!MARK.every((value, index) => data[index] === value)) return undefined;
	const version = data[3] ?? 0;
	if (VERSION_A !== version && VERSION_SPACE !== version) return undefined;
	const bitsPerPixel = data.readInt16LE(0x10);
	if (BITS_24 !== bitsPerPixel) return undefined;
	const width = data.readUInt16LE(0x0c);
	const height = data.readUInt16LE(0x0e);
	if (0 === width || 0 === height) return undefined;
	return { width, height, bitsPerPixel, version };
}

/**
 * `I24Decoder`'s walk of the places of the file of a picture of the engine: the tables of the walk of
 * the engine stand again of every 0x3FFF tokens of the places of the file of it.
 */
class I24Decoder {
	private at = DATA_AT;
	private bits = 0;
	private bitCount = 0;
	private byteCount = 0;
	private cacheEmpty = true;
	private readonly tables = TABLES.map((table) => ({
		nodes: Array.from({ length: table.nodes }, (_, token) => ({
			next: LINK_NONE,
			depth: 0,
			token,
		})),
		links: [] as Link[],
		linkLimit: table.links,
		dict: Array.from({ length: DICT_SIZE }, () => ({
			link: null,
			bitSize: 0,
			token: 0,
		})) as DictRec[],
	}));

	constructor(
		private readonly data: Buffer,
		private readonly layout: I24Layout,
	) {}

	private readUInt8(): number {
		if (this.at >= this.data.length) return BYTE;
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	/** `I24Decoder.GetNextBit`. */
	private nextBit(): number {
		this.bits <<= 1;
		this.bitCount -= 1;
		if (0 === this.bitCount) {
			this.bits |= this.readUInt8();
			this.bitCount = BITS_OF_PLACE;
		}
		return (this.bits >> HIGH_PLACES) & 1;
	}

	/** `I24Decoder.GetBits`. */
	private getBits(count: number): number {
		let n = count;
		if (count >= this.bitCount) {
			this.bits <<= this.bitCount;
			n = count - this.bitCount;
			this.bits |= this.readUInt8();
			this.bitCount = BITS_OF_PLACE;
		}
		if (n >= BITS_OF_PLACE) {
			this.bits <<= BITS_OF_PLACE;
			this.bits |= this.readUInt8();
			n -= BITS_OF_PLACE;
		}
		this.bits <<= n;
		this.bitCount -= n;
		return (this.bits >> HIGH_PLACES) & (BIT_MASK[count] ?? 0);
	}

	/** `I24Decoder.GetBitLength`: a count of the places of the file of the walk of the engine. */
	private getBitLength(): number {
		if (this.nextBit() !== 0) return 0;
		let i = 0;
		do {
			i += 1;
		} while (0 === this.nextBit());
		return (1 << i) | this.getBits(i);
	}

	/** `I24Decoder.InitTree`: the places of the file of the walk of the tree of the engine. */
	private initTree(nodes: Node[]): void {
		for (const node of nodes) {
			node.next = LINK_NONE;
			node.depth = 0;
		}
		let length = this.getBitLength();
		if (length <= 1) return;
		length -= 1;
		const fieldWidth = this.getBits(3);
		let at = 0;
		while (length > 0) {
			if (0 !== this.nextBit()) {
				if (at >= nodes.length) {
					throw invalidPicture(
						"A picture of the engine of the places of the walk of it",
					);
				}
				const node = nodes[at];
				if (node) node.depth = this.getBits(fieldWidth);
				at += 1;
				length -= 1;
			} else {
				const step = this.getBitLength();
				at += 0 === step ? 1 : step;
			}
		}
	}

	/** `I24Decoder.RebuildTree`: the table of the tokens of a walk of the tree of the engine. */
	private rebuildTree(
		dict: DictRec[],
		nodes: Node[],
		links: Link[],
		linkLimit: number,
	): void {
		for (const rec of dict) {
			rec.token = 0;
			rec.link = null;
		}
		let next = 0;
		let count = nodes.length - 1;
		while (0 === (nodes[next]?.depth ?? 0)) {
			count -= 1;
			if (count <= 0) break;
			next += 1;
		}
		if (0 === count) return;
		let head = next;
		next += 1;
		while (count > 0) {
			const node = nodes[next];
			const depth = node?.depth ?? 0;
			if (depth !== 0 && node) {
				if (head !== LINK_NONE) {
					const at = nodes[head];
					if (at && at.depth <= depth) {
						let previous = head;
						let pointer = at.next;
						while (pointer !== LINK_NONE) {
							const behind = nodes[pointer];
							if (!behind || behind.depth > depth) break;
							previous = pointer;
							pointer = behind.next;
						}
						const before = nodes[previous];
						if (before) before.next = next;
						node.next = pointer;
					} else {
						node.next = head;
						head = next;
					}
				}
			}
			next += 1;
			count -= 1;
		}
		let bitSize = 0;
		let dictAt = 0;
		while (head !== LINK_NONE) {
			const node = nodes[head];
			if (!node) break;
			if (node.depth > bitSize) {
				dictAt <<= node.depth - bitSize;
				bitSize = node.depth;
			}
			if (bitSize >= BITS_OF_PLACE) {
				if (bitSize === BITS_OF_PLACE) {
					const rec = dict[dictAt];
					if (rec) {
						rec.bitSize = BITS_OF_PLACE;
						rec.token = node.token;
						rec.link = null;
					}
				} else {
					const places = bitSize - BITS_OF_PLACE;
					const high = dictAt >> places;
					let low = dictAt << (32 - places);
					const rec = dict[high];
					if (!rec) break;
					rec.bitSize = 0;
					const known = rec.link;
					let link: Link;
					if (null === known) {
						link = this.newLink(links, linkLimit);
						rec.link = link;
					} else {
						link = known;
					}
					let placesLeft = places;
					while (placesLeft > 0) {
						const place = (low >> 31) & 1;
						low <<= 1;
						const child = link.children[0 === place ? 0 : 1] ?? null;
						if (null === child) {
							const made = this.newLink(links, linkLimit);
							link.children[place] = made;
							link = made;
						} else {
							link = child;
						}
						placesLeft -= 1;
					}
					link.token = node.token;
				}
			} else {
				let from = dictAt << (BITS_OF_PLACE - bitSize);
				let left = 1 << (BITS_OF_PLACE - bitSize);
				while (left > 0) {
					const rec = dict[from];
					if (rec) {
						rec.bitSize = bitSize;
						rec.token = node.token;
					}
					from += 1;
					left -= 1;
				}
			}
			dictAt += 1;
			head = node.next;
		}
	}

	/**
	 * A place of the file of the tree of the walk of the engine. The reference stands of a table of the
	 * places of the file of the walk of the engine of a count of its own, of the places of the file of a
	 * picture of the engine outside them; this port stands of `INVALID_ARCHIVE` for it.
	 */
	private newLink(links: Link[], limit: number): Link {
		if (links.length >= limit) {
			throw invalidPicture(
				"A picture of the engine of the places of the file of the walk of it",
			);
		}
		const made: Link = { children: [null, null], token: 0 };
		links.push(made);
		return made;
	}

	/** `I24Decoder.GetToken`: a token of the walk of the places of the file of a table of the engine. */
	private getToken(dict: DictRec[]): number {
		const entry = dict[(this.bits >> BITS_OF_PLACE) & BYTE];
		if (!entry)
			throw invalidPicture(
				"A picture of the engine of no places of the file of it",
			);
		let count = entry.bitSize;
		if (count !== 0) {
			if (count >= this.bitCount) {
				this.bits <<= this.bitCount;
				count -= this.bitCount;
				this.bits |= this.readUInt8();
				this.bitCount = BITS_OF_PLACE;
			}
			this.bits <<= count;
			this.bitCount -= count;
			return entry.token;
		}
		this.bits = this.readUInt8() | (this.bits << this.bitCount);
		this.bits <<= BITS_OF_PLACE - this.bitCount;
		let link: Link | null = entry.link;
		for (;;) {
			const path = this.nextBit() & 1;
			const next = link?.children[path] ?? null;
			if (null === next) {
				throw invalidPicture(
					"A picture of the engine of the places of the file of the walk of it",
				);
			}
			if (null === next.children[0]) return next.token;
			link = next;
		}
	}

	/** `I24Decoder.Unpack`: the places of the file of the picture of the engine. */
	unpack(): Buffer {
		const { width, height } = this.layout;
		const stride = width * 4;
		const pixels = Buffer.alloc(stride * height, 0);
		const lines = [
			Buffer.alloc(stride, 0),
			Buffer.alloc(stride, 0),
			Buffer.alloc(stride, 0),
		];
		let dst = 0;
		const shifts = [...SHIFT_TABLE];
		for (let y = 0; y < height; y += 1) {
			const spare = lines[2];
			if (spare) {
				lines[2] = lines[1] ?? Buffer.alloc(stride, 0);
				lines[1] = lines[0] ?? Buffer.alloc(stride, 0);
				lines[0] = spare;
			}
			const line = spare ?? Buffer.alloc(stride, 0);
			let x = 0;
			let place = 0;
			while (x < width) {
				if (0 === this.byteCount) {
					if (this.cacheEmpty) {
						this.cacheEmpty = false;
						this.bits =
							((this.readUInt8() << BITS_OF_PLACE) | this.readUInt8()) & 0xffff;
						this.bitCount = BITS_OF_PLACE;
					}
					for (const table of this.tables) this.initTree(table.nodes);
					for (const table of this.tables) {
						this.rebuildTree(
							table.dict,
							table.nodes,
							table.links,
							table.linkLimit,
						);
					}
					this.byteCount = TOKEN_COUNT;
				}
				this.byteCount -= 1;
				const [colors, shiftsOf, extra] = this.tables;
				if (!colors || !shiftsOf || !extra) break;
				const color = this.getToken(colors.dict);
				const shiftToken = this.getToken(shiftsOf.dict);
				const shiftAt = 2 * shiftToken;
				const first = shifts[shiftAt] ?? 0;
				const second = shifts[shiftAt + 1] ?? 0;
				if (shiftToken !== 0) {
					// The places of the file of the table of the walk of the picture of the engine stand of
					// the walk of the places of the file of the picture of the tokens behind the walk of it.
					rotateShiftTable(shifts, shiftToken, this.layout.version);
				}
				let src = 4 * (x + first);
				const from = lines[second] ?? line;
				if (color >= TOKEN_RUN) {
					let count = color - RUN_BASE;
					x += count;
					while (count > 0) {
						line[place] = from[src] ?? 0;
						line[place + 1] = from[src + 1] ?? 0;
						line[place + 2] = from[src + 2] ?? 0;
						line[place + 3] = from[src + 3] ?? 0;
						place += 4;
						src += 4;
						count -= 1;
					}
				} else {
					const red = this.placeOf(SHIFT_R, color);
					line[place + 2] = ((from[src + 2] ?? 0) - red) & BYTE;
					const green = this.placeOf(SHIFT_G, color);
					line[place + 1] = ((from[src + 1] ?? 0) - green) & BYTE;
					const blue = this.placeOf(SHIFT_B, color);
					line[place] = ((from[src] ?? 0) - blue) & BYTE;
					line[place + 3] = 0;
					place += 4;
					x += 1;
				}
			}
			// The reference stands of the places of the file of the walk of the engine of the first of the
			// three rows of the walk of the picture of it: the row of the walk of the engine itself.
			const finished = lines[0];
			if (finished) finished.copy(pixels, dst, 0, stride);
			dst += stride;
		}
		return pixels;
	}

	/** `I24Decoder.Unpack`'s `r == -3`: a token of the third table of the walk of the engine. */
	private placeOf(table: readonly number[], color: number): number {
		const value = table[color] ?? 0;
		if (EXTENDED !== value) return value;
		const third = this.tables[2];
		if (!third)
			throw invalidPicture(
				"A picture of the engine of no places of the file of it",
			);
		return this.getToken(third.dict) + 3;
	}
}

/**
 * `I24Decoder.Unpack`'s walk of the places of the file of the table of the walk of a row: the place of
 * the file of the token stands of the places of the file of the walk of the engine above it, of the
 * places of the file of the picture of the walk of the engine itself of the letters `A` of the kind of
 * the picture of it.
 */
export function rotateShiftTable(
	table: number[],
	token: number,
	version: number,
): void {
	const at = 2 * token;
	if (0 === at) return;
	const first = table[at] ?? 0;
	const second = table[at + 1] ?? 0;
	if (VERSION_A === version) {
		let from = at;
		while (from > 0) {
			table[from] = table[from - 2] ?? 0;
			table[from + 1] = table[from - 1] ?? 0;
			from -= 2;
		}
		table[0] = first;
		table[1] = second;
	} else {
		table[at] = table[at - 2] ?? 0;
		table[at + 1] = table[at - 1] ?? 0;
		table[at - 2] = first;
		table[at - 1] = second;
	}
}

/** `I24Format.Read`: the picture of the engine, handed over as the places of the file of a BMP of it. */
export function unpackI24Picture(data: Buffer, layout: I24Layout): Buffer {
	const decoder = new I24Decoder(data, layout);
	return writeBmp32(layout.width, layout.height, decoder.unpack(), false);
}

export const i24ImageDescriptor: FormatDescriptor = {
	id: "hyperworks-i24-image",
	name: "HyperWorks RGB image",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/HyperWorks/ImageI24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const i24ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: i24ImageDescriptor,
	detection: {
		signatures: [
			{ bytes: new Uint8Array([...MARK, VERSION_A]) },
			{ bytes: new Uint8Array([...MARK, VERSION_SPACE]) },
		],
		priority: 0,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readI24Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readI24Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the HyperWorks engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_24,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readI24Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the HyperWorks engine");
		return Readable.from([unpackI24Picture(data, layout)]);
	},
});
