// A walk of a stream of LZMA and of the LZMA-alone and ZIP shapes of it. The reference carries the decoder of
// the LZMA SDK, version 18.05, in "ArcFormats/Lzma" and hands its streams over to it; that SDK code stands in
// the public domain, so this port of the same walk stands under this project's licence.
//
// A stream opens with five bytes of properties - one byte that carries three counts, and four bytes of the
// dictionary size, little endian - and then a range coded stream. The properties stand of:
//
//   * `lc`, the count of the high places of the place of the file in front of a literal and of the place of
//     the file itself, which stands behind the place of the file of the picture;
//   * `lp`, the count of the low places of the place of the file, of a count of its own to a place of the
//     stream of the picture; and
//   * `pb`, the count of the places of the place of the file of a count of its own, of a match of its own.
//
// The shapes around those properties differ: an LZMA-alone stream carries a head of thirteen bytes, of the
// properties and then the count of the places of the file of the stream, little endian, which stands of
// 0xFFFFFFFFFFFFFFFF where the writer left it open; a ZIP entry of the fourteenth method carries a head of
// four bytes - two of a version, two of the count of the properties - in front of the properties.

import { Buffer } from "node:buffer";

const PROBABILITY_PLACES = 11;
const PROBABILITY_WHOLE = 1 << PROBABILITY_PLACES;
const MOVE_PLACES = 5;
const TOP_VALUE = 1 << 24;

const STATES = 12;
const POS_STATES_BITS = 4;
const POS_STATES = 1 << POS_STATES_BITS;
const MATCH_LEAST = 2;
const LEN_TO_POS_STATES = 4;
const ALIGN_BITS = 4;
const ALIGN_TABLE_PLACES = 1 << ALIGN_BITS;
const POS_SLOT_BITS = 6;
const POS_SLOT_PLACES = 1 << POS_SLOT_BITS;
const START_POS_MODEL = 4;
const END_POS_MODEL = 14;
const FULL_DISTANCES = 1 << (END_POS_MODEL / 2);
const LOW_LEN_BITS = 3;
const MID_LEN_BITS = 3;
const HIGH_LEN_BITS = 8;
const LOW_LEN_SYMBOLS = 1 << LOW_LEN_BITS;
const MID_LEN_SYMBOLS = 1 << MID_LEN_BITS;
const LEN_SYMBOLS = LOW_LEN_SYMBOLS + MID_LEN_SYMBOLS + (1 << HIGH_LEN_BITS);
const LITERAL_CODERS = 0x300;
/** The count of the places of the file a stream that stands of no count of its own may reach here. */
const MOST_OUTPUT = 1 << 30;

/** The properties a stream opens with: the three counts and the dictionary size they stand of. */
export interface LzmaProperties {
	lc: number;
	lp: number;
	pb: number;
	dictionarySize: number;
}

/**
 * The five bytes of properties, as the SDK reads them: the first byte stands of `(pb * 5 + lp) * 9 + lc` and
 * the four behind it of the dictionary size, little endian.
 */
export function readLzmaProperties(data: Buffer): LzmaProperties | undefined {
	if (data.length < 5) return undefined;
	const first = data[0] ?? 0;
	const lc = first % 9;
	const rest = Math.trunc(first / 9);
	const lp = rest % 5;
	const pb = Math.trunc(rest / 5);
	if (pb > POS_STATES_BITS || lp > 8 || lc > 8) return undefined;
	const dictionarySize = data.readUInt32LE(1);
	return { lc, lp, pb, dictionarySize };
}

/** The five bytes the properties stand of, the other way about. */
export function writeLzmaProperties(properties: LzmaProperties): Buffer {
	const out = Buffer.alloc(5, 0x00);
	out[0] = (properties.pb * 5 + properties.lp) * 9 + properties.lc;
	out.writeUInt32LE(properties.dictionarySize >>> 0, 1);
	return out;
}

function lenToPosState(length: number): number {
	const rest = length - MATCH_LEAST;
	return rest < LEN_TO_POS_STATES ? rest : LEN_TO_POS_STATES - 1;
}

/** The range decoder of the SDK: a code word read from the places of the file of the stream itself. */
class RangeReader {
	readonly #data: Buffer;
	#at: number;
	#range = 0xffffffff;
	#code = 0;

