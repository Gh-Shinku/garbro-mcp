// A writer of Cocotte streams, for the tests that walk them.
//
// The format is read by `packages/formats/src/hypatia/cocotte.ts`, and the reference carries only a reader:
// the encoder of `ArcFormats/KogadoCocotte.cs` stands commented out. This writer therefore stands of the
// published qscoder of Michael Schindler for the range coder and the quasistatic model, and of the
// Burrows-Wheeler transform and the move-to-front order that the format names, laid down independently of
// the reader: a naive order over every rotation through a doubling of the ranks, a table of the order
// moved to the front, and the carryless range coder of `rangecod.c`/`qsmodel.c`. Every block it writes was
// compared byte for byte with the output of the published encoder compiled from that source.
//
// It writes the blocks the reference's encoder would: a block whose coded form is no shorter than its
// transform is stored as it stands, and a stored block restarts the model.

const BLOCK_SIZE = 0x2000;
const BLOCK_HEADER_SIZE = 4;
const TRANSFORM_INDEX_SIZE = 2;
const SYMBOL_COUNT = 257;
const END_SYMBOL = 256;
const TOTAL_FREQUENCY_LOG = 12;
const TOTAL_FREQUENCY = 1 << TOTAL_FREQUENCY_LOG;
const TARGET_RESCALE = 2000;
const CODE_BITS = 32;
const SHIFT_BITS = CODE_BITS - 9;
const TOP_VALUE = 0x80000000;
const BOTTOM_VALUE = TOP_VALUE >>> 8;

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

class EncoderModel {
	readonly #cumulative = new Uint16Array(SYMBOL_COUNT + 1);
	readonly #frequencies = new Uint16Array(SYMBOL_COUNT + 1);
	#rescale = 0;
	#nextLeft = 0;
	#increment = 0;
	#left = 0;

