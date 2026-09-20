// Format reference: GARbro "ArcFormats/uGOS/ImageBMP.cs", class `DetBmpFormat.Reader`. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The places of the picture are walked as one stream of
// instructions: every instruction names one of a hundred and sixty-three predictors through a list whose order
// changes as the picture is walked, the instructions used drawn forward. Places stand in four places.

import { GarbroError } from "@garbro-mcp/core";

/** Where the predictors of the instructions stand, relative to the place being written. */
const OFFSETS_X: readonly number[] = [
	-1, 0, 1, -1, -2, -2, -2, -1, 0, 1, 2, 2, -3, -3, -3, -3, -2, -1, 0, 1, 2, 3,
	3, 3, -4, -4, -4, -4, -4, -3, -2, -1, 0, 1, 2, 3, 4, 4, 4, 4,
];
const OFFSETS_Y: readonly number[] = [
	0, -1, -1, -1, 0, -1, -2, -2, -2, -2, -2, -1, 0, -1, -2, -3, -3, -3, -3, -3,
	-3, -3, -2, -1, 0, -1, -2, -3, -4, -4, -4, -4, -4, -4, -4, -4, -4, -3, -2, -1,
];

/** The words of the instructions, of which two stand before the first instruction that names a predictor. */
const INSTRUCTION_COUNT = 163;
const FIRST_PREDICTOR_INSTRUCTION = 3;
const PREDICTOR_INSTRUCTIONS = 40;
const PLACES_PER_PLACE = 4;
const BITS_PER_BYTE = 8;

export interface DetTables {
	/** How many places the words of a byte stand in, and the words they carry. */
	firstShifts: Uint8Array;
	firstWords: Uint8Array;
	secondShifts: Uint8Array;
	secondWords: Uint8Array;
	/** How many places the word at a place of the picture stands in, for every word of a byte. */
	wordLengths: Uint8Array;
}

function signedByte(value: number): number {
	const byte = value & 0xff;
	return byte < 0x80 ? byte : byte - 0x100;
}

/**
 * `InitTable0`: for every word of a byte the places it carries and how many places it stands in, once with the
 * place behind the word kept and once with it dropped, and how many places a byte stands in until the places
 * behind it stand clear.
 */
export function createDetTables(): DetTables {
	const firstShifts = new Uint8Array(256);
	const firstWords = new Uint8Array(256);
	const secondShifts = new Uint8Array(256);
	const secondWords = new Uint8Array(256);
	const wordLengths = new Uint8Array(256);
	for (let i = 0; i < 256; i += 1) {
		let shifts = 0;
		let word = signedByte(i);
		if (i !== 0) {
			while (word < 0) {
				word = signedByte((word << 1) & 0xff);
				shifts += 1;
			}
			word = (word << 1) & 0xff;
			// The shifting above drops the place that stands behind the word, so a word that stands clear of
			// it stands in one place fewer than the places that were counted.
			if (word === 0) shifts -= 1;
		}
		firstShifts[i] = (shifts + 1) & 0xff;
		firstWords[i] = word & 0xff;

		let secondShiftCount = 0;
		let second = signedByte(i);
		if (i !== 0) {
			while (second < 0) {
				second = signedByte((second << 1) & 0xff);
				secondShiftCount += 1;
			}
			second = (second << 1) & 0xff;
		}
		secondShifts[i] = secondShiftCount & 0xff;
		// The reference adds the place behind the second word to a word the places of which were shifted into
		// the places above the byte, so the adding stands within a byte as well.
		secondWords[i] = (signedByte(second) + (1 << secondShiftCount)) & 0xff;

		let length = 0;
		for (let at = i; (at & 0x7f) !== 0; at = (at << 1) >>> 0) length += 1;
		wordLengths[i] = length & 0xff;
	}
	return { firstShifts, firstWords, secondShifts, secondWords, wordLengths };
}

/**
 * `InitTable1`: the reference builds a table of the instructions and stands the place of every instruction
 * within it the other way about, so that the instruction at a place of the table can be drawn from the place.
 */
