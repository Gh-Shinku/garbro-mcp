// A small writer of LZX streams, for the tests that walk them.
//
// The format names its symbols through trees that are themselves named through a tree, so a stream cannot be
// built by hand in a fixture of bytes alone: the test carries a small writer that lays out the head, the
// block header, the trees and the symbols the way the format does, and the reader is asked to walk them
// back. What the writer lays down for the trees is the canonical assignment of the format — the codes of a
// length stand behind the codes shorter than them, in the order of their symbols — and the lengths of a
// tree are named through a tree of twenty symbols of five bits, which stands of every difference the format
// names. That writer stands of the format's own rules and not of the reader's, so a reader that walked them
// wrongly would not hand back the bytes that went in.
//
// The reader these streams are handed to is `packages/codecs/src/lzx.ts`; the two streams of real cabinets it
// was checked against are recorded in `docs/formats/microsoft-cab-archive.md`.

export const LZX_TEST_FRAME = 32768;
const FRAME = LZX_TEST_FRAME;
const SLOTS_FOR_15 = 30;
const NUM_CHARS = 256;
const LENGTH_SYMBOLS = 249;
const PRETREE_SYMBOLS = 20;
/** The lengths of the tree of lengths the writer lays down: the differences 0..16 of five bits each. */
const PRETREE_LENGTH = 5;

/** Lays down bits in the order the format reads them: the most significant bit of a sixteen bit word first. */
export class BitWriter {
	readonly #bits: number[] = [];

	bits(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1) {
			this.#bits.push((value >>> at) & 1);
		}
	}

	/** Puts the stream on a word boundary, which every frame of a cabinet stands on. */
	realign(): void {
		while (0 !== this.#bits.length % 16) this.#bits.push(0);
	}

	/** How many bits stand written past the last word boundary. */
	heldBits(): number {
		return this.#bits.length % 16;
	}

	toBuffer(): Buffer {
		const words = Math.ceil(this.#bits.length / 16);
		const out = Buffer.alloc(words * 2);
		for (const [at, bit] of this.#bits.entries()) {
			if (0 === bit) continue;
			const word = Math.floor(at / 16);
			const place = 15 - (at % 16);
			out.writeUInt16LE(out.readUInt16LE(word * 2) | (1 << place), word * 2);
		}
		return out;
	}
}

/** The canonical codes of the format: shorter codes first, and the symbols of a length in their own order. */
export function codesFor(lengths: readonly number[]): Map<number, number[]> {
	const codes = new Map<number, number[]>();
	let code = 0;
	for (let length = 1; length <= 16; length += 1) {
		for (let symbol = 0; symbol < lengths.length; symbol += 1) {
			if ((lengths[symbol] ?? 0) !== length) continue;
			codes.set(symbol, [code, length]);
			code += 1;
		}
		code <<= 1;
	}
	return codes;
}

export function writeCode(
	writer: BitWriter,
	codes: Map<number, number[]>,
	symbol: number,
): void {
	const code = codes.get(symbol);
	if (!code) throw new Error(`no code for symbol ${symbol}`);
	writer.bits(code[0] ?? 0, code[1] ?? 0);
}

/**
 * The lengths of a tree, named through a tree of their own: every length is written as the difference
 * between it and the length that stood at its place before, wrapped at seventeen — nought, since every tree
 * the writer lays down is the first of its stream.
 */
export function writeTreeLengths(
	writer: BitWriter,
	lengths: readonly number[],
): void {
	const pretreeLengths: number[] = [];
	for (let symbol = 0; symbol < PRETREE_SYMBOLS; symbol += 1) {
		pretreeLengths.push(symbol < 17 ? PRETREE_LENGTH : 0);
	}
	for (const length of pretreeLengths) writer.bits(length, 4);
	const pretree = codesFor(pretreeLengths);
	for (const length of lengths) {
		writeCode(writer, pretree, (17 - length + 17) % 17);
	}
}

/** A verbatim block whose symbols are the places of the bytes handed in, each of two bits. */
export function writeLiteralBlock(
	writer: BitWriter,
	symbols: readonly number[],
): void {
	// The stream opens with one bit: nought where it names no length of Intel calls, one where it does.
	writer.bits(0, 1);
	writer.bits(1, 3);
	writer.bits(symbols.length >>> 8, 16);
	writer.bits(symbols.length & 0xff, 8);
	// The main tree: every place the writer stands of takes a code of the shortest length that holds them
	// all, which is a prefix code for any set of symbols (Kraft's sum stands at or below one), and no symbol
	// of a match stands of a code at all.
	const places = [...new Set(symbols)];
	const width = Math.max(1, Math.ceil(Math.log2(Math.max(2, places.length))));
	const main: number[] = new Array(NUM_CHARS + SLOTS_FOR_15 * 8).fill(0);
	for (const symbol of places) main[symbol] = width;
	writeTreeLengths(writer, main.slice(0, NUM_CHARS));
	writeTreeLengths(writer, main.slice(NUM_CHARS));
	writeTreeLengths(writer, new Array(LENGTH_SYMBOLS).fill(0));
	const codes = codesFor(main);
	for (const [at, symbol] of symbols.entries()) {
		writeCode(writer, codes, symbol);
		// Every frame of a cabinet stands on a word boundary of its own.
		if (0 !== (at + 1) % FRAME && at + 1 !== symbols.length) continue;
		if (at + 1 !== symbols.length) writer.realign();
	}
	writer.realign();
}

/** A stream of the letters handed in, each of them a symbol of the main tree of two bits. */
export function literalStream(text: string): Buffer {
	const writer = new BitWriter();
	writeLiteralBlock(
		writer,
		[...text].map((letter) => letter.charCodeAt(0)),
	);
	return writer.toBuffer();
}

/**
 * A stream of an uncompressed block: the head, the kind and the length of the block, the stream put on a word
 * boundary, the three places of the last matches, and the bytes as they stand.
 */
export function uncompressedStream(
	text: Buffer,
	intelFilesize?: number,
): Buffer {
	const writer = new BitWriter();
	writer.bits(undefined === intelFilesize ? 0 : 1, 1);
	if (undefined !== intelFilesize) {
		writer.bits(intelFilesize >>> 16, 16);
		writer.bits(intelFilesize & 0xffff, 16);
	}
	writer.bits(3, 3);
	writer.bits(text.length >>> 8, 16);
	writer.bits(text.length & 0xff, 8);
	// The bytes of the block stand on a word boundary, which the format reaches by stepping over the bits
	// still held and, where none are held, over one whole word.
	if (0 === writer.heldBits()) writer.bits(0, 16);
	writer.realign();
	const head = writer.toBuffer();
	const places = Buffer.alloc(12);
	places.writeUInt32LE(1, 0);
	places.writeUInt32LE(1, 4);
	places.writeUInt32LE(1, 8);
	return Buffer.concat([head, places, text]);
}
