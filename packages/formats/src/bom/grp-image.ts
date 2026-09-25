// Port of GARbro "Legacy/Bom/ImageGRP.cs" (tag "GRP/RG", classes `GrpFormat` / `GrpReader`), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine stands of a head of 0x24 places: a mark of `RG`, the kind of the picture, a
// word whose top place must be set, the width and the height, the places of a row and the place of the
// walk. Behind the head stands the walk, and a word in front of it tells whether it is there at all: a
// word whose top place is set is followed by the places of the picture as they stand.
//
// The walk itself is an LZ over a frame of four thousand places filled with spaces, and **both** of the
// two things it reads - the control of a step and the place a run reaches back to - stand of a code of an
// **adaptive Huffman tree**: a tree of 318 leaves that is rebuilt as every symbol is read, of two arrays
// of weights and links the reference fills itself and of an update that walks from the leaf up to the
// root bumping weights and swapping nodes out of order. The control of a step that stands below 0x100 is
// a place of the picture of its own, and one above it stands for a run whose count is the control less
// 0xFD.
//
// Every place the walk turns out is handed to a **second** walk, of its own: a place equal to the one in
// front of it begins a run, whose count is read of the places behind it, the low seven places of each of
// them and a set top place saying that another one follows. The reference never flushes the place that
// stands in front at the end of the walk, so a picture can end one place short of its own size.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import {
	writeBmp16,
	writeBmp24,
	writeBmp32,
	writeBmp8,
} from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 0x24;
const KIND_AT = 4;
const MARK_AT = 6;
const MARK_BIT = 0x80;
const RADICAL_BIT = 0x80000000;
const WIDTH_AT = 8;
const HEIGHT_AT = 10;
const STRIDE_AT = 0x18;
const DATA_OFFSET_AT = 0x22;
const KIND_COUNT = 5;
/** The kind of the head, of the places of a colour each of them. */
const KIND_PLACES: readonly number[] = [0, 32, 24, 16, 8, 4];
const PLACES_16 = 16;
const PLACES_32 = 32;
const PLACES_24 = 24;
/** The walk: a frame of four thousand places, of which the three behind the end stand filled. */
const FRAME_SIZE = 0x1000;
const FRAME_FILL = 0xfc0;
const SPACE = 0x20;
const FRAME_MASK = 0xfff;
/** The control of a step: below 0x100 a place of its own, above it a run of the control less 0xFD. */
const RUN_FIRST = 0x100;
const RUN_BASE = 0xfd;
const LEAF_BASE = 635;
const LEAF_COUNT = 318;
const ROOT_SLOT = 634;
const WEIGHTS_COUNT = 636;
const LINKS_COUNT = 635;
const PARENTS_COUNT = 953;
const PARENT_LAST = 316;
const ROOT_WEIGHT = 0x8000;
const ROOT_LIMIT = 0xffff;
/** The cache of places the walk reads its codes of, of sixteen places of a word. */
const CACHE_LIMIT = 8;
const CACHE_BITS = 16;
const BYTE_BITS = 8;
const CODE_MASK = 0xff;
const NIBBLE_MASK = 0x7f;
const NIBBLE_BITS = 7;
/** The widths of a place of a run of the frame, and the places of the run itself. */
const OFFSET_MASK = 0x3f;
const OFFSET_SHIFT = 6;
const BYTE_MASK = 0xff;
const RUN_MARK = 0x80;

/** `GrpReader.byte_438C10`: the places of a place of the run. */
const RUN_HIGH: readonly number[] = [
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6,
	7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 0x0a,
	0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b, 0x0b,
	0x0b, 0x0b, 0x0c, 0x0c, 0x0c, 0x0c, 0x0d, 0x0d, 0x0d, 0x0d, 0x0e, 0x0e, 0x0e,
	0x0e, 0x0f, 0x0f, 0x0f, 0x0f, 0x10, 0x10, 0x10, 0x10, 0x11, 0x11, 0x11, 0x11,
	0x12, 0x12, 0x12, 0x12, 0x13, 0x13, 0x13, 0x13, 0x14, 0x14, 0x14, 0x14, 0x15,
	0x15, 0x15, 0x15, 0x16, 0x16, 0x16, 0x16, 0x17, 0x17, 0x17, 0x17, 0x18, 0x18,
	0x19, 0x19, 0x1a, 0x1a, 0x1b, 0x1b, 0x1c, 0x1c, 0x1d, 0x1d, 0x1e, 0x1e, 0x1f,
	0x1f, 0x20, 0x20, 0x21, 0x21, 0x22, 0x22, 0x23, 0x23, 0x24, 0x24, 0x25, 0x25,
	0x26, 0x26, 0x27, 0x27, 0x28, 0x28, 0x29, 0x29, 0x2a, 0x2a, 0x2b, 0x2b, 0x2c,
	0x2c, 0x2d, 0x2d, 0x2e, 0x2e, 0x2f, 0x2f, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35,
	0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f,
];
/** `GrpReader.byte_438D10`: the count of the places behind that place. */
const RUN_LOW: readonly number[] = [
	3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
	4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
	4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
	5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
	5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
	6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
	6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
	7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
	7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8,
];
/** `GrpReader.BitMaskTable` and `BitShiftTable`, for the counts of a place of a run. */
const BIT_MASK: readonly number[] = [
	0, 1, 3, 7, 0x0f, 0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff, 0x1fff,
	0x3fff, 0xfff, 0xffff,
];
const BIT_SHIFT: readonly number[] = [
	0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
];
/** The counts the walk reads a place of a run of: one place up to six of them. */
const RUN_PLACES_BASE = 2;

