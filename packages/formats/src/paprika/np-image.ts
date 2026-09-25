// Port of GARbro "Legacy/Paprika/ImageNP.cs" (tag "PIC/NP", class `NpFormat`, reader `NpReader`), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture of the engine is twenty four bits a place and its places stand of two tables the format
// keeps in the reference itself: `bitMap` names, for sixteen prefixes of four places of the stream, how
// many places of a code stand behind them and where its words begin in `wordList`, and the words of the
// list are the places of a picture below 0x100 and the tokens of a run above it. A run of a word of 256
// to 263 carries its count in the word itself; a longer one carries the count and the place of the run in
// `dword_4257CC` and `dword_425810`. Every place written is copied into a ring of 0x10000 places beside
// the picture, which is where the runs reach back into. One token (the word 272) rebuilds the codes of
// the list from the counts of the words read so far: the pairs `(word, count)` are sorted by a shell sort
// of the reference's own (`sub_416E80` and `sub_416DC0`) and the codes behind them are then read from the
// stream, a count of places at a time, as a run of clear places behind a set one.
//
// One step of the reference is kept as it stands rather than as it was meant: after a run it copies
// `m_output[dst]` - the first place of the range it has just written - into the ring `count` times, where
// the walk it was written out of copies the range itself. The two agree for a run of one place and part
// for any longer one, so the ring of this port holds the first place of a run only, and the difference
// stands in `docs/formats/paprika-np-image.md`.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { writeBmp24 } from "../shared/bmp.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	NP_BIT_MAP,
	NP_RUN_COUNTS,
	NP_RUN_PLACES,
	NP_WORD_LIST,
} from "./np-tables.js";

/** `NpFormat.Signature`: the letters `NP`, then the byte 0x01 and the byte 0x00. */
const MARK = Buffer.from([0x4e, 0x50, 0x01, 0x00]);
const LETTERS = 2;
const HEAD_SIZE = 0x10;
const COUNT_AT = 2;
const WIDTH_AT = 4;
const HEIGHT_AT = 8;
const DATA_AT = 12;
const BITS_PER_PIXEL = 24;
/** The walk: the count of its places and the count of the packed places in front of its stream. */
const SIZE_HEAD = 8;
const STRIP = 0x1c;
/** The ring beside the picture, the counts of the words and the code pairs of the walk. */
const RING_SIZE = 0x10000;
const WORD_COUNT = 0x112;
const WORD_LIMIT = 274;
const LITERAL_LIMIT = 0x100;
const SHORT_RUN = 264;
const RESET_WORD = 272;
const END_WORD = 273;
const SCRATCH_SIZE = 0x225;
const PREFIX_BITS = 4;
const PLACE_BITS = 3;
const PLACE_HIGH = 8;
const PLACE_BASE = 9;
const RUN_GAP = 4;
const RUN_COUNT_BASE = 4;
const SHELL_GAP = 40;
const SHELL_STEP = 3;
const SORT_SCALE = 2;
const SORT_OFFSET = -2;
const UINT16 = 0xffff;
const BITS_PER_BYTE = 8;
const WORD_BITS = 32;

export interface NpLayout {
	frameCount: number;
	width: number;
	height: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `NpFormat.ReadMetaData`. */
export function readNpLayout(data: Buffer): NpLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, LETTERS).equals(MARK.subarray(0, LETTERS))) {
		return undefined;
	}
	const frameCount = data.readUInt16LE(COUNT_AT);
	if (0 === frameCount) return undefined;
	const width = data.readUInt32LE(WIDTH_AT);
	const height = data.readUInt32LE(HEIGHT_AT);
	const dataOffset = data.readUInt32LE(DATA_AT);
	if (0 === width || 0 === height || dataOffset + SIZE_HEAD > data.length) {
		return undefined;
	}
	return { frameCount, width, height, dataOffset };
}

/** The reader of the reference: `GetBits` holds thirty two places and takes a byte at a time. */
class NpBits {
	bits = 0;
	bitCount = 0;
	at: number;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.at = at;
	}

	peek(): number {
		return this.at < this.data.length ? (this.data[this.at] ?? 0) : -1;
	}

	/** `NpReader.GetBits`. */
	read(count: number): number {
		if (this.bitCount < count) {
			this.bits =
				(this.bits | ((this.data[this.at] ?? 0) << (24 - this.bitCount))) >>> 0;
			this.at += 1;
			this.bitCount += BITS_PER_BYTE;
		}
		const value = this.bits >>> (WORD_BITS - count);
		this.bits = (this.bits << count) >>> 0;
		this.bitCount -= count;
		return value;
	}
}