	constructor(data: Buffer, at: number) {
		this.#data = data;
		this.#at = at;
	}

	/** `Decoder.Init`: five places of the file, of which the first stands at the top of the code word. */
	init(): void {
		this.#code = 0;
		this.#range = 0xffffffff;
		for (let index = 0; index < 5; index += 1) {
			this.#code = ((this.#code << 8) | this.#read()) >>> 0;
		}
	}

	/** The place of the file behind a stream of no count of its own, so a caller can see it stand read. */
	get at(): number {
		return this.#at;
	}

	#read(): number {
		const byte = this.#at < this.#data.length ? (this.#data[this.#at] ?? 0) : 0;
		this.#at += 1;
		return byte;
	}

	#normalize(): void {
		if (this.#range < TOP_VALUE) {
			this.#code = ((this.#code << 8) | this.#read()) >>> 0;
			this.#range = (this.#range << 8) >>> 0;
		}
	}

	/** `BitDecoder.Decode`: one count of the walk of the engine, of the counts of a place of its own. */
	decodeBit(probabilities: Uint16Array, index: number): number {
		const probability = probabilities[index] ?? 0;
		const bound =
			Math.imul(this.#range >>> PROBABILITY_PLACES, probability) >>> 0;
		let bit: number;
		if (this.#code < bound) {
			this.#range = bound;
			probabilities[index] =
				(probability + ((PROBABILITY_WHOLE - probability) >> MOVE_PLACES)) &
				0xffff;
			bit = 0;
		} else {
			this.#range = (this.#range - bound) >>> 0;
			this.#code = (this.#code - bound) >>> 0;
			probabilities[index] =
				(probability - (probability >> MOVE_PLACES)) & 0xffff;
			bit = 1;
		}
		this.#normalize();
		return bit;
	}

	/** `Decoder.DecodeDirectBits`: a count of its own, of no counts of the walk of the engine. */
	decodeDirectBits(count: number): number {
		let result = 0;
		for (let index = 0; index < count; index += 1) {
			this.#range = this.#range >>> 1;
			let bit = 0;
			if (this.#code >= this.#range) {
				this.#code = (this.#code - this.#range) >>> 0;
				bit = 1;
			}
			result = ((result << 1) | bit) >>> 0;
			this.#normalize();
		}
		return result;
	}

	/** `BitTreeDecoder.Decode`: a symbol of a count of its own, from the high place of the file down. */
	decodeTree(probabilities: Uint16Array, offset: number, bits: number): number {
		let place = 1;
		for (let index = 0; index < bits; index += 1) {
			place = (place << 1) | this.decodeBit(probabilities, offset + place);
		}
		return place - (1 << bits);
	}

	/** `BitTreeDecoder.ReverseDecode`: the same, from the low place of the file up. */
	reverseDecodeTree(
		probabilities: Uint16Array,
		offset: number,
		bits: number,
	): number {
		let place = 1;
		let symbol = 0;
		for (let index = 0; index < bits; index += 1) {
			const bit = this.decodeBit(probabilities, offset + place);
			place = (place << 1) | bit;
			symbol |= bit << index;
		}
		return symbol;
	}

	/** The reverse walk of the SDK's own static `ReverseDecode`, of the places of the file of a distance. */
	reverseDecodePlaces(
		probabilities: Uint16Array,
		start: number,
		bits: number,
	): number {
		let place = 1;
		let symbol = 0;
		for (let index = 0; index < bits; index += 1) {
			const bit = this.decodeBit(probabilities, start + place);
			place = (place << 1) | bit;
			symbol |= bit << index;
		}
		return symbol;
	}
}

/** `LenDecoder`: a count of the places of a match or of a place of the file read back, of three ranges. */
class LengthDecoder {
	readonly #choice = new Uint16Array(2);
	readonly #low: Uint16Array;
	readonly #mid: Uint16Array;
	readonly #high = new Uint16Array(1 << HIGH_LEN_BITS);
	readonly #posStates: number;