export interface BomGrpLayout {
	kind: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	stride: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `GrpFormat.ReadMetaData`. */
export function readBomGrpLayout(data: Buffer): BomGrpLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (0 === ((data[MARK_AT] ?? 0) & MARK_BIT)) return undefined;
	const kind = data[KIND_AT] ?? 0;
	if (kind < 1 || kind > KIND_COUNT) return undefined;
	const bitsPerPixel = KIND_PLACES[kind] ?? 0;
	const width = data.readUInt16LE(WIDTH_AT);
	const height = data.readUInt16LE(HEIGHT_AT);
	const stride = data.readInt32LE(STRIDE_AT);
	const dataOffset = data.readUInt16LE(DATA_OFFSET_AT);
	// The reference builds an array of the places of a row times the rows, and reads a word of the walk
	// in front of the places themselves; a picture of no places or one whose places run past the file is
	// turned away here rather than read past the end.
	if (width <= 0 || height <= 0 || stride <= 0) return undefined;
	if (dataOffset + 4 > data.length) return undefined;
	return { kind, width, height, bitsPerPixel, stride, dataOffset };
}

/**
 * `GrpReader.UnpackLz`, `GetControlWord`, `GetOffset`, `sub_408C80`, `sub_408D50` and `PutByte`: the walk
 * of the places of a picture whose word in front of it does not stand of the places themselves.
 */
export class BomGrpWalker {
	private readonly weights = new Int32Array(WEIGHTS_COUNT);
	private readonly links = new Int32Array(LINKS_COUNT);
	private readonly parents = new Int32Array(PARENTS_COUNT);
	private bits = 0;
	private cached = 0;
	private at = 0;
	private dst = 0;
	private readonly output: Buffer;
	private readonly frame = Buffer.alloc(FRAME_SIZE, 0);
	private frameAt = FRAME_FILL;
	private pending = -1;
	private runAt = 0;
	private runCount = 0;

	constructor(
		private readonly input: Buffer,
		size: number,
	) {
		this.output = Buffer.alloc(size, 0);
		this.frame.fill(SPACE, 0, FRAME_FILL);
		this.init();
	}

	/** `GrpReader.Init`: the code of every place of the picture of the walk as it stands. */
	private init(): void {
		this.pending = -1;
		this.runAt = 0;
		this.runCount = 0;
		for (let i = 0; i < LEAF_COUNT; i += 1) {
			this.weights[i] = 1;
			this.parents[i + LEAF_BASE] = i;
			this.links[i] = i + LEAF_BASE;
		}
		let child = 0;
		let parent = LEAF_COUNT;
		for (let i = 0; i <= PARENT_LAST; i += 1) {
			const weight =
				(this.weights[child] ?? 0) + (this.weights[child + 1] ?? 0);
			this.parents[child] = parent;
			this.parents[child + 1] = parent;
			this.weights[i + LEAF_COUNT] = weight;
			this.links[i + LEAF_COUNT] = child;
			child += 2;
			parent += 1;
		}
		this.parents[ROOT_SLOT] = 0;
		this.cached = 0;
		this.bits = 0;
		this.weights[LINKS_COUNT] = ROOT_LIMIT;
	}

	/** `GrpReader.FillBitCache`: the cache of the codes, read from the highest place of a byte down. */
	private fill(): void {
		if (this.cached <= CACHE_LIMIT) {
			const value = this.input[this.at++] ?? 0;
			this.bits = this.bits | (value << (BYTE_BITS - this.cached)) | 0;
			this.cached += BYTE_BITS;
		}
	}

