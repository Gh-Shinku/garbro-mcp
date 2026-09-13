// Codec reference: GARBro ArcFormats/Ankh/ArcGRP.cs, classes `GrpUnpacker` (bit reader, variant
// guessing, HDJ/S/A unpackers) and `GrpOpener.UnpackTpw`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";

/**
 * GARbro keeps two interchangeable stream variants in a process-wide variable: several games use the
 * same headers with slightly different layouts, so a failed attempt switches the decoder to the other
 * variant and that choice sticks for the next archive of the same run.
 */
type GrpVariant = "default" | "boD";

let lastUsedMethod: GrpVariant = "default";

function getOppositeVariant(): GrpVariant {
	return lastUsedMethod === "default" ? "boD" : "default";
}

/** Sign-extends the low thirteen bits, the distance encoding of an HDJ word match. */
function signExtend13(value: number): number {
	const raw = value & 0x1fff;
	return raw >= 0x1000 ? raw - 0x2000 : raw;
}

/** Sign-extends the low eight bits, the distance encoding of an HDJ byte match. */
function signExtend8(value: number): number {
	const raw = value & 0xff;
	return raw >= 0x80 ? raw - 0x100 : raw;
}

/**
 * GARbro `GrpUnpacker`. The bit reader caches a whole little-endian word and hands out bits from the
 * most significant end; because the HDJ decoder also reads words for its literal and match caches from
 * the same stream, the two readers interleave and the port keeps the same shared cursor.
 *
 * An out-of-range read raises an invalid-archive error, which is what the reference relies on: a
 * decoding attempt that fails is retried with the opposite variant, and only the HDJ unpacker treats
 * the retry's failure as fatal.
 */
export class GrpUnpacker {
	readonly #input: Buffer;
	#position = 0;
	#bits = 0;
	#cachedBits = 0;

	constructor(input: Buffer) {
		this.#input = input;
	}

