// LZX, the compression of the folders of a cabinet (Microsoft) and of the streams of a compiled help file.
//
// GARbro carries no walk of this compression: its cabinet reader hands the whole of a cabinet to the WiX
// deployment library, and nothing else in the tree reads LZX. What stands here is written from the
// published documents of the format — the LZX data compression format that Microsoft published beside its
// cabinet format, and the LZX DELTA document ([MS-PATCH]), which walks the same engine — and checked
// against the system's own cabinet tool, whose output it reproduces byte for byte (see
// `docs/formats/microsoft-cab-archive.md`). Two independent readings of the format were consulted to
// confirm the shape of the block header and of the two tables of position places, which are facts of the
// format rather than the work of any one program; no line of either was taken over.
//
// The walk, in the order the format lays it out:
//
//  * the stream is a run of sixteen bit little-endian words, and the bits of every word are read from its
//    most significant end down. One bit opens the stream: when it is set, the length of the file the stream
//    stands for follows in thirty two bits, which the walk of Intel calls uses and nothing else does;
//  * the stream stands of blocks, each of a kind of three bits and of a length of twenty four bits. A
//    verbatim block names its symbols through two trees, an aligned block through three, an uncompressed
//    block carries its bytes as they stand. A block of an odd length that was uncompressed is followed by
//    one byte of padding, and the bytes of an uncompressed block stand on a word boundary, which the format
//    reaches by dropping the bits still held — the word itself when none are held;
//  * every tree is named through a tree of its own: twenty lengths of four bits each name the tree that
//    carries the lengths of the tree being read, and every length is the length before it, less the symbol
//    read, wrapped at seventeen. The lengths of a tree stand from block to block, so the names of a block
//    are read against the lengths the block before it left;
//  * a symbol of the main tree below two hundred and fifty six is a byte of the output; a symbol above that
//    is a match whose low three bits and the symbol of the tree of lengths name its length, and whose
//    remaining bits name a place of the window. The first three places stand of the three places the last
//    matches used, held in the order a match of each kind puts them in; the places beyond them are named by
//    a place, of the places the window stands of, and by the bits that place names;
//  * a match of an aligned block takes its last three bits from a tree of eight symbols, which is why the
//    bits of a place beyond the third are read three at a time there;
//  * at the end of every frame of thirty two thousand bytes, the walk of Intel calls rewrites the places
//    behind every `0xe8` byte of the frame: a place inside the file the stream stands for becomes a place
//    relative to the byte being walked, and a place before the file becomes a place relative to its end.

const NUM_CHARS = 256;
const MIN_MATCH = 2;
const MAX_MATCH = 257;
/** Every frame the walk of Intel calls stands of is this many bytes long. */
export const LZX_FRAME_SIZE = 32768;
const NUM_SECONDARY_LENGTHS = 249;
const ALIGNED_MAXSYMBOLS = 8;
const PRETREE_MAXSYMBOLS = 20;
const LENGTH_HEADER_MASK = 7;
/** A length is named by its difference from the length before it, wrapped at this count. */
const LENGTH_WRAP = 17;
const TREE_MAX_LENGTH = 16;
/** The places a window of a given size stands of, by the count of bits of the size less fifteen. */
const WINDOW_SLOTS = [30, 32, 34, 36, 38, 42, 50, 66, 98, 162, 290];
const MAX_SLOTS = 290;
const MAX_EXTRA_BITS = 17;
const INTEL_CALL = 0xe8;
/** The count of bytes at the end of a frame the walk of Intel calls leaves alone. */
const INTEL_TAIL = 10;
/** The block kinds of the format. */
const BLOCK_VERBATIM = 1;
const BLOCK_ALIGNED = 2;
const BLOCK_UNCOMPRESSED = 3;

/** The smallest and largest window a cabinet may name, in bits. */
export const LZX_MIN_WINDOW_BITS = 15;
export const LZX_MAX_WINDOW_BITS = 21;

function invalidStream(message: string): Error {
	return new Error(message);
}

/** The number of places a window of this many bits stands of. */
export function lzxPositionSlots(windowBits: number): number {
	if (windowBits < LZX_MIN_WINDOW_BITS || windowBits > LZX_MAX_WINDOW_BITS) {
		throw new RangeError(
			`LZX window bits outside ${LZX_MIN_WINDOW_BITS}..${LZX_MAX_WINDOW_BITS}: ${windowBits}`,
		);
	}
	return WINDOW_SLOTS[windowBits - LZX_MIN_WINDOW_BITS] ?? 0;
}

