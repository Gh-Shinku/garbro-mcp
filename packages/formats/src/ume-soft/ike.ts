// Format reference: GARBro Legacy/UMeSoft/ArcBIN.cs, class `IkeReader`, shared by the U-Me Soft
// resource archives and the Penguin Works resource archives.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";

/** The reference allocates the declared size outright, so an implausible value is refused instead. */
const MAX_UNPACKED_SIZE = 0x4000000;
const REFILL_FLAG = 0x10000;

/**
 * GARbro `IkeReader.GetBit`. A 16-bit little-endian window is loaded on the first bit and refilled
 * whenever the shifted-out value reaches the sentinel that marks an exhausted window. Byte reads the
 * decoder interleaves with bit reads share the same cursor, so a single reader owns both.
 */
class IkeReader {
	readonly #data: Buffer;
	#position: number;
	#bits = 2;

	constructor(data: Buffer, position = 0) {
		this.#data = data;
		this.#position = position;
	}

	getBit(): number {
		const bit = this.#bits & 1;
		this.#bits >>= 1;
		if (this.#bits === 1) {
			if (this.#position + 2 > this.#data.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated Ike stream");
			this.#bits =
				(this.#data.readUInt16LE(this.#position) | REFILL_FLAG) >>> 0;
			this.#position += 2;
		}
		return bit;
	}

	readByte(): number {
		if (this.#position >= this.#data.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Ike stream");
		return this.#data[this.#position++] ?? 0;
	}
}

/**
 * GARBro `IkeReader.Unpack`'s length ladder. Each rung consumes one bit and reports whether it matched,
 * so the order of the tests matters: three through six, then a two-bit rung that selects seven or
 * eight, then a byte-based length of seventeen or more, and finally a three-bit rung around nine.
 */
function readIkeMatchLength(reader: IkeReader): number {
	if (reader.getBit() !== 0) return 3;
	if (reader.getBit() !== 0) return 4;
	if (reader.getBit() !== 0) return 5;
	if (reader.getBit() !== 0) return 6;
	if (reader.getBit() !== 0) return reader.getBit() !== 0 ? 8 : 7;
	if (reader.getBit() !== 0) return reader.readByte() + 17;
	let count = 9;
	if (reader.getBit() !== 0) count = 13;
	if (reader.getBit() !== 0) count += 2;
	if (reader.getBit() !== 0) count += 1;
	return count;
}

/** GARBro `IkeReader.DecodeSize`: a 3-byte size whose high byte keeps only six significant bits. */
export function decodeIkeSize(a: number, b: number, c: number): number {
	return b + ((c + ((a >> 2) << 8)) << 8);
}

/**
 * GARBro `IkeReader.Unpack`. The first bit is discarded, then flag bits select between a literal byte
 * and a back reference. Back references come in two widths: a short form whose length is fixed at two
 * bytes, and a long form whose distance is assembled from a chain of sign bits and whose length is
 * coded in a unary-ish ladder from three up to a literal byte plus seventeen. The special distance of
 * -1 either ends the stream or is skipped, and copies expand byte by byte into the output.
 *
 * The reference reads past the final byte and past the start of the output with unchecked accesses;
 * the port reports those as invalid archives instead, and allocates the declared size outright so the
 * decoded length always matches it.
 */
export function unpackIke(input: Buffer, unpackedSize: number): Buffer {
	if (unpackedSize <= 0 || unpackedSize > MAX_UNPACKED_SIZE)
		throw new GarbroError("INVALID_ARCHIVE", "Implausible Ike unpacked size");
	const output = Buffer.alloc(unpackedSize);
	const reader = new IkeReader(input);
	reader.getBit();
	let destination = 0;
	while (destination < output.length) {
		if (reader.getBit() !== 0) {
			output[destination++] = reader.readByte();
			continue;
		}
		let offset: number;
		let count: number;
		if (reader.getBit() !== 0) {
			offset = reader.readByte() - 0x100;
			let shift = 0;
			if (reader.getBit() === 0) shift += 0x100;
			if (reader.getBit() === 0) {
				offset -= 0x200;
				if (reader.getBit() === 0) {
					shift <<= 1;
					if (reader.getBit() === 0) shift += 0x100;
					offset -= 0x200;
					if (reader.getBit() === 0) {
						shift <<= 1;
						if (reader.getBit() === 0) shift += 0x100;
						offset -= 0x400;
						if (reader.getBit() === 0) {
							offset -= 0x800;
							shift <<= 1;
							if (reader.getBit() === 0) shift += 0x100;
						}
					}
				}
			}
			offset -= shift;
			count = readIkeMatchLength(reader);
		} else {
			offset = reader.readByte() - 0x100;
			if (reader.getBit() !== 0) {
				offset -= 0x100;
				if (reader.getBit() === 0) offset -= 0x400;
				if (reader.getBit() === 0) offset -= 0x200;
				if (reader.getBit() === 0) offset -= 0x100;
			} else if (offset === -1) {
				if (reader.getBit() === 0) break;
				continue;
			}
			count = 2;
		}
		count = Math.min(count, output.length - destination);
		const from = destination + offset;
		if (from < 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ike back reference");
		for (let index = 0; index < count; index += 1)
			output[destination + index] = output[from + index] ?? 0;
		destination += count;
	}
	return output;
}