function createInstructionPlace(): Int32Array {
	const place = new Int32Array(INSTRUCTION_COUNT);
	place[0] = 0;
	place[1] = 1;
	place[2] = 2;
	let at = 44;
	for (let i = FIRST_PREDICTOR_INSTRUCTION; i < 43; i += 1) {
		place[i] = i + 120;
		place[i + 40] = i;
		place[i + 80] = at - 1;
		place[i + 120] = at;
		at += 2;
	}
	const inverse = new Int32Array(INSTRUCTION_COUNT);
	for (let i = 0; i < INSTRUCTION_COUNT; i += 1) {
		const left = place[i] ?? 0;
		if (left < 0 || left >= INSTRUCTION_COUNT)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"A place of an instruction stands without it",
			);
		inverse[left] = i;
	}
	return inverse;
}

class DetReader {
	private readonly data: Buffer;
	private readonly width: number;
	private readonly height: number;
	private readonly bpp: number;
	private position = 0x10;
	private bits = 0;
	private readonly tables: DetTables;
	/** The place an instruction's predictor stands at, for every instruction. */
	private readonly inverse: Int32Array;
	/** The instructions in the order they are drawn, recorded afresh for every picture. */
	private readonly moving = new Int32Array(INSTRUCTION_COUNT);
	/** Where the predictors of an instruction stand, for the instructions that name a predictor. */
	private readonly offsets: Int32Array;
	readonly output: Buffer;

	constructor(
		data: Buffer,
		width: number,
		height: number,
		bitsPerPixel: number,
	) {
		this.data = data;
		this.width = width;
		this.height = height;
		this.bpp = bitsPerPixel;
		this.output = Buffer.alloc(width * height * PLACES_PER_PLACE);
		this.tables = createDetTables();
		this.inverse = createInstructionPlace();
		for (let i = 0; i < INSTRUCTION_COUNT; i += 1) this.moving[i] = i;
		this.offsets = new Int32Array(PREDICTOR_INSTRUCTIONS);
		for (let i = 0; i < PREDICTOR_INSTRUCTIONS; i += 1)
			this.offsets[i] = (OFFSETS_X[i] ?? 0) + width * (OFFSETS_Y[i] ?? 0);
	}

	/** `Reader.Unpack`. */
	unpack(): Buffer {
		let dst = 0;
		while (dst < this.output.length) {
			const word = this.readNext();
			const place = word - 2;
			if (place < 0 || place >= INSTRUCTION_COUNT)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"An instruction stands without a place",
				);
			const instruction = this.moving[place] ?? 0;
			const predictor = this.inverse[instruction] ?? 0;
			let at = place;
			const least = Math.max(word - 4, 0);
			// The instruction drawn forward: the instructions before it in the list stand one place further
			// along, and it stands where the first of them stood.
			for (let count = place - least; count > 0; count -= 1) {
				this.moving[at] = this.moving[at - 1] ?? 0;
				at -= 1;
			}
			this.moving[at] = instruction;

			if (predictor === 2) {
				// A place copied from a place already walked, named by two instructions.
				const first = this.readNext();
				const second = this.readNext();
				const offset =
					(((first & 1) - 1) ^ (second - 2)) -
					this.width * ((first & 1) - 1 + (first >> 1));
				this.write(dst, this.read(dst + PLACES_PER_PLACE * offset));
				dst += PLACES_PER_PLACE;
				continue;
			}

			if (predictor >= 43) {
				// A place named by three words that stand for the places of its difference from a predictor.
				let value: number;
				if (predictor >= 123) {
					const known = this.offsets[predictor - 123] ?? 0;
					value = this.read(dst - PLACES_PER_PLACE * this.width);
					value = (value + this.read(dst + PLACES_PER_PLACE * known)) | 0;
					value =
						(value - this.read(dst + PLACES_PER_PLACE * (known - this.width))) |
						0;
				} else if (predictor >= 83) {
					const known = this.offsets[predictor - 83] ?? 0;
					value = this.read(dst + PLACES_PER_PLACE * known);
					value = (value + this.read(dst - PLACES_PER_PLACE)) | 0;
					value =
						(value -
							this.read(dst + PLACES_PER_PLACE * known - PLACES_PER_PLACE)) |
						0;
				} else {
					value = this.read(
						dst + PLACES_PER_PLACE * (this.offsets[predictor - 43] ?? 0),
					);
				}
				// The words stand for the places of the difference, the first of them above the place behind
				// the word and the last one in the place behind it.
				let word2 = this.readNext();
				let difference = (word2 - 2) ^ -(word2 & 1);
				value += difference << 15;
				word2 = this.readNext();
				difference = (word2 - 2) ^ -(word2 & 1);
				value += difference << 7;
				word2 = this.readNext();
				difference = (word2 - 2) ^ -(word2 & 1);
				difference -= difference >> 31;
				this.write(dst, (value + (difference >> 1)) | 0);
				dst += PLACES_PER_PLACE;
				continue;
			}

			if (predictor === 0) {
				// A place that stands as it is written, the places of it standing in the words behind it.
				const placeBits = this.bits & 0xff;
				let value =
					((this.readByte() << 16) |
						(this.readByte() << 8) |
						this.readByte()) >>>
					0;
				value = (value << 8) >>> 0;
				// The reference stands the place behind the word in every place of the value and turns the
				// places that stand behind a place of the picture about.
				const shifted =
					((value ^ 0x80000080) >>> 0) >>>
					(this.tables.wordLengths[placeBits] ?? 0);
				this.bits = shifted;
				this.write(dst, ((placeBits << 16) ^ (shifted >>> 8)) | 0);
				dst += PLACES_PER_PLACE;
				continue;
			}

			const first = this.readNext();
			const second = this.readNext();
			const offset =
				(((first & 1) - 1) ^ (second - 2)) -
				this.width * ((first & 1) - 1 + (first >> 1));
			const src = dst + PLACES_PER_PLACE * offset;
			if (predictor === 1) {
				// A run of places copied from places already walked.
				const count = this.readNext() * PLACES_PER_PLACE;
				this.copyOverlapped(src, dst, count);
				dst += count;
				continue;
			}

			// A place walked from the places around it: the word behind the instruction names whether the
			// place beside it stands from the same places as well.
			let beside: number;
			if ((this.bits & 0xff) === 0x80) {
				const byte = this.readByte();
				beside = byte >> 7;
				this.bits = ((byte << 1) | 1) >>> 0;
			} else {
				beside = (this.bits & 0xff) >> 7;
				this.bits = (this.bits << 1) >>> 0;
			}
			const known = this.offsets[predictor - FIRST_PREDICTOR_INSTRUCTION] ?? 0;
			this.write(
				dst,
				this.gradient(
					src,
					dst + PLACES_PER_PLACE * known,
					src + PLACES_PER_PLACE * known,
				),
			);
			dst += PLACES_PER_PLACE;
			if (beside !== 0) {
				this.write(
					dst,
					this.gradient(
						src + PLACES_PER_PLACE,
						dst + PLACES_PER_PLACE * known,
						src + PLACES_PER_PLACE * known + PLACES_PER_PLACE,
					),
				);
				dst += PLACES_PER_PLACE;
			}
		}

