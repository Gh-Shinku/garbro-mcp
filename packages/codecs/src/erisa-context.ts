// The bit-stream of the Entis engine, of the reference `ArcFormats/Entis/ArcNOA.cs`
// (`ERISADecodeContext`) and `ArcFormats/Entis/EriReader.cs` (`RLEDecodeContext`).
//
// The engine stands of a run of the places of a stream, of the counts of the places of the walk of it:
// every count of the walk of the engine stands of the places of the file of the engine itself or of the
// places of another walk of the engine behind it. The walk of the counts of a picture of the engine
// (`RLEDecodeContext`) stands of the counts of the walk of it (the counts of the walk of a count of no
// sign, of a count of a sign and a count of the places of the walk behind it), of the table of the counts
// of the walk of the engine (`ERISA_GAMMA_TABLE`).

import { GarbroError } from "@garbro-mcp/core";
import { ERISA_GAMMA_TABLE } from "./erisa-gamma-table.js";
import { ErisaHuffmanTree, type ErisaHuffmanNode } from "./erisa-huffman.js";
import { ErisaProbModel } from "./erisa-prob-model.js";

const PLACES_PER_WORD = 4;
const WORD_PLACES_MASK = 3;
const WORD_BITS = 32;
const PLACE_BITS = 8;
const PLACE_MASK = 0xff;
const SIGN_BITS = 24;
const TABLE_PLACES = 0x200;
const TABLE_MASK = 0x1ff;
const HIGH_BITS_MASK = 0x55000000;
/** The highest place of a count of the walk of the engine, of the count of the places of a word of it. */
const HIGH_PLACE = -2147483648;
const SECOND_PLACE = 0x40000000;
const UNKNOWN = 0xff;
// The reference stands of the count of the walk of the engine of the count of the walk of the engine of no
// count of the walk of it at all: the count of the walk of it doubles of every place of the walk of the
// engine of the count of the walk of the engine behind it, of a count of the walk of the engine of its own
// of thirty places of a count. This port turns away a count of the walk of the engine of the count of the
// walk of the engine of the count of the walk of it of its own instead.
const BASE_LIMIT = 0x40000000;

