// Format reference: GARbro "ArcFormats/AdvSys/ImageGR2.cs", class `PolaReader` (the walk of the places of a
// picture of the compressed kind of the engine: the places of the walk of the picture and the places of the
// picture they stand for stand in the same stream, the places of the walk standing as the places of the words
// of the stream and the places of the picture standing beside them).

import { GarbroError } from "@garbro-mcp/core";

/** The walk of the places of a picture stands two places short of the places of the picture it stands for. */
export const POLA_TAIL = 2;
const LEAST_MATCH_PLACES = 3;
const COPY_PLACES = 2;
const COUNT_PLACES_STEP = 256;
const NEAR_PLACES = 256;
const FAR_PLACES = 512;
const FURTHER_PLACES = 1024;
const FURTHEST_PLACES = 2048;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PolaReader`: the walk of the places of a picture. The places of the walk of the picture stand in the words
 * of the stream, sixteen places of the walk to a word, and the places of the picture stand beside them: a place
 * of the walk that stands names a place of the picture that stands for itself, and a place of the walk that
 * stands clear names a place of the picture that stands for the places behind it.
 */
class PolaReader {
	private readonly data: Buffer;
	private position = 0;
	private bits = 2;

	constructor(
		data: Buffer,
		private readonly output: Buffer,
	) {
		this.data = data;
	}

	/** `PolaReader.NextBit`: the place of the walk behind the places of the walk read of it. */
	private nextBit(): number {
		const bit = this.bits & 1;
		this.bits >>= 1;
		// A word of the walk of a picture stands for sixteen places of the walk, so the word behind it stands
		// in the stream where the places of the walk of it have been read.
		if (this.bits === 1) this.bits = this.readWord() | 0x10000;
		return bit;
	}

	private readWord(): number {
		if (this.position + 2 > this.data.length)
			throw invalidPicture(
				"The words of the walk of a picture stand short of the places of the picture they stand for",
			);
		const word = this.data.readUInt16LE(this.position);
		this.position += 2;
		return word;
	}

	private readByte(): number {
		if (this.position >= this.data.length)
			throw invalidPicture(
				"The places of the picture stand short of the places they stand for",
			);
		const byte = this.data[this.position] ?? 0;
		this.position += 1;
		return byte;
	}

	/**
	 * The count of the places of a walk of a picture that stands for the places behind it: the places of the
	 * count stand as the places of the walk of the count of them, the shortest counts of three places standing
	 * as the first places of the walk of the count and the longest ones standing as the places of the picture of
	 * the count of its own.
	 */
	private readMatchCount(): number {
		if (this.nextBit() !== 0) return LEAST_MATCH_PLACES;
		if (this.nextBit() !== 0) return 4;
		if (this.nextBit() !== 0) return 5;
		if (this.nextBit() !== 0) return 6;
		if (this.nextBit() !== 0) return this.nextBit() !== 0 ? 8 : 7;
		if (this.nextBit() !== 0) return this.readByte() + 17;
		let count = 9;
		if (this.nextBit() !== 0) count += 4;
		if (this.nextBit() !== 0) count += 2;
		if (this.nextBit() !== 0) count += 1;
		return count;
	}

	/** `Binary.CopyOverlapped`: a walk whose places stand within the places it stands for. */
	private copyOverlapped(src: number, dst: number, count: number): void {
		if (src < 0)
			throw invalidPicture(
				"The places of a walk of a picture stand before the picture",
			);
		for (let at = 0; at < count; at += 1) {
			const from = src + at;
			const to = dst + at;
			if (from >= this.output.length || to >= this.output.length)
				throw invalidPicture(
					"The places of a picture stand past the places they stand for",
				);
			this.output[to] = this.output[from] ?? 0;
		}
	}

	/** `PolaReader.Unpack`. */
	unpack(): void {
		this.nextBit();
		let dst = 0;
		const size = this.output.length - POLA_TAIL;
		while (dst < size) {
			if (this.nextBit() !== 0) {
				this.output[dst] = this.readByte();
				dst += 1;
				continue;
			}
			let count = 0;
			if (this.nextBit() !== 0) {
				let offset = this.readByte() - NEAR_PLACES;
				if (this.nextBit() === 0) count += COUNT_PLACES_STEP;
				if (this.nextBit() === 0) {
					offset -= FAR_PLACES;
					if (this.nextBit() === 0) {
						count *= 2;
						if (this.nextBit() === 0) count += COUNT_PLACES_STEP;
						offset -= FAR_PLACES;
						if (this.nextBit() === 0) {
							count *= 2;
							if (this.nextBit() === 0) count += COUNT_PLACES_STEP;
							offset -= FURTHER_PLACES;
							if (this.nextBit() === 0) {
								offset -= FURTHEST_PLACES;
								count *= 2;
								if (this.nextBit() === 0) count += COUNT_PLACES_STEP;
							}
						}
					}
				}
				// The places of the walk of a picture stand for the places of the picture standing behind the
				// place of the walk that stands for itself, which the places of the walk of a picture stand for
				// as well.
				offset -= count;
				// The words of the count of the places of a walk of a picture stand beside each other in the
				// stream, so the words of the walk of a picture stand alike and stand apart by the places of the
				// walk they stand for.
				count = this.readMatchCount();
				if (dst + count > size) count = size - dst;
				this.copyOverlapped(dst + offset, dst, count);
				dst += count;
				continue;
			}
			let offset = this.readByte() - NEAR_PLACES;
			if (this.nextBit() === 0) {
				if (offset !== -1) {
					this.copyOverlapped(dst + offset, dst, COPY_PLACES);
					dst += COPY_PLACES;
				} else if (this.nextBit() === 0) break;
			} else {
				offset -= NEAR_PLACES;
				if (this.nextBit() === 0) offset -= FURTHER_PLACES;
				if (this.nextBit() === 0) offset -= FAR_PLACES;
				if (this.nextBit() === 0) offset -= NEAR_PLACES;
				this.copyOverlapped(dst + offset, dst, COPY_PLACES);
				dst += COPY_PLACES;
			}
		}
	}
}

/** `PolaReader`: the places of a picture of the compressed kind of the engine, walked. */
export function unpackPolaPicture(data: Buffer, unpackedSize: number): Buffer {
	if (unpackedSize < 0)
		throw invalidPicture("The places of a picture of this kind stand nowhere");
	const output = Buffer.alloc(unpackedSize + POLA_TAIL);
	new PolaReader(data, output).unpack();
	return output;
}
