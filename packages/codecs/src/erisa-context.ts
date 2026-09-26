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
const BASE_LIMIT = 0x100;

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