/**
 * The bits a place names, and the place those bits stand on top of. The documents give both as tables;
 * both follow from one rule, written out here so that two hundred and ninety numbers need not be
 * transcribed: a place below the fourth names no bits, a place below the thirty sixth names half of its own
 * number less one, and every place beyond that names seventeen, the most the format reads at once. A place
 * stands one place past the one before it plus the places the bits of that one name.
 */
export function lzxPlaceTables(): {
	extraBits: Uint8Array;
	positionBase: Uint32Array;
} {
	const extraBits = new Uint8Array(MAX_SLOTS);
	const positionBase = new Uint32Array(MAX_SLOTS);
	for (let place = 0; place < MAX_SLOTS; place += 1) {
		extraBits[place] =
			place < 4 ? 0 : place < 36 ? Math.floor(place / 2) - 1 : MAX_EXTRA_BITS;
		positionBase[place] =
			place === 0
				? 0
				: ((positionBase[place - 1] ?? 0) +
						(1 << (extraBits[place - 1] ?? 0))) >>>
					0;
	}
	return { extraBits, positionBase };
}

const PLACE_TABLES = lzxPlaceTables();

/**
 * The bits of an LZX stream: sixteen bit little-endian words read from their most significant end down.
 * Where the next word stands is held apart from the bits, because the bytes of an uncompressed block stand
 * on a word boundary with the bits behind them dropped.
 */
class LzxBitReader {
	readonly #data: Buffer;
	#at = 0;
	#bits = 0;
	#count = 0;

	constructor(data: Buffer) {
		this.#data = data;
	}

	/**
	 * Puts the stream on the boundary the frames of a cabinet stand on: the bits still held are stepped
	 * over, which brings the reader to the end of the word it last read. When no bits are held the reader
	 * already stands there and nothing is stepped over.
	 */
	realignToWordBoundary(): void {
		if (0 !== this.#count) {
			this.#bits = 0;
			this.#count = 0;
		}
	}