function invalidStream(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The run of the places of a walk of a count of the engine. */
export type ErisaPlaces = Uint8Array;

/**
 * `ERISADecodeContext`: the walk of the places of the engine, of the count of the places of the walk of it.
 * Every count of the walk of the engine stands of the places of the file of the engine itself or of the
 * places of another walk of the engine behind it.
 */
export abstract class ErisaDecodeContext {
	protected intBufCount: number;
	protected intBuffer: number;
	protected bufferingSize: number;
	protected bufCount: number;
	protected buffer: Uint8Array;
	protected nextBuf: number;
	/** The places of the file of the walk of the engine, of no walk of another walk of it. */
	protected source: Buffer | undefined;
	protected sourceAt: number;
	/** The walk of the engine the places of this walk stand of, where they stand of one. */
	protected context: ErisaDecodeContext | undefined;

	constructor(bufferingSize: number) {
		this.intBufCount = 0;
		this.intBuffer = 0;
		this.bufferingSize = (bufferingSize + WORD_PLACES_MASK) & ~WORD_PLACES_MASK;
		this.bufCount = 0;
		this.buffer = new Uint8Array(this.bufferingSize);
		this.nextBuf = 0;
		this.source = undefined;
		this.sourceAt = 0;
		this.context = undefined;
	}

	/** `AttachInputFile`: the places of the walk of the engine stand of a stream of the file. */
	attachInputFile(source: Buffer, at = 0): void {
		this.source = source;
		this.sourceAt = at;
		this.context = undefined;
	}

	/** `AttachInputContext`: the places of the walk of the engine stand of another walk of it. */
	attachInputContext(context: ErisaDecodeContext): void {
		this.source = undefined;
		this.context = context;
	}

	/** `ReadNextData`: the places of the walk of the engine, of the count a walk asks of it. */
	readNextData(places: Uint8Array, count: number): number {
		if (this.source) {
			const available = Math.max(0, this.source.length - this.sourceAt);
			const read = Math.min(count, available);
			for (let at = 0; at < read; at += 1) {
				places[at] = this.source[this.sourceAt + at] ?? 0;
			}
			this.sourceAt += read;
			return read;
		}
		if (this.context) {
			return this.context.decodeBytes(places, count);
		}
		throw invalidStream(
			"The walk of the engine stands of no place of a stream",
		);
	}

	/** `DecodeBytes`: the places of a walk of the engine, of the count a walk asks of it. */
	abstract decodeBytes(places: Uint8Array, count: number): number;

	/** `PrefetchBuffer`: the places of a word of the walk of the engine. */
	protected prefetchBuffer(): boolean {
		if (0 === this.intBufCount) {
			if (0 === this.bufCount) {
				this.nextBuf = 0;
				this.bufCount = this.readNextData(this.buffer, this.bufferingSize);
				if (0 === this.bufCount) return false;
				if (0 !== (this.bufCount & WORD_PLACES_MASK)) {
					let at = this.bufCount;
					this.bufCount +=
						WORD_PLACES_MASK + 1 - (this.bufCount & WORD_PLACES_MASK);
					while (at < this.bufCount) {
						this.buffer[at] = 0;
						at += 1;
					}
				}
			}
			this.intBufCount = WORD_BITS;
			const at = this.nextBuf;
			this.intBuffer =
				(((this.buffer[at] ?? 0) << SIGN_BITS) |
					((this.buffer[at + 1] ?? 0) << 16) |
					((this.buffer[at + 2] ?? 0) << PLACE_BITS) |
					(this.buffer[at + 3] ?? 0)) >>>
				0;
			this.nextBuf += PLACES_PER_WORD;
			this.bufCount -= PLACES_PER_WORD;
		}
		return true;
	}

	/** `FlushBuffer`: the walk of the engine stands of no place of the stream behind it. */
	flushBuffer(): void {
		this.intBufCount = 0;
		this.bufCount = 0;
	}

	/** `GetABit`: a place of the walk of the engine, of the count of it of no place of a stream. */
	getABit(): number {
		if (!this.prefetchBuffer()) return 1;
		const value = this.intBuffer >> 31;
		this.intBufCount -= 1;
		this.intBuffer = (this.intBuffer << 1) >>> 0;
		return value;
	}

	/** `GetNBits`: the places of the walk of the engine, of the count a walk asks of it. */
	getNBits(count: number): number {
		let code = 0;
		let left = count;
		while (0 !== left) {
			if (!this.prefetchBuffer()) break;
			const copy = Math.min(left, this.intBufCount);
			code = ((code << copy) | (this.intBuffer >>> (WORD_BITS - copy))) >>> 0;
			left -= copy;
			this.intBufCount -= copy;
			this.intBuffer = (this.intBuffer << copy) >>> 0;
		}
		return code;
	}
}

/**
 * `RLEDecodeContext`: the walk of the counts of a picture of the engine, of the counts of the walk of the
 * engine (`GetGammaCode`) and of the places of the counts of the walk of it.
 */
export class ErisaRleDecodeContext extends ErisaDecodeContext {
	protected flgZero: number;
	protected length: number;

	constructor(bufferingSize: number) {
		super(bufferingSize);
		this.flgZero = 0;
		this.length = 0;
	}

	/** `InitGammaContext`: the count of the walk of the engine stands of the flag of the walk of it. */
	initGammaContext(): void {
		this.flgZero = this.getABit();
		this.length = 0;
	}

	decodeBytes(places: Uint8Array, count: number): number {
		return this.decodeGammaCodeBytes(places, count);
	}

	/** `DecodeGammaCodeBytes`: the places of the walk of the counts of a picture of the engine. */
	decodeGammaCodeBytes(places: Uint8Array, count: number): number {
		let to = 0;
		let decoded = 0;
		let left = count;
		if (0 === this.length) {
			this.length = this.getGammaCode();
			if (0 === this.length) return decoded;
		}
		for (;;) {
			const repeat = Math.min(this.length, left);
			this.length -= repeat;
			left -= repeat;
			if (0 === this.flgZero) {
				decoded += repeat;
				for (let at = 0; at < repeat; at += 1) places[to + at] = 0;
				to += repeat;
			} else {
				for (let at = 0; at < repeat; at += 1) {
					// The count of the walk of the engine stands of a sign of its own and of the count of
					// the walk of it behind it, every one of them of the places of a count of the walk of
					// the engine.
					const sign = this.getABit();
					const code = (this.getGammaCode() << SIGN_BITS) >> SIGN_BITS;
					if (0 === code) return decoded;
					decoded += 1;
					places[to] = ((code ^ sign) - sign) & PLACE_MASK;
					to += 1;
				}
			}
			if (0 === left) {
				if (0 === this.length) {
					this.flgZero = ~this.flgZero;
				}
				return decoded;
			}
			this.flgZero = ~this.flgZero;
			this.length = this.getGammaCode();
			if (0 === this.length) return decoded;
		}
	}

	/** `GetGammaCode`: the count of a walk of the engine, of the places of the count of the walk of it. */
	protected getGammaCode(): number {
		if (!this.prefetchBuffer()) return 0;
		this.intBufCount -= 1;
		const word = this.intBuffer;
		this.intBuffer = (this.intBuffer << 1) >>> 0;
		if (0 === (word & HIGH_PLACE)) return 1;
		if (!this.prefetchBuffer()) return 0;
		let code = 0;
		if (0 !== (~this.intBuffer & HIGH_BITS_MASK) && this.intBufCount >= 8) {
			// The count of the walk of the engine stands of the table of the walk of it.
			const place = ((this.intBuffer >>> SIGN_BITS) << 1) & TABLE_MASK;
			if (place + 1 >= TABLE_PLACES) return 0;
			code = ERISA_GAMMA_TABLE[place] ?? 0;
			const bits = ERISA_GAMMA_TABLE[place + 1] ?? 0;
			if (UNKNOWN === code && UNKNOWN === bits) {
				throw invalidStream(
					"The count of the walk of the engine stands past the table of it",
				);
			}
			if (bits > this.intBufCount) {
				throw invalidStream(
					"The walk of the engine stands short of the count of it",
				);
			}
			this.intBufCount -= bits;
			this.intBuffer = (this.intBuffer << bits) >>> 0;
			return code;
		}
		// The count of the walk of the engine of the places of the walk of it one by one.
		let base = 2;
		for (;;) {
			if (this.intBufCount >= 2) {
				const word2 = this.intBuffer;
				this.intBuffer = (this.intBuffer << 2) >>> 0;
				code = (code << 1) | (word2 >>> 31);
				this.intBufCount -= 2;
				if (0 === (word2 & SECOND_PLACE)) return code + base;
				base <<= 1;
			} else {
				if (!this.prefetchBuffer()) return 0;
				code = (code << 1) | (this.intBuffer >>> 31);
				this.intBufCount -= 1;
				this.intBuffer = (this.intBuffer << 1) >>> 0;
				if (!this.prefetchBuffer()) return 0;
				const word2 = this.intBuffer;
				this.intBufCount -= 1;
				this.intBuffer = (this.intBuffer << 1) >>> 0;
				if (0 === (word2 & HIGH_PLACE)) return code + base;
				base <<= 1;
			}
			if (base > BASE_LIMIT) {
				throw invalidStream(
					"The count of the walk of the engine stands of no count of its own",
				);
			}
		}
	}
}

/** The flags of the walk of the engine, of the counts of the tree of the walk of it. */
export const ERISA_ORDER_0 = 0x0000;
export const ERISA_ORDER_1 = 0x0001;
/** The place of the tree of the counts of the walk of a picture of the engine. */
const LENGTH_TREE = 0x100;
const TREES = 0x101;

/**
 * `HuffmanDecodeContext`: the walk of the counts of a picture of the engine, of the tree of the counts of
 * the walk of it. The places of a name of the tree stand of the walk of the places of the tree of the
 * counts of the walk of the engine (`GetHuffmanCode`), of a walk of the counts of the walk of the engine
 * behind them where the places of the name of the tree stand of the places of the count of a walk of no
 * name at all.
 */
export class ErisaHuffmanDecodeContext extends ErisaRleDecodeContext {
	flags: number;
	trees: ErisaHuffmanTree[];
	lastTree: ErisaHuffmanTree | undefined;

	constructor(bufferingSize: number) {
		super(bufferingSize);
		this.flags = ERISA_ORDER_1;
		this.trees = [];
		this.lastTree = undefined;
	}

	/** `PrepareToDecodeERINACode`: the trees of the walk of the counts of the engine. */
	prepareToDecodeErinaCode(flags = ERISA_ORDER_1): void {
		this.flags = flags;
		this.length = 0;
		this.trees = [];
		if (ERISA_ORDER_0 === flags) {
			// The places of the walk of the engine stand of the tree of the counts of the walk of it alone,
			// of no place of a name of the walk of the engine at all.
			const shared = new ErisaHuffmanTree();
			const length = new ErisaHuffmanTree();
			for (let at = 0; at < LENGTH_TREE; at += 1) this.trees.push(shared);
			this.trees.push(length);
		} else {
			for (let at = 0; at < TREES; at += 1) {
				this.trees.push(new ErisaHuffmanTree());
			}
		}
		this.lastTree = this.trees[0];
	}

	override decodeBytes(places: Uint8Array, count: number): number {
		return this.decodeErinaCodeBytes(places, count);
	}

	/** `DecodeErinaCodeBytes`: the places of the walk of the counts of a picture of the engine. */
	decodeErinaCodeBytes(places: Uint8Array, count: number): number {
		let tree = this.lastTree ?? this.trees[0];
		if (!tree) return 0;
		let at = 0;
		// The counts of the walk of the engine that stood of a walk of the engine in front of this walk of
		// it stand of the places of the count of the walk of the engine of no count of them at all.
		if (this.length > 0) {
			let length = Math.min(this.length, count);
			this.length -= length;
			while (0 !== length) {
				places[at] = 0;
				at += 1;
				length -= 1;
			}
		}
		while (at < count) {
			const symbol = this.getHuffmanCode(tree);
			if (ERISA_HUFFMAN_ESCAPE === symbol) break;
			places[at] = symbol & PLACE_MASK;
			at += 1;
			if (0 === symbol) {
				const lengthTree = this.trees[LENGTH_TREE];
				if (!lengthTree) break;
				let length = this.getLengthHuffman(lengthTree);
				if (ERISA_HUFFMAN_ESCAPE === length) break;
				length -= 1;
				if (0 !== length) {
					this.length = length;
					if (at + length > count) length = count - at;
					this.length -= length;
					while (length > 0) {
						places[at] = 0;
						at += 1;
						length -= 1;
					}
				}
			}
			const next = this.trees[symbol & PLACE_MASK];
			if (next) tree = next;
		}
		this.lastTree = tree;
		return at;
	}

	/** `GetHuffmanCode`: the name of a place of the tree of the counts of the walk of the engine. */
	getHuffmanCode(tree: ErisaHuffmanTree): number {
		if (tree.escape !== ERISA_HUFFMAN_NULL) {
			let entry = ERISA_HUFFMAN_ROOT;
			let child = tree.tree[ERISA_HUFFMAN_ROOT]?.childCode ?? 0;
			for (;;) {
				if (!this.prefetchBuffer()) return ERISA_HUFFMAN_ESCAPE;
				entry = child + (this.intBuffer >>> 31);
				child = tree.tree[entry]?.childCode ?? 0;
				this.intBuffer = (this.intBuffer << 1) >>> 0;
				this.intBufCount -= 1;
				if (0 !== (child & ERISA_CODE_FLAG)) break;
			}
			if (
				this.flags !== ERISA_ORDER_0 ||
				(tree.tree[ERISA_HUFFMAN_ROOT]?.weight ?? 0) < ERISA_HUFFMAN_MAX - 1
			) {
				tree.increaseOccuredCount(entry);
			}
			const code = child & ~ERISA_CODE_FLAG;
			if (code !== ERISA_HUFFMAN_ESCAPE) return code;
		}
		const code = this.getNBits(8);
		tree.addNewEntry(code);
		return code;
	}

	/** `GetLengthHuffman`: the count of the places of a count of no name of the walk of the engine. */
	protected getLengthHuffman(tree: ErisaHuffmanTree): number {
		if (tree.escape !== ERISA_HUFFMAN_NULL) {
			let entry = ERISA_HUFFMAN_ROOT;
			let child = tree.tree[ERISA_HUFFMAN_ROOT]?.childCode ?? 0;
			for (;;) {
				if (!this.prefetchBuffer()) return ERISA_HUFFMAN_ESCAPE;
				entry = child + (this.intBuffer >>> 31);
				child = tree.tree[entry]?.childCode ?? 0;
				this.intBuffer = (this.intBuffer << 1) >>> 0;
				this.intBufCount -= 1;
				if (0 !== (child & ERISA_CODE_FLAG)) break;
			}
			if (
				this.flags !== ERISA_ORDER_0 ||
				(tree.tree[ERISA_HUFFMAN_ROOT]?.weight ?? 0) < ERISA_HUFFMAN_MAX - 1
			) {
				tree.increaseOccuredCount(entry);
			}
			const code = child & ~ERISA_CODE_FLAG;
			if (code !== ERISA_HUFFMAN_ESCAPE) return code;
		}
		const code = this.getGammaCode() | 0;
		if (-1 === code) return ERISA_HUFFMAN_ESCAPE;
		tree.addNewEntry(code);
		return code;
	}

	/** The places of the tree of the counts of the walk of a picture of the engine, of the control. */
	treeOf(place: number): ErisaHuffmanNode[] {
		return (this.trees[place] ?? new ErisaHuffmanTree()).tree;
	}
}

/** The places of the walk of the tree of the counts of the engine. */
const ERISA_HUFFMAN_ROOT = 0x200;
const ERISA_HUFFMAN_NULL = 0x8000;
const ERISA_HUFFMAN_MAX = 0x4000;
const ERISA_HUFFMAN_ESCAPE = 0x7fffffff;
const ERISA_CODE_FLAG = -2147483648;

/**
 * `ProbDecodeContext`: the walk of the counts of a picture of the engine, of the counts of the walk of the
 * model of it. The counts of the walk of the engine stand of a count of the places of a word of the walk of
 * it (the register of the count and the register of the count of the walk of it), which stand of the places
 * of the walk of the model of the counts of the walk of the engine every count of them they hand over.
 */
export class ErisaProbDecodeContext extends ErisaRleDecodeContext {
	protected codeRegister: number;
	protected augendRegister: number;
	protected postBitCount: number;
	phraseLenProb: ErisaProbModel;
	phraseIndexProb: ErisaProbModel;
	runLenProb: ErisaProbModel;
	lastProb: ErisaProbModel | undefined;
	table: ErisaProbModel[];

	constructor(bufferingSize: number) {
		super(bufferingSize);
		this.codeRegister = 0;
		this.augendRegister = 0;
		this.postBitCount = 0;
		this.phraseLenProb = new ErisaProbModel();
		this.phraseIndexProb = new ErisaProbModel();
		this.runLenProb = new ErisaProbModel();
		this.lastProb = undefined;
		this.table = [];
	}

	/** `PrepareToDecodeERISACode`: the models of the counts of the walk of the engine. */
	prepareToDecodeErisaCode(): void {
		if (0 === this.table.length) {
			for (let at = 0; at < TREES; at += 1) {
				this.table.push(new ErisaProbModel());
			}
		}
		for (const model of this.table) model.initialize();
		this.lastProb = this.table[0];
		this.phraseLenProb.initialize();
		this.phraseIndexProb.initialize();
		this.runLenProb.initialize();
		this.initializeErisaCode();
	}

	override decodeBytes(places: Uint8Array, count: number): number {
		return this.decodeErisaCodeBytes(places, count);
	}

	/** `DecodeERISACodeBytes`: the places of the walk of the counts of a picture of the engine. */
	decodeErisaCodeBytes(places: Uint8Array, count: number): number {
		const model: ErisaProbModel | undefined = this.lastProb ?? this.table[0];
		if (!model) return 0;
		let current: ErisaProbModel = model;
		let at = 0;
		while (at < count) {
			if (this.length > 0) {
				let current = count - at;
				if (current > this.length) current = this.length;
				this.length -= current;
				for (let place = 0; place < current; place += 1) {
					places[at] = 0;
					at += 1;
				}
				continue;
			}
			const index = this.decodeErisaCodeIndex(current);
			if (index < 0) break;
			const symbol: number = current.symTable[index]?.symbol ?? -1;
			current.increaseSymbol(index);
			places[at] = symbol & PLACE_MASK;
			at += 1;
			if (0 === symbol) {
				const runIndex = this.decodeErisaCodeIndex(this.runLenProb);
				if (runIndex < 0) break;
				this.length = this.runLenProb.symTable[runIndex]?.symbol ?? 0;
				this.runLenProb.increaseSymbol(runIndex);
			}
			const next: ErisaProbModel | undefined = this.table[symbol & PLACE_MASK];
			if (next) current = next;
		}
		this.lastProb = current;
		return at;
	}

	/** `InitializeERISACode`: the counts of the walk of the engine stand of the places of a word. */
	initializeErisaCode(): void {
		this.length = 0;
		this.codeRegister = this.getNBits(32);
		this.augendRegister = 0xffff;
		this.postBitCount = 0;
	}

	/** `DecodeERISACode`: the name of a place of the model of the walk of the engine. */
	decodeErisaCode(model: ErisaProbModel): number {
		const index = this.decodeErisaCodeIndex(model);
		let symbol = -1;
		if (index >= 0) {
			symbol = model.symTable[index]?.symbol ?? -1;
			model.increaseSymbol(index);
		}
		return symbol;
	}

	/** `DecodeERISACodeIndex`: the place of a name of the model, of the counts of the walk of it. */
	decodeErisaCodeIndex(model: ErisaProbModel): number {
		const acc = Math.floor(
			(Math.imul(this.codeRegister, model.totalCount) >>> 0) /
				this.augendRegister,
		);
		if (acc >= ERISA_PROB_TOTAL_LIMIT) return -1;
		let index = 0;
		let left = acc & 0xffff;
		let counted = 0;
		for (;;) {
			const place = model.symTable[index];
			if (!place) return -1;
			if (left < place.occured) break;
			left -= place.occured;
			counted += place.occured;
			index += 1;
			if (index >= model.symbolSorts) return -1;
		}
		const occured = model.symTable[index]?.occured ?? 0;
		this.codeRegister =
			(this.codeRegister -
				Math.floor(
					(((Math.imul(this.augendRegister, counted) >>> 0) +
						model.totalCount -
						1) >>>
						0) /
						model.totalCount,
				)) >>>
			0;
		this.augendRegister = Math.floor(
			(Math.imul(this.augendRegister, occured) >>> 0) / model.totalCount,
		);
		if (0 === this.augendRegister) return -1;
		while (0 === (this.augendRegister & 0x8000)) {
			let nextBit = this.getABit();
			// The count of the places of the walk of the engine stands of a place of a bit of the walk of
			// the engine of its own every count of them.
			if (1 === nextBit) {
				this.postBitCount += 1;
				if (this.postBitCount >= 256) return -1;
				nextBit = 0;
			}
			this.codeRegister = ((this.codeRegister << 1) | (nextBit & 1)) >>> 0;
			this.augendRegister = (this.augendRegister << 1) >>> 0;
		}
		this.codeRegister &= 0xffff;
		return index;
	}
}

/** The count of the walk of the model past which the counts of the walk of it stand halved. */
const ERISA_PROB_TOTAL_LIMIT = 0x2000;