/** `NpReader.sub_416DC0`: the shell sort of the pairs the counts of the words stand in. */
function sortPairs(
	words: Uint16Array,
	offset: number,
	count: number,
	scratch: Uint32Array,
): void {
	let gap = SHELL_GAP;
	for (;;) {
		let index = gap + 1;
		let saved = gap + 1;
		if (index <= count) {
			do {
				let at = 4 * index;
				let place = index;
				scratch[0] = readPair(words, offset + at);
				if (index > gap) {
					const step = 4 * gap;
					do {
						scratch[1] = readPair(words, offset + at - step);
						let order = toInt16(scratch[1] >>> 16) - toInt16(scratch[0] >>> 16);
						if (0 === order) {
							order =
								toInt16(scratch[1] & UINT16) - toInt16(scratch[0] & UINT16);
						}
						if (order >= 0) break;
						writePair(words, offset + at, readPair(words, offset + at - step));
						at -= step;
						place -= gap;
					} while (place > gap);
					index = saved;
				}
				index += 1;
				writePair(words, offset + place * 4, scratch[0] ?? 0);
				saved = index;
			} while (index <= count);
		}
		gap = Math.floor(gap / SHELL_STEP);
		if (gap <= 0) break;
	}
}

/** The two places of a pair: they stand behind each other in the flat array of the sort. */
function readPair(words: Uint16Array, at: number): number {
	return ((words[at + 1] ?? 0) << 16) | (words[at] ?? 0);
}

function writePair(words: Uint16Array, at: number, value: number): void {
	words[at] = value & UINT16;
	words[at + 1] = (value >>> 16) & UINT16;
}

function toInt16(value: number): number {
	const word = value & UINT16;
	return word >= 0x8000 ? word - 0x10000 : word;
}

/** `NpReader.sub_416E80`: the pairs of the words, halved counts and all, put in order. */
function sortWordCounts(state: NpState): number {
	const scratch = state.scratch;
	let at = 0;
	let total = 0;
	for (let word = 0; word < WORD_COUNT; word += 1) {
		scratch[at] = word;
		scratch[at + 1] = state.counts[word] ?? 0;
		at += SORT_SCALE;
		total += state.counts[word] ?? 0;
		state.counts[word] = (state.counts[word] ?? 0) >> 1;
	}
	sortPairs(scratch, SORT_OFFSET, WORD_COUNT, state.pair);
	return total;
}

interface NpState {
	counts: Uint16Array;
	codes: number[];
	words: number[];
	scratch: Uint16Array;
	pair: Uint32Array;
}