	private nextBit(): number {
		this.fill();
		this.bits = (this.bits << 1) | 0;
		this.cached -= 1;
		return (this.bits >> CACHE_BITS) & 1;
	}

	private nextByte(): number {
		this.fill();
		const result = this.bits >> BYTE_BITS;
		this.bits = (this.bits << BYTE_BITS) | 0;
		this.cached -= BYTE_BITS;
		return result & CODE_MASK;
	}

	private nextBits(count: number): number {
		this.fill();
		const shifted = (this.bits << count) | 0;
		this.cached -= count;
		const result = this.bits >> (BIT_SHIFT[count] ?? 0);
		this.bits = shifted;
		return result & (BIT_MASK[count] ?? 0);
	}

	/** `GrpReader.GetControlWord`: the leaf of the tree the code of the cache walks to. */
	private controlWord(): number {
		let control = this.links[ROOT_SLOT] ?? 0;
		while (control < LINKS_COUNT) {
			control = this.links[this.nextBit() + control] ?? 0;
		}
		const symbol = control - LINKS_COUNT;
		this.bump(symbol);
		return symbol;
	}

	/** `GrpReader.GetOffset`: the place of the frame a run reaches back to. */
	private offset(): number {
		const first = this.nextByte();
		const places = (RUN_LOW[first] ?? 0) - RUN_PLACES_BASE;
		const high = (RUN_HIGH[first] ?? 0) << OFFSET_SHIFT;
		const rest = this.nextBits(places);
		return (
			high |
			(((((first << places) & BYTE_MASK) | (rest & BYTE_MASK)) &
				OFFSET_MASK) as number)
		);
	}

	/** `GrpReader.sub_408C80`: the tree of the walk, bumped from the leaf of a place up to the root. */
	private bump(symbol: number): void {
		if ((this.weights[ROOT_SLOT] ?? 0) === ROOT_WEIGHT) this.rebuild();
		let node = this.parents[symbol + LEAF_BASE] ?? 0;
		do {
			const weight = (this.weights[node] ?? 0) + 1;
			this.weights[node] = weight;
			if (weight > (this.weights[node + 1] ?? 0)) {
				let higher = node + 2;
				while (weight > (this.weights[higher] ?? 0)) higher += 1;
				this.weights[node] = this.weights[higher - 2] ?? 0;
				this.weights[higher - 2] = weight;
				const mine = this.links[node] ?? 0;
				const other = higher - 2;
				this.parents[mine] = other;
				if (mine < LINKS_COUNT) this.parents[mine + 1] = other;
				const far = this.links[other] ?? 0;
				this.links[other] = mine;
				this.parents[far] = node;
				if (far < LINKS_COUNT) this.parents[far + 1] = node;
				this.links[node] = far;
				node = other;
			}
			node = this.parents[node] ?? 0;
		} while (node !== 0);
	}

	/** `GrpReader.sub_408D50`: the tree rebuilt when its root reaches the top of the weights. */
	private rebuild(): void {
		let placed = 0;
		for (let i = 0; i < LINKS_COUNT; i += 1) {
			const link = this.links[i] ?? 0;
			if (link >= LINKS_COUNT) {
				const weight = this.weights[i] ?? 0;
				this.links[placed] = link;
				this.weights[placed] = (weight + 1) >> 1;
				placed += 1;
			}
		}
		let target = LEAF_COUNT;
		let child = 0;
		let source = 0;
		let node = 0;
		while (node < PARENT_LAST + 1) {
			const weight =
				(this.weights[child] ?? 0) + (this.weights[child + 1] ?? 0);
			let slot = target;
			let look = node + LEAF_COUNT - 1;
			this.weights[node + LEAF_COUNT] = weight;
			while (weight < (this.weights[look] ?? 0)) {
				look -= 1;
				slot -= 1;
			}
			for (let at = node + LEAF_COUNT; at > slot; at -= 1) {
				this.weights[at] = this.weights[at - 1] ?? 0;
			}
			this.weights[slot] = weight;
			let from = node + LEAF_COUNT;
			const to = slot;
			while (from > to) {
				this.links[from] = this.links[from - 1] ?? 0;
				from -= 1;
			}
			child += 2;
			this.links[to] = source;
			source += 2;
			target += 1;
			node += 1;
		}
		let at = 0;
		for (let i = 0; i < LINKS_COUNT; i += 1) {
			const link = this.links[i] ?? 0;
			if (link < LINKS_COUNT) this.parents[link + 1] = at;
			this.parents[link] = at;
			at += 1;
		}
	}

