// Port of GARbro "ArcFormats/FC01/ArcMRG.cs" (`MrgDecoder`, the static frequency arithmetic decoder of the
// F&C engine), GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The words of the head
// of a walk of it stand of a table of counts of the places of the file, of the places of the walk behind the
// places of the counts themselves.

import { GarbroError } from "@garbro-mcp/core";

/** The count of the counts of the words of the walk of a picture. */
const COUNTS_SIZE = 0x100;
/** The count of the places of the file of the head of a picture of the walk of the words of it. */
const HEADER_SIZE = 4;
/** The count of the places of the file of the word the head of a picture stands of. */
const HEADER_WORD_OFFSET = 0x104;
/** The count of the counts of the table stands of two places of the file; above it the total stands of the
 * counts of the places of the file alone. */
const TOTAL_LIMIT = 0x10000;

function invalidWalk(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `Binary.RotByteL`: the places of a place of the file, of the places of the file behind them. */
export function rotateByteLeft(value: number, count: number): number {
	const places = count & 7;
	const v = value & 0xff;
	return ((v << places) | (v >>> (8 - places))) & 0xff;
}

/**
 * `MrgDecoder`: the walk of the places of the file of a picture of the engine, of a table of counts of the
 * cells of it. The walk stands of a code of the places of the file the counts of the table name, of the
 * places of the file of the code itself the last of them the first.
 */
export class MrgDecoder {
	private src: number;
	private key = 0;
	private readonly words = new Uint16Array(COUNTS_SIZE * 2);
	private readonly cells = new Uint8Array(TOTAL_LIMIT);
	readonly data: Buffer;

	constructor(
		private readonly input: Buffer,
		start: number,
		unpackedSize: number,
	) {
		this.src = start;
		this.start = start;
		this.data = Buffer.alloc(unpackedSize, 0x00);
	}

	private readonly start: number;

	/**
	 * `MrgDecoder (byte[] data, int index = 0)`: the count of the places of the walk of a picture stands
	 * of two words of the head of it, of the places of the file of the places of the walk the other way
	 * round.
	 */
	static fromHeader(data: Buffer, index = 0): MrgDecoder {
		if (index + HEADER_WORD_OFFSET + 4 > data.length) {
			throw invalidWalk(
				"The head of the walk of the places of the file stands short of it",
			);
		}
		const unpackedSize =
			(data.readUInt32LE(index) ^
				data.readUInt32LE(index + HEADER_WORD_OFFSET)) >>>
			0;
		return new MrgDecoder(data, index + HEADER_SIZE, unpackedSize);
	}

	/** `MrgDecoder.ResetKey`: the walk of the places of the file stands of the head of it again. */
	resetKey(key: number): void {
		this.src = this.start;
		this.key = key & 0xff;
	}

	/** `MrgDecoder.InitTable`: the counts of the cells of the walk of the table of them. */
	private initTable(): number {
		let total = 0;
		let at = 0;
		let key = this.key;
		for (let place = 0; place < COUNTS_SIZE; place += 1) {
			if (this.src >= this.input.length) {
				throw invalidWalk("The counts of the walk stand short of the file");
			}
			let count = this.input[this.src] ?? 0;
			this.src += 1;
			if (0 !== this.key) {
				// The counts of a picture of a password of its own stand of the places of the file the
				// other way round, of the places of the password of it.
				count = (rotateByteLeft(count, 1) ^ key) & 0xff;
				key = (key - place) & 0xff;
			}
			this.words[place * 2] = total;
			this.words[place * 2 + 1] = count;
			total = (total + count) & 0xffff;
			for (let cell = 0; cell < count; cell += 1) {
				this.cells[at] = place;
				at += 1;
			}
		}
		return total;
	}

	/** `MrgDecoder.GetMask`: the places of the file of the walk of the counts of the table of it. */
	private static getMask(total: number): number {
		let places = (total - 1) >>> 8;
		let result = 0xff;
		while (places > 0) {
			places >>>= 1;
			result = ((result << 1) | 1) & 0xffff;
		}
		return result;
	}

	/** `MrgDecoder.Unpack`: the places of the picture of the walk of the table of the counts of them. */
	unpack(): number {
		const quant = this.initTable();
		if (0 === quant || quant > TOTAL_LIMIT) {
			throw invalidWalk(
				"The counts of the walk of the table of them stand of no count",
			);
		}
		const mask = MrgDecoder.getMask(quant);
		const scale = Math.floor(TOTAL_LIMIT / quant) >>> 0;
		let low = 0;
		let range = 0xffffffff;
		let destination = 0;
		if (this.src + 4 > this.input.length) {
			throw invalidWalk("The places of the walk stand short of the file");
		}
		let code = this.input.readUInt32BE(this.src) >>> 0;
		this.src += 4;
		while (destination < this.data.length) {
			range = (Math.imul(range >>> 8, scale) >>> 0) >>> 8;
			const value = Math.floor(((code - low) >>> 0) / range);
			if (value > quant) {
				throw invalidWalk(
					"The places of the walk of the table of the counts stand of no count",
				);
			}
			const cell = this.cells[value] ?? 0;
			this.data[destination] = cell;
			destination += 1;
			low = (low + Math.imul(this.words[cell * 2] ?? 0, range)) >>> 0;
			range = Math.imul(range, this.words[cell * 2 + 1] ?? 0) >>> 0;
			// The places of the file of the walk of the counts stand of the same place of the file alone.
			while (0 === (((low + range) ^ low) & 0xff000000)) {
				if (this.src >= this.input.length) return destination;
				code = ((code << 8) | (this.input[this.src] ?? 0)) >>> 0;
				this.src += 1;
				low = (low << 8) >>> 0;
				range = (range << 8) >>> 0;
			}
			while (range <= mask) {
				if (this.src >= this.input.length) return destination;
				range = (((~low & mask) << 8) >>> 0) >>> 0;
				code = ((code << 8) | (this.input[this.src] ?? 0)) >>> 0;
				this.src += 1;
				low = (low << 8) >>> 0;
			}
		}
		return destination;
	}
}
