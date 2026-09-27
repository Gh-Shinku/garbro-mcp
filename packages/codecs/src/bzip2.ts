import { Buffer } from "node:buffer";

import { crc32Normal } from "./crc32.js";
// A walk of the compressed streams of bzip2, of the wire format as it stands described in the worked
// example of `google/wuffs` (`std/bzip2/README.md`) and of the documentation of that format it names, which
// the reference stands of through a library rather than through a walk of its own
// (`ICSharpCode.SharpZipLib.BZip2.BZip2InputStream`, of `ArcFormats/NScripter/ArcNSA.cs`,
// `ArcFormats/Tamamo/ArcPCK.cs`, `Legacy/Uran/ArcNCL.cs` and `Legacy/Witch/ArcPCD.cs`).
//
// The walk of the format stands of these counts:
//
//   * the head `BZh` and the count of the places of a block behind it;
//   * the bits of the stream, most significant bit first and of no count of the places of a file at all;
//   * the word of a block (`0x314159265359`), the count of the places of the file of it, the count of the
//     walk of the places of the file at random (of no use), and the places of the count of the places of it;
//   * the counts of the places of the file that stand of the walk of the engine, of sixteen counts of the
//     places of the file at a time, and then the counts of the walk of the engine of the places of the file;
//   * the counts of the walk of the engine (at most six of them, of three counts of the places of the file
//     each), the counts of the places of the walk of the engine, and the counts of them of the walk of the
//     counts of the places of the file themselves;
//   * the places of the counts of the walk of the engine, of the counts of the places of the file of them;
//   * and the counts of the walk of the engine of the block, of fifty of them to a count of the places of
//     the walk of the engine, ending of the count `EOB`. Three of the counts stand of no place of the file:
//     `RUNA` and `RUNB` (the counts of the places of the file of the walk of the counts of them) and `EOB`.
//
// The places behind that stand of the walk of the places of the file itself (`Burrows Wheeler`), and the
// counts of the places of the file of the walk of the counts of them (`RLE1`) stand of the count behind
// them.
//
// The count of the places of the file of a block stands of the walk of the counts of the places of the file
// of the format that gzip uses as well, of the counts of the places of the file of the walk of the engine:
// the table of the counts of the places of the file stands of the counts of the places of the file from
// their most significant place, of no count of the places of the file turned about (of `crc32Normal` and of
// no other count of this project). It was checked against two streams: the worked example of the format and
// one written by `bzip2` itself.

const MAGIC = Buffer.from("BZh", "latin1");
const LEAST_LEVEL = 1;
const MOST_LEVEL = 9;
const BLOCK_MAGIC = 0x314159265359;
const END_MAGIC = 0x177245385090;
const MOST_GROUPS = 6;
const GROUP_PLACES = 3;
const MOST_SELECTORS = 18002;
const SELECTOR_PLACES = 15;
const SELECTOR_SYMBOLS = 50;
const MOST_CODE_PLACES = 23;
const MOST_COLOURS = 0x100;
const RUN_A = 0;
const RUN_B = 1;
const RUN_ESCAPE = 4;

/** The counts of the places of the file of a block of the walk of the counts of the places of the file. */
function blockCrc(block: Buffer): number {
	// The count of the places of the file of a block stands of the walk of the counts of the places of the
	// file of the format of gzip as well, but of the counts of the places of the file of the engine from
	// their most significant place (of `crc32Normal` of this package rather than of `crc32`).
	return (crc32Normal(block, 0xffffffff) ^ 0xffffffff) >>> 0;
}

class BitReader {
	#data: Buffer;
	#at: number;
	#bits = 0;
	#count = 0;

	constructor(data: Buffer, at: number) {
		this.#data = data;
		this.#at = at;
	}

	/** The place of the count of the places of the walk of the engine of the file of the counts of them. */
	position(): number {
		return this.#at - Math.trunc(this.#count / 8);
	}