	#pull(): void {
		if (this.#at + 2 > this.#data.length) {
			throw invalidStream("The LZX stream ended while its bits were read");
		}
		this.#bits = ((this.#bits << 16) | this.#data.readUInt16LE(this.#at)) >>> 0;
		this.#at += 2;
		this.#count += 16;
	}

	readBits(count: number): number {
		if (count < 0 || count > 17) {
			throw invalidStream(
				`The LZX stream was asked for ${count} bits, where the format reads at most seventeen`,
			);
		}
		while (this.#count < count) this.#pull();
		if (0 === count) return 0;
		const value = (this.#bits >>> (this.#count - count)) & ((1 << count) - 1);
		this.#count -= count;
		return value;
	}

	/**
	 * Puts the stream on a word boundary: the bits still held are dropped, and when none are held the word
	 * the stream stands on is dropped with them, which is the sixteen bits of padding the format puts
	 * before the bytes of an uncompressed block.
	 */
	alignToWord(): void {
		if (0 === this.#count) this.#pull();
		this.#bits = 0;
		this.#count = 0;
	}

	/** One byte as it stands, which is only read with the bits behind the reader dropped. */
	readByte(): number {
		if (this.#at >= this.#data.length) {
			throw invalidStream("The LZX stream ended while its bytes were read");
		}
		const value = this.#data[this.#at] ?? 0;
		this.#at += 1;
		return value;
	}

	/** Steps over one byte, for the padding behind a block of an odd length that was uncompressed. */
	skipByte(): void {
		if (this.#at >= this.#data.length) {
			throw invalidStream("The LZX stream ended while its bytes were read");
		}
		this.#at += 1;
	}

	readUint32(): number {
		let value = 0;
		for (let index = 0; index < 4; index += 1) {
			value |= this.readByte() << (index * 8);
		}
		return value >>> 0;
	}
}

/**
 * A tree of the format, read from the lengths of its symbols and walked one bit at a time. The lengths are
 * held as they were read, because the walk of the tree of the block behind takes its differences from them.
 */
class LzxTree {
	readonly lengths: Uint8Array;
	readonly #counts = new Uint32Array(TREE_MAX_LENGTH + 1);
	readonly #firstCode = new Uint32Array(TREE_MAX_LENGTH + 1);
	/** The symbols of every length, shortest length first and in the order of the symbols within it. */
	readonly #symbols: Uint16Array;
	readonly #offset = new Uint32Array(TREE_MAX_LENGTH + 2);

	constructor(symbols: number) {
		this.lengths = new Uint8Array(symbols);
		this.#symbols = new Uint16Array(symbols);
	}

	/** Whether no symbol of the tree stands of a code, which the tree of lengths of a block may. */
	get isEmpty(): boolean {
		for (const count of this.#counts) {
			if (0 !== count) return false;
		}
		return true;
	}

	build(): void {
		this.#counts.fill(0);
		for (const length of this.lengths) {
			if (0 === length) continue;
			this.#counts[length] = (this.#counts[length] ?? 0) + 1;
		}
		let code = 0;
		let at = 0;
		for (let length = 1; length <= TREE_MAX_LENGTH; length += 1) {
			this.#firstCode[length] = code;
			this.#offset[length] = at;
			code = (code + (this.#counts[length] ?? 0)) << 1;
			at += this.#counts[length] ?? 0;
		}
		for (let length = 1; length <= TREE_MAX_LENGTH; length += 1) {
			for (let symbol = 0; symbol < this.lengths.length; symbol += 1) {
				if ((this.lengths[symbol] ?? 0) !== length) continue;
				const index = this.#offset[length] ?? 0;
				this.#symbols[index] = symbol;
				this.#offset[length] = index + 1;
			}
		}
		// The walk of a symbol reads the offsets again, so they are put back to the start of every length.
		at = 0;
		for (let length = 1; length <= TREE_MAX_LENGTH; length += 1) {
			this.#offset[length] = at;
			at += this.#counts[length] ?? 0;
		}
	}

	/** The symbol the bits behind the reader's place name, or -1 when the stream names none. */
	decode(reader: LzxBitReader): number {
		let code = 0;
		for (let length = 1; length <= TREE_MAX_LENGTH; length += 1) {
			code = (code << 1) | reader.readBits(1);
			const index = code - (this.#firstCode[length] ?? 0);
			if (index < 0 || index >= (this.#counts[length] ?? 0)) continue;
			return this.#symbols[(this.#offset[length] ?? 0) + index] ?? -1;
		}
		return -1;
	}

	/** Whether this symbol stands of a code of the tree at all. */
	hasCode(symbol: number): boolean {
		return 0 !== (this.lengths[symbol] ?? 0);
	}
}

/** The lengths of the symbols of a tree, named through the tree that carries their differences. */
function readTreeLengths(
	reader: LzxBitReader,
	tree: LzxTree,
	first: number,
	last: number,
): void {
	const pretree = new LzxTree(PRETREE_MAXSYMBOLS);
	for (let symbol = 0; symbol < PRETREE_MAXSYMBOLS; symbol += 1) {
		pretree.lengths[symbol] = reader.readBits(4);
	}
	pretree.build();
	let at = first;
	while (at < last) {
		const symbol = pretree.decode(reader);
		if (symbol < 0) {
			throw invalidStream(
				"The LZX stream named no symbol of its tree of lengths",
			);
		}
		if (symbol < LENGTH_WRAP) {
			const before = tree.lengths[at] ?? 0;
			const length = before - symbol;
			tree.lengths[at] = length < 0 ? length + LENGTH_WRAP : length;
			at += 1;
			continue;
		}
		let count: number;
		let length: number;
		if (17 === symbol) {
			count = reader.readBits(4) + 4;
			length = 0;
		} else if (18 === symbol) {
			count = reader.readBits(5) + 20;
			length = 0;
		} else if (19 === symbol) {
			count = reader.readBits(1) + 4;
			const second = pretree.decode(reader);
			if (second < 0) {
				throw invalidStream(
					"The LZX stream named no symbol of its tree of lengths",
				);
			}
			const before = tree.lengths[at] ?? 0;
			const value = before - second;
			length = value < 0 ? value + LENGTH_WRAP : value;
		} else {
			throw invalidStream(`The LZX stream named a length of ${symbol}`);
		}
		if (at + count > last) {
			throw invalidStream(
				"The LZX tree of lengths ran past the tree it stands of",
			);
		}
		for (let index = 0; index < count; index += 1) {
			tree.lengths[at + index] = length;
		}
		at += count;
	}
}

export interface LzxResult {
	output: Buffer;
	/** The length of the file the stream stands for as the stream names it, or nought when it names none. */
	intelFilesize: number;
}

/**
 * Reads one LZX stream of a folder of a cabinet into the bytes it stands for. The stream is one run of
 * blocks and the length asked for is the count of bytes they unfold to, which the cabinet itself names.
 */
export function decompressLzx(
	input: Buffer,
	outputLength: number,
	windowBits: number,
): LzxResult {
	if (!Number.isSafeInteger(outputLength) || outputLength < 0) {
		throw new RangeError(
			"The LZX output length is outside the counts a buffer holds",
		);
	}
	const slots = lzxPositionSlots(windowBits);
	const windowSize = 2 ** windowBits;
	const reader = new LzxBitReader(input);
	// What a match copies stands apart from what is handed over: the walk of Intel calls rewrites the bytes
	// it hands over, and a match of a later frame copies the bytes as they were decoded, before that walk.
	const window = Buffer.alloc(outputLength);
	const output = Buffer.alloc(outputLength);
	const main = new LzxTree(NUM_CHARS + slots * 8);
	const length = new LzxTree(NUM_SECONDARY_LENGTHS);
	const aligned = new LzxTree(ALIGNED_MAXSYMBOLS);
	let intelFilesize = 0;
	if (0 !== reader.readBits(1)) {
		intelFilesize = ((reader.readBits(16) << 16) | reader.readBits(16)) >>> 0;
	}
	let intelStarted = 0 !== intelFilesize;
	let produced = 0;
	let frameStart = 0;
	/** Where the block being walked ends, in bytes of the output. */
	let blockEnd = 0;
	let blockLength = 0;
	let blockType = 0;
	let r0 = 1;
	let r1 = 1;
	let r2 = 1;
	while (produced < outputLength) {
		// Frames stand on a grid of their own: a match may cross the end of one, and the bytes it produces
		// beyond it stand in the frame behind and are walked by the place of that frame, not by this one.
		const frameEnd = Math.min(frameStart + LZX_FRAME_SIZE, outputLength);
		while (produced < frameEnd) {
			if (produced >= blockEnd) {
				// A block of an odd length that was uncompressed is followed by one byte of padding.
				if (BLOCK_UNCOMPRESSED === blockType && 1 === (blockLength & 1)) {
					reader.skipByte();
				}
				blockType = reader.readBits(3);
				blockLength = ((reader.readBits(16) << 8) | reader.readBits(8)) >>> 0;
				blockEnd = produced + blockLength;
				if (BLOCK_VERBATIM === blockType || BLOCK_ALIGNED === blockType) {
					if (BLOCK_ALIGNED === blockType) {
						for (let symbol = 0; symbol < ALIGNED_MAXSYMBOLS; symbol += 1) {
							aligned.lengths[symbol] = reader.readBits(3);
						}
						aligned.build();
					}
					readTreeLengths(reader, main, 0, NUM_CHARS);
					readTreeLengths(reader, main, NUM_CHARS, NUM_CHARS + slots * 8);
					main.build();
					if (main.hasCode(INTEL_CALL)) intelStarted = true;
					readTreeLengths(reader, length, 0, NUM_SECONDARY_LENGTHS);
					length.build();
				} else if (BLOCK_UNCOMPRESSED === blockType) {
					// A block that carries its bytes as they stand cannot be assumed to be free of calls.
					intelStarted = true;
					reader.alignToWord();
					r0 = reader.readUint32();
					r1 = reader.readUint32();
					r2 = reader.readUint32();
				} else {
					throw invalidStream(
						`The LZX stream stood of a block of the kind ${blockType}`,
					);
				}
			}
			const run = Math.min(blockEnd, frameEnd) - produced;
			if (BLOCK_UNCOMPRESSED === blockType) {
				for (let index = 0; index < run; index += 1) {
					window[produced] = reader.readByte();
					produced += 1;
				}
			} else {
				let remaining = run;
				while (remaining > 0) {
					const symbol = main.decode(reader);
					if (symbol < 0) {
						throw invalidStream(
							"The LZX stream named no symbol of its main tree",
						);
					}
					if (symbol < NUM_CHARS) {
						window[produced] = symbol;
						produced += 1;
						remaining -= 1;
						continue;
					}
					const element = symbol - NUM_CHARS;
					let matchLength = element & LENGTH_HEADER_MASK;
					if (LENGTH_HEADER_MASK === matchLength) {
						if (length.isEmpty) {
							throw invalidStream(
								"The LZX stream needed a length where its tree held none",
							);
						}
						const footer = length.decode(reader);
						if (footer < 0) {
							throw invalidStream("The LZX stream named no length of its tree");
						}
						matchLength += footer;
					}
					matchLength += MIN_MATCH;
					const place = element >> 3;
					let matchOffset: number;
					if (0 === place) {
						matchOffset = r0;
					} else if (1 === place) {
						matchOffset = r1;
						r1 = r0;
						r0 = matchOffset;
					} else if (2 === place) {
						matchOffset = r2;
						r2 = r0;
						r0 = matchOffset;
					} else {
						const extra =
							place >= 36
								? MAX_EXTRA_BITS
								: (PLACE_TABLES.extraBits[place] ?? 0);
						matchOffset = ((PLACE_TABLES.positionBase[place] ?? 0) - 2) >>> 0;
						if (extra >= 3 && BLOCK_ALIGNED === blockType) {
							if (extra > 3) {
								matchOffset =
									(matchOffset + (reader.readBits(extra - 3) << 3)) >>> 0;
							}
							const low = aligned.decode(reader);
							if (low < 0) {
								throw invalidStream(
									"The LZX stream named no place of its aligned tree",
								);
							}
							matchOffset = (matchOffset + low) >>> 0;
						} else if (extra > 0) {
							matchOffset = (matchOffset + reader.readBits(extra)) >>> 0;
						}
						r2 = r1;
						r1 = r0;
						r0 = matchOffset;
					}
					if (matchLength > MAX_MATCH) {
						throw invalidStream(
							"The LZX match named a length outside the format",
						);
					}
					if (
						matchOffset === 0 ||
						matchOffset > produced ||
						matchOffset > windowSize
					) {
						throw invalidStream(
							`The LZX match of ${matchLength} bytes at ${produced} reached ${matchOffset} places back`,
						);
					}
					if (produced + matchLength > outputLength) {
						throw invalidStream(
							"The LZX match ran past the bytes of its folder",
						);
					}
					let source = produced - matchOffset;
					for (let index = 0; index < matchLength; index += 1) {
						window[produced] = window[source] ?? 0;
						produced += 1;
						source += 1;
					}
					remaining -= matchLength;
				}
			}
		}
		const frameLength = frameEnd - frameStart;
		// The frames of a cabinet each stand on a word boundary of their own, so the bits the frame behind
		// left half read are stepped over before the frame ahead of it is walked.
		if (frameEnd < outputLength) reader.realignToWordBoundary();
		window.copy(output, frameStart, frameStart, frameEnd);
		if (intelStarted && 0 !== intelFilesize && frameLength > INTEL_TAIL) {
			rewriteIntelCalls(output, frameStart, frameEnd, intelFilesize);
		}
		frameStart = frameEnd;
	}
	return { output, intelFilesize };
}

/**
 * The walk of Intel calls: a `0xe8` byte names a place behind it, which the walk puts relative to the byte
 * it stands at. A place inside the file the stream stands for is written again and a place outside it is
 * left alone; the last ten bytes of a frame stand of no call, because a place behind them would run past
 * the frame.
 */
function rewriteIntelCalls(
	output: Buffer,
	from: number,
	to: number,
	filesize: number,
): void {
	const end = to - INTEL_TAIL;
	let at = from;
	let place = from;
	while (at < end) {
		if (INTEL_CALL !== output[at]) {
			at += 1;
			place += 1;
			continue;
		}
		at += 1;
		const absolute = output.readInt32LE(at);
		if (absolute >= -place && absolute < filesize) {
			const relative = absolute >= 0 ? absolute - place : absolute + filesize;
			output.writeInt32LE(relative | 0, at);
		}
		at += 4;
		place += 5;
	}
}