/** `NpReader.UnpackBits`: the tokens of the walk, until the stream or the picture ends. */
function unpackNpBits(
	bits: NpBits,
	state: NpState,
	output: Buffer,
	ring: Buffer,
): { done: boolean; at: number; written: number } {
	bits.bitCount = 0;
	let at = 0;
	let written = 0;
	while (bits.peek() !== -1) {
		const pairAt = bits.read(PREFIX_BITS) * 2;
		const width = state.codes[pairAt] ?? 0;
		let word: number;
		if (0 === width) {
			word = state.words[state.codes[pairAt + 1] ?? 0] ?? 0;
		} else {
			const index = bits.read(width) + (state.codes[pairAt + 1] ?? 0);
			if (index >= WORD_LIMIT) return { done: false, at, written };
			word = state.words[index] ?? 0;
		}
		state.counts[word] = ((state.counts[word] ?? 0) + 1) & UINT16;
		if (word < LITERAL_LIMIT) {
			if (at >= output.length) return { done: false, at, written };
			output[at++] = word & 0xff;
			ring[written & UINT16] = word & 0xff;
			written += 1;
			continue;
		}
		if (RESET_WORD === word) {
			sortWordCounts(state);
			let from = 0;
			for (let i = 0; i < WORD_COUNT; i += 1) {
				state.words[i] = state.scratch[from] ?? 0;
				from += SORT_SCALE;
			}
			let base = 0;
			let pairAt2 = 1;
			let place = 0;
			for (let i = 0; i < 16; i += 1) {
				let run = 0;
				while (0 === bits.read(1)) run += 1;
				base += run;
				state.codes[pairAt2 - 1] = base;
				state.codes[pairAt2] = place;
				pairAt2 += 2;
				place += 1 << base;
			}
			continue;
		}
		if (END_WORD === word) return { done: true, at, written };
		let count: number;
		if (word < SHORT_RUN) {
			count = word - 0x100;
		} else {
			const width = NP_RUN_COUNTS[2 * (word - SHORT_RUN)] ?? 0;
			count =
				bits.read(width) + (NP_RUN_COUNTS[2 * (word - SHORT_RUN) + 1] ?? 0);
		}
		const place = bits.read(PLACE_BITS);
		let high = 0;
		let placeWidth = (NP_RUN_PLACES[2 * place] ?? 0) + PLACE_BASE;
		if (placeWidth > PLACE_HIGH) {
			placeWidth -= PLACE_HIGH;
			high = bits.read(PLACE_HIGH) << placeWidth;
		}
		const low = bits.read(placeWidth) | high;
		const distance = ((NP_RUN_PLACES[2 * place + 1] ?? 0) << 9) + low;
		count += RUN_COUNT_BASE;
		const next = at + count + RUN_GAP;
		if (next > output.length) break;
		const source = written - distance;
		if (count >= distance) {
			const from = source & UINT16;
			let target = at;
			let rest = distance;
			if (from + distance <= RING_SIZE) {
				ring.copy(output, target, from, from + rest);
			} else {
				const head = RING_SIZE - from;
				ring.copy(output, target, from, from + head);
				ring.copy(output, target + head, 0, rest - head);
				target += head;
				rest -= head;
			}
			const behind = count - distance;
			if (behind > 0) {
				copyOverlapped(output, at, at + distance, behind);
			}
		} else if ((source & UINT16) + count <= RING_SIZE) {
			const from = source & UINT16;
			ring.copy(output, at, from, from + count);
		} else {
			for (let i = 0; i < count; i += 1) {
				output[at + i] = ring[(source + i) & UINT16] ?? 0;
			}
		}
		// `NpReader` copies `m_output[dst]` - the first place of the range - into its ring once for
		// every place of the run.
		for (let i = 0; i < count; i += 1) {
			ring[(written + i) & UINT16] = output[at] ?? 0;
		}
		at = next;
		written += count;
	}
	return { done: false, at, written };
}

/** `NpReader.Unpack`: the picture of the engine out of the walk of its places. */
export function unpackNpPicture(data: Buffer, layout: NpLayout): Buffer {
	const unpackedSize = data.readInt32LE(layout.dataOffset);
	if (unpackedSize <= STRIP) {
		throw invalidPicture("A picture of the engine of no places");
	}
	const output = Buffer.alloc(unpackedSize, 0);
	const ring = Buffer.alloc(RING_SIZE, 0);
	const state: NpState = {
		counts: new Uint16Array(WORD_COUNT),
		codes: [...NP_BIT_MAP],
		words: [...NP_WORD_LIST],
		scratch: new Uint16Array(SCRATCH_SIZE),
		pair: new Uint32Array(2),
	};
	const bits = new NpBits(data, layout.dataOffset + SIZE_HEAD);
	let at = 0;
	while (at < unpackedSize) {
		const step = unpackNpBits(bits, state, output, ring);
		at = step.at;
		if (!step.done) break;
	}
	return output.subarray(STRIP, unpackedSize);
}

export const paprikaNpImageDescriptor: FormatDescriptor = {
	id: "paprika-np-image",
	name: "Paprika NP picture",
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
			source: "Legacy/Paprika/ImageNP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const paprikaNpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: paprikaNpImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readNpLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readNpLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Paprika engine");
		if (data.readInt32LE(layout.dataOffset) <= STRIP) {
			throw invalidPicture("A picture of the engine of no places");
		}
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: BigInt(layout.dataOffset),
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
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
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readNpLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Paprika engine");
		const pixels = unpackNpPicture(data, layout);
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