	/**
	 * GARbro `GrpUnpacker.UnpackHDJ`: decode with the remembered variant, fall back to the other one on
	 * error, and remember the variant that worked. The recalled variant also fails when its back
	 * references are out of range, in which case the reference falls through to the fallback as well.
	 */
	unpackHdj(output: Buffer, destination = 0): void {
		try {
			if (this.#unpackHdjVariant(output, destination, lastUsedMethod)) return;
		} catch {
			// A failed attempt is retried with the opposite variant.
		}
		const method = getOppositeVariant();
		this.#position = 0;
		if (!this.#unpackHdjVariant(output, destination, method))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid HDJ stream");
		lastUsedMethod = method;
	}

	/** GARbro `GrpUnpacker.UnpackHDJVariant`. */
	#unpackHdjVariant(
		output: Buffer,
		destination: number,
		method: GrpVariant,
	): boolean {
		this.#resetBits();
		let wordCount = 0;
		let byteCount = 0;
		let nextByte = 0;
		let nextWord = 0;
		let dst = destination;
		while (dst < output.length) {
			if (this.#nextBit() !== 0) {
				let count: number;
				let longCount: boolean;
				let offset: number;
				if (this.#nextBit() !== 0) {
					if (wordCount === 0) {
						nextWord = this.#readU32();
						wordCount = 2;
					}
					count = ((nextWord >>> 13) & 7) + 3;
					offset = signExtend13(nextWord);
					nextWord >>>= 16;
					wordCount -= 1;
					longCount = count === 10;
				} else {
					// The variants differ in whether the short count is read before the byte cache refill.
					const beforeRefill =
						method === "default" ? this.#getBits(2) : undefined;
					if (byteCount === 0) {
						nextByte = this.#readU32();
						byteCount = 4;
					}
					const afterRefill =
						method !== "default" ? this.#getBits(2) : undefined;
					count = (beforeRefill ?? afterRefill ?? 0) + 2;
					longCount = count === 5;
					offset = signExtend8(nextByte);
					nextByte >>>= 8;
					byteCount -= 1;
				}
				if (longCount) {
					let extra = 0;
					while (this.#nextBit() !== 0) extra += 1;
					if (extra !== 0) count += this.#getBits(extra) + 1;
				}
				const from = dst + offset;
				if (from < 0 || from >= dst || dst + count > output.length)
					return false;
				for (let index = 0; index < count; index += 1)
					output[dst + index] = output[from + index] ?? 0;
				dst += count;
			} else {
				if (byteCount === 0) {
					nextByte = this.#readU32();
					byteCount = 4;
				}
				output[dst++] = nextByte & 0xff;
				nextByte >>>= 8;
				byteCount -= 1;
			}
		}
		return true;
	}

	/**
	 * GARbro `GrpUnpacker.UnpackS`: try the remembered variant, then the other one. A variant counts as
	 * successful only when it consumes the stored stream exactly, so a failing retry is silent and the
	 * partially decoded buffer is returned as is.
	 */
	unpackS(output: Buffer, destination: number, channels: number): void {
		try {
			if (this.#unpackSVariant(output, destination, channels, lastUsedMethod))
				return;
		} catch {
			// A failed attempt is retried with the opposite variant.
		}
		const method = getOppositeVariant();
		this.#position = 0;
		if (this.#unpackSVariant(output, destination, channels, method))
			lastUsedMethod = method;
	}

	/** GARbro `GrpUnpacker.UnpackSVariant`, whose success test is an exhausted stream. */
	#unpackSVariant(
		output: Buffer,
		destination: number,
		channels: number,
		method: GrpVariant,
	): boolean {
		// The default variant is the per-channel one; the BoD variant is the single-stream one.
		if (method === "default") this.#unpackSv2(output, destination, channels);
		else this.#unpackSv1(output, destination);
		return this.#position >= this.#input.length;
	}

	/** GARbro `GrpUnpacker.UnpackSv1`, the single-stream variant. */
	#unpackSv1(output: Buffer, destination: number): void {
		this.#resetBits();
		let lastWord = 0;
		let dst = destination;
		while (dst < output.length) {
			let word: number;
			if (this.#nextBit() !== 0) {
				word = this.#nextBit() !== 0 ? this.#getBits(10) << 6 : 0;
			} else {
				const raw = this.#getBits(5) << 6;
				const adjust = (raw & 0x400) !== 0 ? -(raw & 0x3ff) : raw;
				word = lastWord + adjust;
			}
			lastWord = toInt16(word);
			output.writeInt16LE(lastWord, dst);
			dst += 2;
		}
	}

	/** GARbro `GrpUnpacker.UnpackSv2`, the per-channel variant with run-length zeroes. */
	#unpackSv2(output: Buffer, destination: number, channels: number): void {
		if (channels !== 1) this.#position += (channels - 1) * 4;
		const step = channels * 2;
		let base = destination;
		for (let channel = 0; channel < channels; channel += 1) {
			this.#resetBits();
			let position = base;
			let lastWord = 0;
			while (position < output.length) {
				let word: number;
				if (this.#nextBit() !== 0) {
					if (this.#nextBit() !== 0) {
						word = this.#getBits(10) << 6;
					} else {
						let repeat: number;
						if (this.#nextBit() !== 0) {
							let bitLength = 0;
							while (this.#nextBit() !== 0) bitLength += 1;
							repeat = this.#getBits(bitLength) + 4;
						} else {
							repeat = this.#getBits(2);
						}
						word = 0;
						while (repeat > 0) {
							repeat -= 1;
							this.#writeInt16(output, position, 0);
							position += step;
						}
					}
				} else {
					const raw = this.#getBits(5) << 11;
					const adjust = ((raw << 16) >> 16) >> 5;
					word = lastWord + adjust;
				}
				lastWord = toInt16(word);
				this.#writeInt16(output, position, lastWord);
				position += step;
			}
			base += 2;
		}
	}

	/** GARbro `GrpUnpacker.UnpackA`, which packs one absolute value per channel step. */
	unpackA(output: Buffer, destination: number, channels: number): void {
		if (channels !== 1) this.#position += (channels - 1) * 4;
		const step = 2 * channels;
		let base = destination;
		for (let channel = 0; channel < channels; channel += 1) {
			let position = base;
			this.#resetBits();
			while (position < output.length) {
				const word = toInt16(this.#getBits(10) << 6);
				this.#writeInt16(output, position, word);
				position += step;
			}
			base += 2;
		}
	}

	/** Writes a little-endian word, raising where the reference's array write would. */
	#writeInt16(output: Buffer, offset: number, value: number): void {
		if (offset + 2 > output.length)
			throw new GarbroError("INVALID_ARCHIVE", "Sample out of range");
		output.writeInt16LE(value, offset);
	}

	#resetBits(): void {
		this.#cachedBits = 0;
	}

	#nextBit(): number {
		return this.#getBits(1);
	}