	/**
	 * `GrpReader.PutByte`: every place of the walk is handed to a run of its own, which hands the picture
	 * over once the place behind the one that stands in front is another one.
	 */
	private putByte(value: number): void {
		if (0 !== this.runAt) {
			const places =
				((value & NIBBLE_MASK) << (NIBBLE_BITS * this.runAt - NIBBLE_BITS)) | 0;
			this.runCount += places;
			if (0 !== (value & RUN_MARK)) {
				this.runAt += 1;
			} else {
				let left = this.runCount;
				this.runAt = 0;
				while (left > 0 && this.dst < this.output.length) {
					this.output[this.dst++] = this.pending & CODE_MASK;
					left -= 1;
				}
				this.pending = -1;
			}
			return;
		}
		if (this.pending >= 0) {
			if (this.pending === value) {
				this.runAt = 1;
				this.runCount = 0;
				return;
			}
			if (this.dst < this.output.length) {
				this.output[this.dst++] = this.pending & CODE_MASK;
			}
			this.pending = value;
			return;
		}
		this.runAt = 0;
		this.pending = value;
	}

	/** `GrpReader.UnpackLz`: the walk of the frame and the places of the picture. */
	unpack(): Buffer {
		while (this.dst < this.output.length) {
			const control = this.controlWord();
			if (control >= RUN_FIRST) {
				const count = control - RUN_BASE;
				const from = (this.frameAt - this.offset() - 1) & FRAME_MASK;
				for (let i = 0; i < count; i += 1) {
					const value = this.frame[(from + i) & FRAME_MASK] ?? 0;
					this.putByte(value);
					this.frame[this.frameAt++ & FRAME_MASK] = value;
				}
			} else {
				this.putByte(control);
				this.frame[this.frameAt++ & FRAME_MASK] = control & CODE_MASK;
			}
		}
		return this.output;
	}
}

/** `GrpReader.Unpack`: the places of a picture, of the walk or of the places as they stand. */
export function unpackBomGrpPicture(
	data: Buffer,
	layout: BomGrpLayout,
): Buffer {
	const packed = data.subarray(layout.dataOffset);
	const places = layout.stride * layout.height;
	const size = packed.readInt32LE(0);
	if (0 !== (size & RADICAL_BIT)) {
		// The word in front of a picture whose top place is set is followed by its places as they stand.
		const stored = Buffer.alloc(places, 0);
		packed.subarray(4, 4 + places).copy(stored);
		return stored;
	}
	// The reference reads the word in front of the walk and does not stand of it: the walk ends of the
	// places of the picture alone.
	return new BomGrpWalker(packed.subarray(4), places).unpack();
}

/** The places of a row of a picture of the walk, of the count the pixel format of it names. */
function rowPlaces(layout: BomGrpLayout): number {
	return Math.floor((layout.width * layout.bitsPerPixel) / 8);
}

/** The places of the picture packed into rows of the count the pixel format names. */
export function packBomGrpRows(places: Buffer, layout: BomGrpLayout): Buffer {
	const tight = rowPlaces(layout);
	if (tight <= 0 || tight === layout.stride) return places;
	const packed = Buffer.alloc(tight * layout.height, 0);
	for (let row = 0; row < layout.height; row += 1) {
		places.copy(
			packed,
			row * tight,
			row * layout.stride,
			Math.min(places.length, row * layout.stride + tight),
		);
	}
	return packed;
}

export const bomGrpImageDescriptor: FormatDescriptor = {
	id: "bom-grp-image",
	name: "BOM GRP image",
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
			source: "Legacy/Bom/ImageGRP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bomGrpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bomGrpImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("RG\x01\x00", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readBomGrpLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readBomGrpLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the BOM engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					kind: layout.kind,
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					stride: layout.stride,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				kind: layout.kind,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				stride: layout.stride,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readBomGrpLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the BOM engine");
		const places = unpackBomGrpPicture(data, layout);
		switch (layout.bitsPerPixel) {
			case PLACES_32:
				return Readable.from([
					writeBmp32(
						layout.width,
						layout.height,
						packBomGrpRows(places, layout),
					),
				]);
			case PLACES_24:
				return Readable.from([
					writeBmp24(
						layout.width,
						layout.height,
						packBomGrpRows(places, layout),
					),
				]);
			case PLACES_16:
				return Readable.from([
					writeBmp16(
						layout.width,
						layout.height,
						packBomGrpRows(places, layout),
					),
				]);
			default:
				// The reference hands a picture of the kinds of four and of eight places a colour over as
				// Gray8, of its places as they stand: this port writes them of a place of a picture each,
				// since neither kind carries a palette, and keeps the places of a row of the head.
				return Readable.from([writeBmp8(layout.stride, layout.height, places)]);
		}
	},
});
