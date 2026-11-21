// Format reference: GARbro ArcFormats/KogadoCocotte.cs (class CocotteEncoder), which
// ArcFormats/Hypatia/ArcKogado.cs (class PakOpener) reads the compression type 2 entries of a HyPack archive
// through. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The stream is a run of blocks. Every block opens with two sixteen bit sizes: the size of the block as it
// stands in the stream, the four bytes of that pair included, and the size of the block as it unpacks. The
// bytes behind them are the block itself.
//
//  * A block whose bytes are as long as its unpacked size plus the two bytes of the index of the
//    Burrows-Wheeler transform holds those bytes as they stand; every other block is a carryless range
//    coded stream of the places of that transform.
//  * The range coder is Michael Schindler's qscoder, read through his quasistatic frequency model of two
//    hundred and fifty seven symbols: the two hundred and fifty six bytes and an end of block. The model
//    stands from block to block, and a stored block restarts it.
//  * Both kinds of block are then read back through a move-to-front order and the inverse of the
//    Burrows-Wheeler transform, whose two byte index opens the places the order left. The order stands from
//    block to block as well.
//
// The reference carries the walk of this codec as a port of the code of juicy.gt, which stands under the GNU
// GPL version 2; this file is an independent TypeScript walk of the algorithms that reference describes, of
// the published qscoder for the range coder and the model, and of the reference for the two transforms. It
// was checked against streams written by the published qscoder encoder itself.

import { BufferCursor, GarbroError } from "@garbro-mcp/core";

/** The block size of the encoder: no block of a real stream is longer than this. */
const BLOCK_SIZE = 0x2000;
const BLOCK_HEADER_SIZE = 4;
/** The two bytes that open the places of the Burrows-Wheeler transform. */
const TRANSFORM_INDEX_SIZE = 2;
/** The block buffer of the reference holds four blocks and the transform index. */
const MAX_BLOCK_SIZE = BLOCK_SIZE * 4;

const CODE_BITS = 32;
const EXTRA_BITS = ((CODE_BITS - 2) % 8) + 1;
const TOP_VALUE = 0x80000000;
const BOTTOM_VALUE = TOP_VALUE >>> 8;

const SYMBOL_COUNT = 257;
const END_SYMBOL = 256;
const TOTAL_FREQUENCY_LOG = 12;
const TOTAL_FREQUENCY = 1 << TOTAL_FREQUENCY_LOG;
const TARGET_RESCALE = 2000;
const SEARCH_TABLE_LOG = 7;
const SEARCH_SHIFT = TOTAL_FREQUENCY_LOG - SEARCH_TABLE_LOG;

/** The frequencies of the model before the first symbol, as the reference carries them. */
const INITIAL_FREQUENCIES = Uint16Array.from([
	1400, 640, 320, 240, 160, 120, 80, 64, 48, 40, 32, 24, 20, 20, 20, 20, 16, 16,
	16, 16, 12, 12, 12, 12, 12, 12, 8, 8, 8, 8, 8, 8, 6, 6, 6, 6, 6, 6, 6, 6, 6,
	6, 6, 6, 6, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4,
	4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,
	4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2,
]);

/**
 * The quasistatic frequency model of the qscoder: the frequencies of the symbols stand accumulated into a
 * table of cumulative frequencies, which is rebuilt from them at an interval that starts small and doubles
 * until it reaches the target.
 */
class CocotteModel {
	readonly #cumulative = new Uint16Array(SYMBOL_COUNT + 1);
	readonly #frequencies = new Uint16Array(SYMBOL_COUNT + 1);
	readonly #search = new Uint16Array((1 << SEARCH_TABLE_LOG) + 1);
	#rescale = 0;
	#nextLeft = 0;
	#increment = 0;
	#left = 0;

	constructor() {
		this.#cumulative[SYMBOL_COUNT] = TOTAL_FREQUENCY;
		this.#cumulative[0] = 0;
		this.#search[1 << SEARCH_TABLE_LOG] = SYMBOL_COUNT - 1;
		this.reset();
	}

	/** Puts the model back to the frequencies it starts from. */
	reset(): void {
		this.#rescale = (SYMBOL_COUNT >> 4) | 2;
		this.#nextLeft = 0;
		this.#frequencies.set(INITIAL_FREQUENCIES);
		this.#rescaleNow();
	}