	constructor() {
		this.#cumulative[SYMBOL_COUNT] = TOTAL_FREQUENCY;
		this.#cumulative[0] = 0;
		this.reset();
	}

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
		this.#frequencies[0] = ((this.#frequencies[0] ?? 0) >> 1) | 1;
		missing -= this.#frequencies[0] ?? 0;
		this.#increment = Math.floor(missing / this.#rescale);
		this.#nextLeft = missing % this.#rescale;
		this.#left = this.#rescale - this.#nextLeft;
	}

	frequenciesOf(symbol: number): [number, number] {
		const lower = this.#cumulative[symbol] ?? 0;
		return [(this.#cumulative[symbol + 1] ?? 0) - lower, lower];
	}

	update(symbol: number): void {
		if (this.#left <= 0) this.#rescaleNow();
		this.#left -= 1;
		this.#frequencies[symbol] =
			((this.#frequencies[symbol] ?? 0) + this.#increment) & 0xffff;
	}
}

class RangeEncoder {
	#low = 0;
	#range = 0;
	#buffer = 0;
	#help = 0;
	#byteCount = 0;
	#written: number[] = [];

	start(): void {
		this.#low = 0;
		this.#range = TOP_VALUE;
		this.#buffer = 0;
		this.#help = 0;
		this.#byteCount = 0;
		this.#written = [];
	}

	encode(frequency: number, lower: number): void {
		this.#normalize();
		const step = this.#range >>> TOTAL_FREQUENCY_LOG;
		const offset = Math.imul(step, lower) >>> 0;
		this.#low = (this.#low + offset) >>> 0;
		if ((lower + frequency) >> TOTAL_FREQUENCY_LOG !== 0) {
			this.#range = (this.#range - offset) >>> 0;
		} else {
			this.#range = Math.imul(step, frequency) >>> 0;
		}
	}

	finish(): Uint8Array {
		this.#normalize();
		this.#byteCount += 5;
		let last: number;
		if ((this.#low & (BOTTOM_VALUE - 1)) < (this.#byteCount & 0xffffff) >> 1) {
			last = this.#low >>> SHIFT_BITS;
		} else {
			last = (this.#low >>> SHIFT_BITS) + 1;
		}
		if (last > 0xff) {
			this.#write((this.#buffer + 1) & 0xff);
			while (this.#help > 0) {
				this.#write(0);
				this.#help -= 1;
			}
		} else {
			this.#write(this.#buffer);
			while (this.#help > 0) {
				this.#write(0xff);
				this.#help -= 1;
			}
		}
		this.#write(last & 0xff);
		this.#write((this.#byteCount >> 16) & 0xff);
		this.#write((this.#byteCount >> 8) & 0xff);
		this.#write(this.#byteCount & 0xff);
		return Uint8Array.from(this.#written);
	}

	#write(byte: number): void {
		this.#written.push(byte & 0xff);
	}

	#normalize(): void {
		while (this.#range <= BOTTOM_VALUE) {
			if (this.#low < 0x7f800000) {
				this.#write(this.#buffer);
				while (this.#help > 0) {
					this.#write(0xff);
					this.#help -= 1;
				}
				this.#buffer = (this.#low >>> SHIFT_BITS) & 0xff;
			} else if ((this.#low & TOP_VALUE) !== 0) {
				this.#write((this.#buffer + 1) & 0xff);
				while (this.#help > 0) {
					this.#write(0);
					this.#help -= 1;
				}
				this.#buffer = (this.#low >>> SHIFT_BITS) & 0xff;
			} else {
				this.#help += 1;
			}
			this.#range = (this.#range << 8) >>> 0;
			this.#low = (this.#low << 8) & (TOP_VALUE - 1);
			this.#byteCount += 1;
		}
	}
}

/** The forward Burrows-Wheeler transform: the rank of every rotation and the last places of all of them. */
function transform(data: Uint8Array): Uint8Array {
	const size = data.length;
	const output = new Uint8Array(size + TRANSFORM_INDEX_SIZE);
	if (0 === size) return output;
	let order = new Int32Array(size);
	let rank = new Int32Array(size);
	for (let place = 0; place < size; place += 1) {
		order[place] = place;
		rank[place] = data[place] ?? 0;
	}
	let next = new Int32Array(size);
	let width = 1;
	for (;;) {
		const sorted = Array.from(order).sort((left, right) => {
			const byRank = (rank[left] ?? 0) - (rank[right] ?? 0);
			if (0 !== byRank) return byRank;
			return (
				(rank[(left + width) % size] ?? 0) - (rank[(right + width) % size] ?? 0)
			);
		});
		next[sorted[0] ?? 0] = 0;
		for (let place = 1; place < size; place += 1) {
			const previous = sorted[place - 1] ?? 0;
			const current = sorted[place] ?? 0;
			const differs =
				rank[previous] !== rank[current] ||
				rank[(previous + width) % size] !== rank[(current + width) % size];
			next[current] = (next[previous] ?? 0) + (differs ? 1 : 0);
		}
		order = Int32Array.from(sorted);
		const previousRank = rank;
		rank = next;
		next = previousRank;
		if ((rank[order[size - 1] ?? 0] ?? 0) === size - 1) break;
		if (width * 2 >= size) break;
		width *= 2;
	}
	const sorted = Array.from(order).sort(
		(left, right) => (rank[left] ?? 0) - (rank[right] ?? 0),
	);
	let top = 0;
	for (let place = 0; place < size; place += 1) {
		const rotation = sorted[place] ?? 0;
		if (0 === rotation) top = place;
		output[TRANSFORM_INDEX_SIZE + place] =
			data[(rotation + size - 1) % size] ?? 0;
	}
	output[0] = top & 0xff;
	output[1] = (top >> 8) & 0xff;
	return output;
}

/** The move-to-front order, whose table stands from block to block. */
class MoveToFront {
	readonly #table = new Uint8Array(0x100);

	constructor() {
		for (let value = 0; value < this.#table.length; value += 1) {
			this.#table[value] = value;
		}
	}

	encode(data: Uint8Array): void {
		for (let place = 0; place < data.length; place += 1) {
			const value = data[place] ?? 0;
			let rank = 0;
			while (this.#table[rank] !== value) rank += 1;
			if (rank > 0) {
				this.#table.copyWithin(1, 0, rank);
				this.#table[0] = value;
			}
			data[place] = rank;
		}
	}
}

export interface CocotteWriterOptions {
	/** `store` writes every block as it stands; otherwise a block the coder could not shorten is stored. */
	mode?: "auto" | "store";
}

/** Writes `data` as a Cocotte stream, in blocks of the size the reference's encoder uses. */
export function encodeCocotte(
	data: Uint8Array,
	options: CocotteWriterOptions = {},
): Buffer {
	const mode = options.mode ?? "auto";
	const blocks: Buffer[] = [];
	const model = new EncoderModel();
	const order = new MoveToFront();
	const encoder = new RangeEncoder();
	for (let cursor = 0; cursor < data.length; cursor += BLOCK_SIZE) {
		const size = Math.min(BLOCK_SIZE, data.length - cursor);
		const transformed = transform(data.subarray(cursor, cursor + size));
		order.encode(transformed);
		encoder.start();
		for (const symbol of transformed) {
			const [frequency, lower] = model.frequenciesOf(symbol);
			encoder.encode(frequency, lower);
			model.update(symbol);
		}
		const [frequency, lower] = model.frequenciesOf(END_SYMBOL);
		encoder.encode(frequency, lower);
		const coded = encoder.finish();
		// A block whose coded form is no shorter than its transform is stored, as the reference's encoder
		// does. The decoder cannot tell the two apart at an equal length, since that is where the stored
		// kind stands, so the fallback is a rule of the format rather than a choice.
		const stored = "store" === mode || coded.length >= transformed.length;
		if (stored) model.reset();
		const header = Buffer.alloc(BLOCK_HEADER_SIZE);
		const payload = stored ? transformed : coded;
		header.writeUInt16LE(payload.length + BLOCK_HEADER_SIZE, 0);
		header.writeUInt16LE(size, 2);
		blocks.push(
			header,
			Buffer.from(payload.buffer, payload.byteOffset, payload.length),
		);
	}
	return Buffer.concat(blocks);
}