	constructor(posStates: number) {
		this.#posStates = posStates;
		this.#low = new Uint16Array(posStates * (1 << LOW_LEN_BITS));
		this.#mid = new Uint16Array(posStates * (1 << MID_LEN_BITS));
		this.init();
	}

	init(): void {
		this.#choice.fill(PROBABILITY_WHOLE >> 1);
		this.#low.fill(PROBABILITY_WHOLE >> 1);
		this.#mid.fill(PROBABILITY_WHOLE >> 1);
		this.#high.fill(PROBABILITY_WHOLE >> 1);
	}

	decode(reader: RangeReader, posState: number): number {
		if (0 === reader.decodeBit(this.#choice, 0)) {
			return reader.decodeTree(
				this.#low,
				posState * (1 << LOW_LEN_BITS),
				LOW_LEN_BITS,
			);
		}
		if (0 === reader.decodeBit(this.#choice, 1)) {
			return (
				LOW_LEN_SYMBOLS +
				reader.decodeTree(
					this.#mid,
					posState * (1 << MID_LEN_BITS),
					MID_LEN_BITS,
				)
			);
		}
		return (
			LOW_LEN_SYMBOLS +
			MID_LEN_SYMBOLS +
			reader.decodeTree(this.#high, 0, HIGH_LEN_BITS)
		);
	}
}

/** `LiteralDecoder`: the counts of the walk of the engine of a place of the file, of its own places. */
class LiteralDecoder {
	readonly #coders: Uint16Array;
	readonly #lc: number;
	readonly #lp: number;
	readonly #posMask: number;

	constructor(lc: number, lp: number) {
		this.#lc = lc;
		this.#lp = lp;
		this.#posMask = (1 << lp) - 1;
		this.#coders = new Uint16Array((1 << (lc + lp)) * LITERAL_CODERS);
		this.#coders.fill(PROBABILITY_WHOLE >> 1);
	}

	#state(pos: number, prevByte: number): number {
		return (
			(((pos & this.#posMask) << this.#lc) + (prevByte >> (8 - this.#lc))) *
			LITERAL_CODERS
		);
	}

	decodeNormal(reader: RangeReader, pos: number, prevByte: number): number {
		const state = this.#state(pos, prevByte);
		let symbol = 1;
		do {
			symbol = (symbol << 1) | reader.decodeBit(this.#coders, state + symbol);
		} while (symbol < 0x100);
		return symbol & 0xff;
	}

	decodeWithMatchByte(
		reader: RangeReader,
		pos: number,
		prevByte: number,
		matchByte: number,
	): number {
		const state = this.#state(pos, prevByte);
		let symbol = 1;
		let match = matchByte;
		do {
			const matchBit = (match >> 7) & 1;
			match = (match << 1) & 0xff;
			const bit = reader.decodeBit(
				this.#coders,
				state + ((1 + matchBit) << 8) + symbol,
			);
			symbol = (symbol << 1) | bit;
			if (matchBit !== bit) {
				while (symbol < 0x100) {
					symbol =
						(symbol << 1) | reader.decodeBit(this.#coders, state + symbol);
				}
				break;
			}
		} while (symbol < 0x100);
		return symbol & 0xff;
	}
}

/** The counts of the walk of the engine of the state of the decoder, of the state the reference keeps. */
function updateChar(state: number): number {
	if (state < 4) return 0;
	if (state < 10) return state - 3;
	return state - 6;
}

/**
 * Unpacks a stream of LZMA, of the counts of the places of the file of it where the caller knows them. A
 * stream of no such count stands read to the end marker of the writer, of `0xFFFFFFFF` as the place of a
 * match that stands behind the stream itself.
 */
export function decompressLzmaRaw(
	input: Buffer,
	properties: LzmaProperties,
	unpackedSize?: number,
): Buffer {
	if (
		properties.lc > 8 ||
		properties.lp > 8 ||
		properties.pb > POS_STATES_BITS
	) {
		throw new RangeError(
			"lzma: the counts of the places of the file stand beyond their own",
		);
	}
	const posStates = 1 << properties.pb;
	const posStateMask = posStates - 1;
	const dictionarySizeCheck = Math.max(properties.dictionarySize, 1);
	const reader = new RangeReader(input, 0);
	reader.init();
	const literal = new LiteralDecoder(properties.lc, properties.lp);
	const lengths = new LengthDecoder(POS_STATES);
	const repLengths = new LengthDecoder(POS_STATES);
	const isMatch = new Uint16Array(STATES * POS_STATES).fill(
		PROBABILITY_WHOLE >> 1,
	);
	const isRep = new Uint16Array(STATES).fill(PROBABILITY_WHOLE >> 1);
	const isRepG0 = new Uint16Array(STATES).fill(PROBABILITY_WHOLE >> 1);
	const isRepG1 = new Uint16Array(STATES).fill(PROBABILITY_WHOLE >> 1);
	const isRepG2 = new Uint16Array(STATES).fill(PROBABILITY_WHOLE >> 1);
	const isRep0Long = new Uint16Array(STATES * POS_STATES).fill(
		PROBABILITY_WHOLE >> 1,
	);
	const posSlots = new Uint16Array(LEN_TO_POS_STATES * POS_SLOT_PLACES).fill(
		PROBABILITY_WHOLE >> 1,
	);
	const posDecoders = new Uint16Array(FULL_DISTANCES - END_POS_MODEL).fill(
		PROBABILITY_WHOLE >> 1,
	);
	const posAlign = new Uint16Array(ALIGN_TABLE_PLACES).fill(
		PROBABILITY_WHOLE >> 1,
	);
	// A stream of no count of its own stands read to the end marker of the writer. The reference reads the
	// places of the file of the stream past its end as nought and would never stop; this port turns a stream
	// that stands more than a few places of the file beyond its own away instead.
	const endOfInput = input.length + 8;
	const room =
		undefined === unpackedSize
			? 0x10000
			: Math.min(Math.max(unpackedSize, 1), MOST_OUTPUT);
	let output: Buffer = Buffer.alloc(room, 0x00);
	let state = 0;
	let rep0 = 0;
	let rep1 = 0;
	let rep2 = 0;
	let rep3 = 0;
	let pos = 0;
	if (undefined !== unpackedSize && 0 === unpackedSize) return Buffer.alloc(0);
	// The reference reads the first place of the file of a stream on its own, of no count of a match, where it
	// knows the stream stands of more than no places of the file. A stream of no count of its own may open of
	// the end marker itself, which is how a writer leaves an empty stream behind.
	state = 0;
	if (0 === reader.decodeBit(isMatch, 0)) {
		state = updateChar(state);
		output[0] = literal.decodeNormal(reader, 0, 0);
		pos = 1;
	} else if (undefined !== unpackedSize) {
		throw new RangeError(
			"lzma: the stream opens of no place of the file of its own",
		);
	}
	for (;;) {
		if (undefined !== unpackedSize && pos >= unpackedSize) break;
		if (undefined === unpackedSize && reader.at > endOfInput) {
			throw new RangeError(
				"lzma: the stream stands of no end marker of its own and stands read past its own places of the file",
			);
		}
		if (pos >= MOST_OUTPUT)
			throw new RangeError("lzma: the stream stands of too many places");
		const posState = pos & posStateMask;
		if (
			0 === reader.decodeBit(isMatch, (state << POS_STATES_BITS) + posState)
		) {
			const prevByte = output[pos - 1] ?? 0;
			const byte =
				state < 7
					? literal.decodeNormal(reader, pos, prevByte)
					: literal.decodeWithMatchByte(
							reader,
							pos,
							prevByte,
							output[pos - rep0 - 1] ?? 0,
						);
			if (pos >= output.length) output = grow(output, pos + 1);
			output[pos] = byte;
			pos += 1;
			state = updateChar(state);
			continue;
		}
		let length: number;
		if (1 === reader.decodeBit(isRep, state)) {
			if (0 === reader.decodeBit(isRepG0, state)) {
				if (
					0 ===
					reader.decodeBit(isRep0Long, (state << POS_STATES_BITS) + posState)
				) {
					state = state < 7 ? 9 : 11;
					if (pos >= output.length) output = grow(output, pos + 1);
					output[pos] = output[pos - rep0 - 1] ?? 0;
					pos += 1;
					continue;
				}
			} else {
				let distance: number;
				if (0 === reader.decodeBit(isRepG1, state)) {
					distance = rep1;
				} else {
					if (0 === reader.decodeBit(isRepG2, state)) {
						distance = rep2;
					} else {
						distance = rep3;
						rep3 = rep2;
					}
					rep2 = rep1;
				}
				rep1 = rep0;
				rep0 = distance;
			}
			length = repLengths.decode(reader, posState) + MATCH_LEAST;
			state = state < 7 ? 8 : 11;
		} else {
			rep3 = rep2;
			rep2 = rep1;
			rep1 = rep0;
			length = MATCH_LEAST + lengths.decode(reader, posState);
			state = state < 7 ? 7 : 10;
			const posSlot = reader.decodeTree(
				posSlots,
				lenToPosState(length) * POS_SLOT_PLACES,
				POS_SLOT_BITS,
			);
			if (posSlot >= START_POS_MODEL) {
				const directBits = (posSlot >> 1) - 1;
				rep0 = ((2 | (posSlot & 1)) << directBits) >>> 0;
				if (posSlot < END_POS_MODEL) {
					rep0 =
						(rep0 +
							reader.reverseDecodePlaces(
								posDecoders,
								rep0 - posSlot - 1,
								directBits,
							)) >>>
						0;
				} else {
					rep0 =
						(rep0 +
							((reader.decodeDirectBits(directBits - ALIGN_BITS) <<
								ALIGN_BITS) >>>
								0)) >>>
						0;
					rep0 =
						(rep0 + reader.reverseDecodeTree(posAlign, 0, ALIGN_BITS)) >>> 0;
				}
			} else {
				rep0 = posSlot;
			}
		}
		if (rep0 >= pos || rep0 >= dictionarySizeCheck) {
			// The end marker of a writer that left the count of the places of its file open.
			if (0xffffffff === rep0) break;
			throw new RangeError(
				`lzma: the stream stands of a place of a match beyond its own (${rep0})`,
			);
		}
		if (pos + length > output.length) output = grow(output, pos + length);
		for (let index = 0; index < length; index += 1) {
			output[pos] = output[pos - rep0 - 1] ?? 0;
			pos += 1;
		}
	}
	if (undefined !== unpackedSize && pos > unpackedSize) {
		return Buffer.from(output.subarray(0, unpackedSize));
	}
	return Buffer.from(output.subarray(0, pos));
}

/** A place of the file more room, of the counts of the places of the file it stands of. */
function grow(output: Buffer, needed: number): Buffer {
	let size = output.length;
	while (size < needed) size *= 2;
	const grown = Buffer.alloc(size, 0x00);
	output.copy(grown);
	return grown;
}

/**
 * Unpacks a stream of LZMA alone: five bytes of properties and eight bytes of the count of the places of the
 * file behind them, little endian, which stand of nought where the writer left that count open.
 */
export function decompressLzmaAlone(input: Buffer): Buffer {
	if (input.length < 13)
		throw new RangeError("lzma: the stream stands short of its own head");
	const properties = readLzmaProperties(input);
	if (!properties)
		throw new RangeError(
			"lzma: the counts of the places of the file stand beyond their own",
		);
	const size = input.readBigUInt64LE(5);
	const unpacked = 0xffffffffffffffffn === size ? undefined : Number(size);
	return decompressLzmaRaw(input.subarray(13), properties, unpacked);
}

/**
 * Unpacks the payload of a ZIP entry of the fourteenth method: a head of four bytes - a version of two, the
 * count of the properties of two - and then the properties of a stream of LZMA.
 */
export function decompressLzmaZip(input: Buffer, unpackedSize: number): Buffer {
	if (input.length < 9)
		throw new RangeError("lzma: the payload stands short of its own head");
	const propertiesSize = input.readUInt16LE(2);
	if (propertiesSize < 5 || 4 + propertiesSize > input.length) {
		throw new RangeError(
			"lzma: the payload names no count of properties of its own",
		);
	}
	const properties = readLzmaProperties(input.subarray(4));
	if (!properties)
		throw new RangeError(
			"lzma: the counts of the places of the file stand beyond their own",
		);
	return decompressLzmaRaw(
		input.subarray(4 + propertiesSize),
		properties,
		unpackedSize,
	);
}