	/**
	 * A count of the places of the file of thirty two counts of the walk of the engine stands of two counts
	 * of sixteen of them: the counts of the walk of the engine of this place of the file stand of the counts
	 * of the places of the file of theirs alone, and a count of thirty two would stand of more counts of the
	 * walk of the engine than the places of the file of them hold.
	 */
	readLong(): number {
		return this.read(16) * 0x10000 + this.read(16);
	}

	read(count: number): number {
		while (this.#count < count) {
			const byte = this.#data[this.#at] ?? 0;
			this.#at += 1;
			this.#bits = ((this.#bits << 8) | byte) >>> 0;
			this.#count += 8;
		}
		this.#count -= count;
		// A count of the places of the walk of the engine of thirty two places of the file stands of no
		// count of the places of the file of its own in JavaScript (`1 << 32` stands of `1` there), so the
		// places of the counts of the file stand of a count of their own here.
		const mask = count >= 32 ? 0xffffffff : (1 << count) - 1;
		return ((this.#bits >>> this.#count) & mask) >>> 0;
	}
}

interface DecodeTable {
	minLen: number;
	maxLen: number;
	limit: Int32Array;
	base: Int32Array;
	perm: Int32Array;
}

function buildTable(lengths: Uint8Array, alphaSize: number): DecodeTable {
	const limit = new Int32Array(MOST_CODE_PLACES + 2);
	const base = new Int32Array(MOST_CODE_PLACES + 2);
	const perm = new Int32Array(alphaSize);
	let minLen = MOST_CODE_PLACES + 2;
	let maxLen = 0;
	for (let symbol = 0; symbol < alphaSize; symbol += 1) {
		const len = lengths[symbol] ?? 0;
		if (len > 0) {
			if (len < minLen) minLen = len;
			if (len > maxLen) maxLen = len;
		}
	}
	if (0 === maxLen)
		throw new RangeError(
			"bzip2: a count of the walk of the engine of no places",
		);
	let at = 0;
	for (let len = minLen; len <= maxLen; len += 1) {
		for (let symbol = 0; symbol < alphaSize; symbol += 1) {
			if ((lengths[symbol] ?? 0) === len) perm[at++] = symbol;
		}
	}
	for (let symbol = 0; symbol < alphaSize; symbol += 1) {
		const len = lengths[symbol] ?? 0;
		if (len > 0) base[len + 1] = (base[len + 1] ?? 0) + 1;
	}
	for (let len = 1; len < MOST_CODE_PLACES + 2; len += 1) {
		base[len] = (base[len] ?? 0) + (base[len - 1] ?? 0);
	}
	let vec = 0;
	for (let len = minLen; len <= maxLen; len += 1) {
		vec += (base[len + 1] ?? 0) - (base[len] ?? 0);
		limit[len] = vec - 1;
		vec <<= 1;
	}
	for (let len = minLen + 1; len <= maxLen; len += 1) {
		base[len] = ((limit[len - 1] ?? 0) + 1) * 2 - (base[len] ?? 0);
	}
	return { minLen, maxLen, limit, base, perm };
}

function decodeSymbol(reader: BitReader, table: DecodeTable): number {
	let len = table.minLen;
	let vec = reader.read(len);
	while (len <= table.maxLen && vec > (table.limit[len] ?? 0)) {
		vec = (vec << 1) | reader.read(1);
		len += 1;
	}
	if (len > table.maxLen)
		throw new RangeError(
			"bzip2: a count of the walk of the engine of no count",
		);
	const symbol = table.perm[vec - (table.base[len] ?? 0)];
	if (undefined === symbol)
		throw new RangeError(
			"bzip2: a count of the walk of the engine of no place",
		);
	return symbol;
}

function readSelectors(
	reader: BitReader,
	groupCount: number,
	selectorCount: number,
): Uint8Array {
	const selectors = new Uint8Array(selectorCount);
	for (let selector = 0; selector < selectorCount; selector += 1) {
		let value = 0;
		while (reader.read(1)) {
			value += 1;
			if (value >= groupCount) {
				throw new RangeError(
					"bzip2: a count of the walk of the engine past its counts",
				);
			}
		}
		selectors[selector] = value;
	}
	const order: number[] = [];
	for (let at = 0; at < groupCount; at += 1) order.push(at);
	for (let selector = 0; selector < selectorCount; selector += 1) {
		const place = selectors[selector] ?? 0;
		const value = order[place];
		if (undefined === value) {
			throw new RangeError(
				"bzip2: a count of the walk of the engine of no place",
			);
		}
		order.splice(place, 1);
		order.unshift(value);
		selectors[selector] = value;
	}
	return selectors;
}

function readGroups(
	reader: BitReader,
	groupCount: number,
	alphaSize: number,
): DecodeTable[] {
	const tables: DecodeTable[] = [];
	for (let group = 0; group < groupCount; group += 1) {
		const lengths = new Uint8Array(alphaSize);
		let current = reader.read(5);
		for (let symbol = 0; symbol < alphaSize; symbol += 1) {
			for (;;) {
				if (0 === reader.read(1)) break;
				if (reader.read(1)) {
					current -= 1;
					if (current < 0)
						throw new RangeError(
							"bzip2: counts of the walk of the engine of no place",
						);
				} else {
					current += 1;
					if (current > MOST_CODE_PLACES) {
						throw new RangeError(
							"bzip2: counts of the walk of the engine past their places",
						);
					}
				}
			}
			lengths[symbol] = current;
		}
		tables.push(buildTable(lengths, alphaSize));
	}
	return tables;
}

/** The places of a block of the stream, behind the walk of the places of the file of it. */
function readBlock(reader: BitReader): Buffer {
	reader.readLong();
	const randomized = reader.read(1);
	const origPtr = reader.read(24);
	if (randomized) {
		throw new RangeError(
			"bzip2: a block of the walk of the counts of the places of the file at random",
		);
	}
	const inUse16: boolean[] = [];
	for (let at = 0; at < 16; at += 1) inUse16.push(0 !== reader.read(1));
	const seqToUnseq: number[] = [];
	for (let row = 0; row < 16; row += 1) {
		if (!inUse16[row]) continue;
		for (let place = 0; place < 16; place += 1) {
			if (reader.read(1)) seqToUnseq.push(row * 16 + place);
		}
	}
	const nInUse = seqToUnseq.length;
	if (0 === nInUse)
		throw new RangeError("bzip2: a block of no places of the file at all");
	const groupCount = reader.read(GROUP_PLACES);
	const selectorCount = reader.read(SELECTOR_PLACES);
	if (
		groupCount < 2 ||
		groupCount > MOST_GROUPS ||
		selectorCount < 1 ||
		selectorCount > MOST_SELECTORS
	) {
		throw new RangeError("bzip2: counts of the walk of the engine of no place");
	}
	const selectors = readSelectors(reader, groupCount, selectorCount);
	const tables = readGroups(reader, groupCount, nInUse + 2);
	const mtf: number[] = [];
	for (let at = 0; at < nInUse; at += 1) mtf.push(at);
	const places: number[] = [];
	let selector = 0;
	let left = SELECTOR_SYMBOLS;
	let table = tables[selectors[0] ?? 0];
	const nextSymbol = (): number => {
		if (0 === left) {
			selector += 1;
			left = SELECTOR_SYMBOLS;
			table = tables[selectors[selector] ?? 0];
		}
		if (undefined === table)
			throw new RangeError(
				"bzip2: a count of the walk of the engine of no table",
			);
		left -= 1;
		return decodeSymbol(reader, table);
	};
	for (;;) {
		let symbol = nextSymbol();
		if (symbol === nInUse + 1) break; // `EOB`
		if (symbol <= RUN_B) {
			// The counts of the places of the file of the walk of the counts of them: `es` stands of the
			// counts of the walk of the engine, each of them standing of the counts of the places of the
			// walk of the engine of the places of it.
			let es = -1;
			let places_count = 1;
			for (;;) {
				es += (symbol === RUN_A ? 1 : 2) * places_count;
				places_count *= 2;
				symbol = nextSymbol();
				if (symbol > RUN_B) break;
			}
			es += 1;
			const front = mtf[0] ?? 0;
			for (let at = 0; at < es; at += 1) places.push(front);
			if (symbol === nInUse + 1) break; // `EOB`
		}
		if (symbol > nInUse)
			throw new RangeError(
				"bzip2: a count of the walk of the engine of no place",
			);
		const place = symbol - 1;
		const value = mtf[place] ?? 0;
		places.push(value);
		mtf.splice(place, 1);
		mtf.unshift(value);
	}
	// The walk of the places of the file itself: the counts of the walk of the counts of them stand of the
	// counts of the places of the file of the walk of the engine, and the places stand of the count of the
	// places of the file itself.
	const length = places.length;
	const counts = new Int32Array(MOST_COLOURS);
	for (const place of places) {
		const value = seqToUnseq[place] ?? 0;
		counts[value] = (counts[value] ?? 0) + 1;
	}
	const starts = new Int32Array(MOST_COLOURS + 1);
	let sum = 0;
	for (let value = 0; value < MOST_COLOURS; value += 1) {
		starts[value] = sum;
		sum += counts[value] ?? 0;
	}
	starts[MOST_COLOURS] = sum;
	if (length !== sum)
		throw new RangeError("bzip2: places of the walk of the engine of no count");
	const next = new Int32Array(length);
	const seen = new Int32Array(MOST_COLOURS);
	for (let at = 0; at < length; at += 1) {
		const value = seqToUnseq[places[at] ?? 0] ?? 0;
		const place = (starts[value] ?? 0) + (seen[value] ?? 0);
		next[place] = at;
		seen[value] = (seen[value] ?? 0) + 1;
	}
	const output = Buffer.alloc(length, 0x00);
	let at = origPtr;
	for (let index = 0; index < length; index += 1) {
		const place = next[at] ?? 0;
		output[index] = seqToUnseq[places[place] ?? 0] ?? 0;
		at = place;
	}
	return output;
}

/** The places of the file of the walk of the counts of them (`RLE1`), of the counts of the places of it. */
export function unescapeBzip2Runs(data: Buffer): Buffer {
	const out: number[] = [];
	let run = 0;
	let previous = -1;
	let at = 0;
	while (at < data.length) {
		const value = data[at] ?? 0;
		at += 1;
		out.push(value);
		run = value === previous ? run + 1 : 1;
		previous = value;
		// The count of the places of the file of the walk of the counts of them stands of the count of the
		// places of the file behind the four places of the file of the counts of them, and the walk of the
		// counts of the places of the file itself begins of a count of the places of the file of its own
		// behind that (of the counts of the places of the file of the walk of the counts of them alone).
		if (run < RUN_ESCAPE) continue;
		const extra = data[at] ?? 0;
		at += 1;
		for (let more = 0; more < extra; more += 1) out.push(value);
		run = 0;
	}
	return Buffer.from(out);
}

/** The places of a stream of bzip2, of the counts of the places of the file of the walk of them. */
export function decompressBzip2(data: Buffer): Buffer {
	if (data.length < 4 || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
		throw new RangeError("bzip2: a stream of no head of that format");
	}
	const level = (data[3] ?? 0) - 0x30;
	if (level < LEAST_LEVEL || level > MOST_LEVEL) {
		throw new RangeError(
			"bzip2: a stream of no count of the places of a block",
		);
	}
	const reader = new BitReader(data, 4);
	const parts: Buffer[] = [];
	let combined = 0;
	for (;;) {
		const word = reader.read(24) * 0x1000000 + reader.read(24);
		if (word === END_MAGIC) {
			const stored = reader.readLong();
			if (stored !== combined) {
				throw new RangeError(
					`bzip2: the count of the places of the file of the stream stands of no count of its own (${combined.toString(16)} against ${stored.toString(16)} at the place ${reader.position()} of ${data.length})`,
				);
			}
			break;
		}
		if (word !== BLOCK_MAGIC) {
			throw new RangeError(
				`bzip2: a stream of no word of a block (${word.toString(16)})`,
			);
		}
		const block = unescapeBzip2Runs(readBlock(reader));
		parts.push(block);
		const value = blockCrc(block);
		combined = (((combined << 1) | (combined >>> 31)) ^ value) >>> 0;
	}
	return Buffer.concat(parts);
}