		if (this.bpp === 32) {
			// The places that stand behind the places of the picture stand in a stream of their own.
			let alphaAt = 3;
			while (alphaAt < this.output.length) {
				const alpha = this.readBits(BITS_PER_BYTE);
				const count = this.readCount() + 1;
				for (let at = 0; at < count; at += 1) {
					if (alphaAt < this.output.length) this.output[alphaAt] = alpha;
					alphaAt += PLACES_PER_PLACE;
				}
			}
		} else if (this.bpp === 8) {
			// A picture walked in the places of four stands as one place for every place of it.
			const pixels = Buffer.alloc(this.width * this.height);
			let at = 0;
			for (let src = 0; src < this.output.length; src += PLACES_PER_PLACE)
				pixels[at++] = this.output[src] ?? 0;
			return pixels;
		}
		return this.output;
	}

	/** The place of the picture the reference writes in the place of the picture that stands beside it. */
	private gradient(src: number, above: number, aboveLeft: number): number {
		const a = this.read(src);
		const b = this.read(above);
		const c = this.read(aboveLeft);
		const low = (a & 0xff00ff) + (b & 0xff00ff) - (c & 0xff00ff);
		return (
			((low & 0xff00ff) +
				(((a & 0xff00) + (b & 0xff00) - (c & 0xff00)) & 0xff00)) |
			0
		);
	}

	/** `Utility.CopyOverlapped`: a run whose places may stand within the places it is copied from. */
	private copyOverlapped(src: number, dst: number, count: number): void {
		if (src < 0) return;
		if (dst > src) {
			// The places behind the writing stand before the places being read, so a place written a moment
			// ago stands within the reading.
			for (let at = 0; at < count; at += 1) {
				if (dst + at >= this.output.length || src + at >= this.output.length)
					break;
				this.output[dst + at] = this.output[src + at] ?? 0;
			}
		} else {
			for (let at = 0; at < count; at += 1) {
				if (dst + at >= this.output.length || src + at >= this.output.length)
					break;
				this.output[dst + at] = this.output[src + at] ?? 0;
			}
		}
	}

	private read(at: number): number {
		if (at < 0 || at + PLACES_PER_PLACE > this.output.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"An instruction names a place outside the picture",
			);
		return this.output.readInt32LE(at);
	}

	private write(at: number, value: number): void {
		if (at < 0 || at + PLACES_PER_PLACE > this.output.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"An instruction stands outside the picture",
			);
		this.output.writeInt32LE(value | 0, at);
	}

	private readByte(): number {
		if (this.position >= this.data.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"The places of the picture stand short of the pictures they walk",
			);
		const byte = this.data[this.position] ?? 0;
		this.position += 1;
		return byte;
	}

	/** `Reader.ReadNext`: the instruction at the places the stream carries. */
	private readNext(): number {
		this.bits &= 0xff;
		let places = this.tables.firstShifts[this.bits] ?? 0;
		let word = this.tables.firstWords[this.bits] ?? 0;
		while (word === 0) {
			const byte = this.readByte();
			places += this.tables.secondShifts[byte] ?? 0;
			word = this.tables.secondWords[byte] ?? 0;
		}
		const length = this.tables.wordLengths[word] ?? 0;
		let standing = word + 256;
		if (places - length > 0) {
			let rest = (places - length - 1) >>> 0;
			let value = this.readByte() + ((standing << length) & 0xffffff00);
			if (rest >= 8) {
				for (let count = rest >>> 3; count !== 0; count -= 1)
					value = ((value << 8) | this.readByte()) >>> 0;
				rest -= 8 * (rest >>> 3);
			}
			standing = (value << 1) | 1 | 0;
			places = rest;
		}
		this.bits = (standing << places) >>> 0;
		return this.bits >>> 8;
	}

	/** `Reader.ReadBits`: how many places of the stream stand behind the places being read. */
	private readBits(count: number): number {
		this.bits &= 0xff;
		const standing = this.tables.wordLengths[this.bits] ?? 0;
		let rest = count - standing;
		let value: number;
		if (rest <= 0) {
			value = this.bits >>> (BITS_PER_BYTE - count);
			this.bits = (this.bits << count) & 0xff;
		} else {
			let sofar = this.bits >>> (BITS_PER_BYTE - standing);
			if (rest > BITS_PER_BYTE) {
				let times = ((rest - 9) >> 3) + 1;
				while (times > 0) {
					sofar = this.readByte() + (sofar << 8);
					rest -= BITS_PER_BYTE;
					times -= 1;
				}
			}
			this.bits = this.readByte();
			value = (sofar << rest) + (this.bits >>> (BITS_PER_BYTE - rest));
			this.bits = ((this.bits << rest) + (1 << (rest - 1))) & 0xff;
		}
		return value & 0xff;
	}

	/** `Reader.ReadCount`: how many places a run stands in. */
	private readCount(): number {
		this.bits &= 0xff;
		let word = this.bits;
		let places = this.tables.firstShifts[word] ?? 0;
		let standing = this.tables.firstWords[word] ?? 0;
		while (standing === 0) {
			word = this.readByte();
			places += this.tables.secondShifts[word] ?? 0;
			standing = this.tables.secondWords[word] ?? 0;
		}
		this.bits = standing;
		const length = this.tables.wordLengths[standing] ?? 0;
		if (places - length <= 0) {
			this.bits = (standing << places) >>> 0;
			return ((standing + 256) >>> (BITS_PER_BYTE - places)) - 2;
		}
		let rest = places - length;
		let value = ((standing + 256) >>> (BITS_PER_BYTE - length)) >>> 0;
		if (rest > BITS_PER_BYTE) {
			const times = ((rest - 9) >> 3) + 1;
			for (let count = 0; count < times; count += 1)
				value = ((value << 8) | this.readByte()) >>> 0;
			rest += -8 * times;
		}
		this.bits = this.readByte();
		const run =
			((value << rest) + (this.bits >>> (BITS_PER_BYTE - rest))) >>> 0;
		this.bits = ((this.bits << rest) + (1 << (rest - 1))) >>> 0;
		return run - 2;
	}
}

/** `DetBmpFormat.Read`: the places of the picture, walked. */
export function unpackDetPicture(
	data: Buffer,
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer {
	return new DetReader(data, width, height, bitsPerPixel).unpack();
}