	#rescaleNow(): void {
		if (this.#nextLeft !== 0) {
			this.#increment += 1;
			this.#left = this.#nextLeft;
			this.#nextLeft = 0;
			return;
		}
		if (this.#rescale < TARGET_RESCALE) {
			this.#rescale <<= 1;
			if (this.#rescale > TARGET_RESCALE) this.#rescale = TARGET_RESCALE;
		}
		let cumulative = this.#cumulative[SYMBOL_COUNT] ?? 0;
		let missing = cumulative;
		for (let symbol = SYMBOL_COUNT - 1; symbol !== 0; symbol -= 1) {
			let frequency = this.#frequencies[symbol] ?? 0;
			cumulative -= frequency;
			this.#cumulative[symbol] = cumulative;
			frequency = (frequency >> 1) | 1;
			missing -= frequency;
			this.#frequencies[symbol] = frequency;
		}
		if (cumulative !== this.#frequencies[0]) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Cocotte model rescale is inconsistent",
			);
		}
		this.#frequencies[0] = ((this.#frequencies[0] ?? 0) >> 1) | 1;
		missing -= this.#frequencies[0] ?? 0;
		this.#increment = Math.floor(missing / this.#rescale);
		this.#nextLeft = missing % this.#rescale;
		this.#left = this.#rescale - this.#nextLeft;
		let symbol = SYMBOL_COUNT;
		while (symbol !== 0) {
			const end = ((this.#cumulative[symbol] ?? 0) - 1) >> SEARCH_SHIFT;
			symbol -= 1;
			let start = (this.#cumulative[symbol] ?? 0) >> SEARCH_SHIFT;
			while (start <= end) {
				this.#search[start] = symbol;
				start += 1;
			}
		}
	}

	/** The frequencies of a symbol: its own, and the sum of the frequencies below it. */
	frequenciesOf(symbol: number): [number, number] {
		const lower = this.#cumulative[symbol] ?? 0;
		return [(this.#cumulative[symbol + 1] ?? 0) - lower, lower];
	}

	/** The symbol a cumulative frequency stands in. */
	symbolAt(lower: number): number {
		const place = lower >> SEARCH_SHIFT;
		let low = this.#search[place] ?? 0;
		let high = (this.#search[place + 1] ?? 0) + 1;
		while (low + 1 < high) {
			const middle = (low + high) >> 1;
			if (lower < (this.#cumulative[middle] ?? 0)) high = middle;
			else low = middle;
		}
		return low;
	}

	update(symbol: number): void {
		if (this.#left <= 0) this.#rescaleNow();
		this.#left -= 1;
		this.#frequencies[symbol] =
			((this.#frequencies[symbol] ?? 0) + this.#increment) & 0xffff;
	}
}

/**
 * The decoder of the carryless range coder of the qscoder. Every block starts a new coding, of the two bytes
 * that open it and of a new code range, while the model it reads through stands.
 */
class CocotteRangeDecoder {
	#source: Uint8Array = new Uint8Array(0);
	#position = 0;
	#low = 0;
	#range = 0;
	#help = 0;
	#buffer = 0;

	/**
	 * Reads the symbols of a block into `destination` until the end of block, and hands back how many were
	 * written. Nothing is written past the end of the destination.
	 */
	decode(
		source: Uint8Array,
		destination: Uint8Array,
		model: CocotteModel,
	): number {
		this.#source = source;
		this.#position = 0;
		this.#start();
		let written = 0;
		while (this.#position < source.length) {
			const symbol = model.symbolAt(this.#cumulative());
			if (symbol === END_SYMBOL) break;
			if (written >= destination.length) return 0;
			destination[written] = symbol;
			written += 1;
			const [frequency, lower] = model.frequenciesOf(symbol);
			this.#update(frequency, lower);
			model.update(symbol);
		}
		const [frequency, lower] = model.frequenciesOf(END_SYMBOL);
		this.#update(frequency, lower);
		this.#normalize();
		return written;
	}

	#start(): void {
		// The first byte only opens the coding; the one behind it holds the bits the code stands on.
		this.#nextByte();
		this.#buffer = this.#nextByte();
		this.#low = this.#buffer >> (8 - EXTRA_BITS);
		this.#range = 1 << EXTRA_BITS;
	}

	#nextByte(): number {
		const byte = this.#source[this.#position];
		if (byte === undefined) return 0;
		this.#position += 1;
		return byte;
	}

	#normalize(): void {
		while (this.#range <= BOTTOM_VALUE) {
			this.#low =
				((this.#low << 8) | ((this.#buffer << EXTRA_BITS) & 0xff)) >>> 0;
			this.#buffer = this.#nextByte();
			this.#low = (this.#low | (this.#buffer >>> (8 - EXTRA_BITS))) >>> 0;
			this.#range = (this.#range << 8) >>> 0;
		}
	}

	#cumulative(): number {
		this.#normalize();
		this.#help = this.#range >>> TOTAL_FREQUENCY_LOG;
		const value = Math.floor(this.#low / this.#help);
		return value >>> TOTAL_FREQUENCY_LOG !== 0 ? TOTAL_FREQUENCY - 1 : value;
	}

	#update(frequency: number, lower: number): void {
		const offset = Math.imul(this.#help, lower) >>> 0;
		this.#low = (this.#low - offset) >>> 0;
		if (lower + frequency < TOTAL_FREQUENCY) {
			this.#range = Math.imul(this.#help, frequency) >>> 0;
		} else {
			this.#range = (this.#range - offset) >>> 0;
		}
	}
}

/** The move-to-front order, whose table stands from block to block. */
class CocotteMoveToFront {
	readonly #order = new Uint8Array(0x100);

	constructor() {
		for (let value = 0; value < this.#order.length; value += 1) {
			this.#order[value] = value;
		}
	}

	decode(buffer: Uint8Array, size: number): void {
		for (let place = 0; place < size; place += 1) {
			const rank = buffer[place] ?? 0;
			const value = this.#order[rank] ?? 0;
			if (rank > 0) {
				this.#order.copyWithin(1, 0, rank);
				this.#order[0] = value;
			}
			buffer[place] = value;
		}
	}
}

/** The inverse of the Burrows-Wheeler transform of a block. */
class CocotteBurrowsWheeler {
	readonly #sortTable = new Int32Array(0x10000);
	readonly #count = new Int32Array(0x100);

	decode(
		destination: Buffer,
		destinationOffset: number,
		source: Uint8Array,
		size: number,
	): void {
		const top = (source[0] ?? 0) | ((source[1] ?? 0) << 8);
		const length = size - TRANSFORM_INDEX_SIZE;
		if (top >= length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Cocotte transform index is outside its block",
			);
		}
		this.#count.fill(0);
		for (let place = 0; place < length; place += 1) {
			const value = source[TRANSFORM_INDEX_SIZE + place] ?? 0;
			this.#count[value] = (this.#count[value] ?? 0) + 1;
		}
		for (let value = 1; value < this.#count.length; value += 1) {
			this.#count[value] =
				(this.#count[value] ?? 0) + (this.#count[value - 1] ?? 0);
		}
		for (let place = length - 1; place >= 0; place -= 1) {
			const value = source[TRANSFORM_INDEX_SIZE + place] ?? 0;
			const rank = (this.#count[value] ?? 0) - 1;
			this.#count[value] = rank;
			this.#sortTable[rank] = place;
		}
		let row = this.#sortTable[top] ?? 0;
		for (let place = 0; place < length; place += 1) {
			destination[destinationOffset + place] =
				source[TRANSFORM_INDEX_SIZE + row] ?? 0;
			row = this.#sortTable[row] ?? 0;
		}
	}
}

/**
 * Reads a Cocotte stream back into the `unpackedSize` bytes it stands for, as the compression type 2 entries
 * of a HyPack archive hold it.
 */
export function decompressCocotte(
	input: Uint8Array,
	unpackedSize: number,
): Buffer {
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Cocotte output size is invalid");
	}
	const source = new BufferCursor(input);
	const output = Buffer.alloc(unpackedSize);
	const block = new Uint8Array(MAX_BLOCK_SIZE + TRANSFORM_INDEX_SIZE);
	const model = new CocotteModel();
	const rangeDecoder = new CocotteRangeDecoder();
	const order = new CocotteMoveToFront();
	const transform = new CocotteBurrowsWheeler();
	let written = 0;

	while (source.remaining > 0) {
		if (source.remaining < BLOCK_HEADER_SIZE + 1) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Cocotte block header is truncated",
			);
		}
		const packedSize = source.readU16LE();
		const unpackedBlockSize = source.readU16LE();
		if (packedSize <= BLOCK_HEADER_SIZE || unpackedBlockSize === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Cocotte block size is invalid");
		}
		const payloadSize = packedSize - BLOCK_HEADER_SIZE;
		const transformedSize = unpackedBlockSize + TRANSFORM_INDEX_SIZE;
		if (transformedSize > block.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Cocotte block is too large");
		}
		if (written + unpackedBlockSize > output.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Cocotte stream is longer than its declared size",
			);
		}
		if (payloadSize > source.remaining) {
			throw new GarbroError("INVALID_ARCHIVE", "Cocotte block is truncated");
		}
		const payload = source.readBytes(payloadSize);
		if (payloadSize === transformedSize) {
			block.set(payload, 0);
			model.reset();
		} else {
			const decoded = rangeDecoder.decode(
				payload,
				block.subarray(0, transformedSize),
				model,
			);
			if (decoded !== transformedSize) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Cocotte block did not decode to its declared size",
				);
			}
		}
		order.decode(block, transformedSize);
		transform.decode(output, written, block, transformedSize);
		written += unpackedBlockSize;
	}
	if (written !== output.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Cocotte stream is shorter than its declared size",
		);
	}
	return output;
}