	/** GARbro `GrpUnpacker.GetBits`: a word-sized cache consumed from the most significant bit down. */
	#getBits(count: number): number {
		if (count > 32)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid bit count");
		if (this.#cachedBits === 0) {
			this.#bits = this.#readU32();
			this.#cachedBits = 32;
		}
		let value: number;
		if (this.#cachedBits < count) {
			const nextBits = this.#readU32();
			value = (this.#bits | (nextBits >>> this.#cachedBits)) >>> (32 - count);
			this.#bits = (nextBits << (count - this.#cachedBits)) >>> 0;
			this.#cachedBits = 32 - (count - this.#cachedBits);
		} else {
			value = this.#bits >>> (32 - count);
			this.#bits = (this.#bits << count) >>> 0;
			this.#cachedBits -= count;
		}
		return value;
	}

	/** Reads a little-endian word, raising where the reference's strict read would. */
	#readU32(): number {
		if (this.#position + 4 > this.#input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated bit stream");
		const value = this.#input.readUInt32LE(this.#position);
		this.#position += 4;
		return value;
	}
}

function toInt16(value: number): number {
	return (value << 16) >> 16;
}

/**
 * GARbro `GrpOpener.UnpackTpw`. The control stream starts behind an eight-byte header whose first word
 * seeds three copy distances; controls below 0x40 copy literal bytes, the next two ranges expand a
 * literal byte or two- and three-byte patterns, and the last range copies from one of the three seeded
 * distances.
 */
export function unpackTpw(input: Buffer, output: Buffer): void {
	let position = 8;
	const readU8 = (): number => {
		if (position >= input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated TPW stream");
		return input[position++] ?? 0;
	};
	const readU16 = (): number => {
		if (position + 2 > input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated TPW stream");
		const value = input.readUInt16LE(position);
		position += 2;
		return value;
	};
	const seed = readU16();
	const distances = [seed, seed * 2, seed * 3, seed * 4];
	let dst = 0;
	while (dst < output.length) {
		if (position >= input.length) break;
		const control = input[position++] ?? 0;
		if (control === 0) break;
		const remaining = output.length - dst;
		if (control < 0x40) {
			const count = Math.min(control, remaining);
			const available = Math.min(count, input.length - position);
			input.copy(output, dst, position, position + available);
			position += available;
			dst += available;
		} else if (control <= 0x6f) {
			const raw = control === 0x6f ? readU16() : control - 0x3d;
			const count = Math.min(raw, remaining);
			const value = readU8();
			for (let index = 0; index < count; index += 1)
				output[dst + index] = value;
			dst += count;
		} else if (control <= 0x9f) {
			let count = control === 0x9f ? readU16() : control - 0x6e;
			const available = Math.min(2, remaining, input.length - position);
			input.copy(output, dst, position, position + available);
			position += available;
			dst += available;
			count -= 1;
			if (count > 0 && remaining > 2) {
				count = Math.min(count * 2, remaining - 2);
				copyOverlapped(output, dst - 2, dst, count);
				dst += count;
			}
		} else if (control <= 0xbf) {
			let count = control === 0xbf ? readU16() : control - 0x9e;
			const available = Math.min(3, remaining, input.length - position);
			input.copy(output, dst, position, position + available);
			position += available;
			dst += available;
			count -= 1;
			if (count > 0 && remaining > 3) {
				count = Math.min(count * 3, remaining - 3);
				copyOverlapped(output, dst - 3, dst, count);
				dst += count;
			}
		} else {
			const count = Math.min((control & 0x3f) + 3, remaining);
			const selector = readU8();
			const offset = (selector & 0x3f) - (distances[selector >> 6] ?? 0);
			const from = dst + offset;
			if (from < 0 || from >= dst)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid TPW back reference");
			copyOverlapped(output, from, dst, count);
			dst += count;
		}
	}
}

/** GARbro `Binary.CopyOverlapped`: a forward, byte-by-byte copy that may overlap the destination. */
function copyOverlapped(
	output: Buffer,
	from: number,
	to: number,
	count: number,
): void {
	for (let index = 0; index < count; index += 1)
		output[to + index] = output[from + index] ?? 0;
}
