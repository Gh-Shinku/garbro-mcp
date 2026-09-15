// Format reference: GARbro "ArcFormats/Kid/ArcDAT.cs", class `LnkOpener` and its helper routines.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { copyOverlapped } from "../shared/copy.js";

/**
 * `LnkOpener.UnpackLnd`: a byte oriented LZ scheme with a single byte run, a back reference and a
 * literal run that is repeated once.
 */
export function unpackLnd(
	input: Buffer,
	start: number,
	unpackedSize: number,
): Buffer {
	const output = Buffer.alloc(unpackedSize);
	let cursor = start;
	let written = 0;
	while (written < unpackedSize) {
		if (cursor >= input.length) break;
		const control = input[cursor] ?? 0;
		cursor += 1;
		if ((control & 0x80) !== 0) {
			if ((control & 0x40) !== 0) {
				let count = (control & 0x1f) + 2;
				if ((control & 0x20) !== 0) {
					if (cursor >= input.length) break;
					count += (input[cursor] ?? 0) << 5;
					cursor += 1;
				}
				count = Math.min(count, unpackedSize - written);
				const value = input[cursor] ?? 0;
				cursor += 1;
				output.fill(value, written, written + count);
				written += count;
			} else {
				let count = ((control >> 2) & 0x0f) + 2;
				const offset = ((control & 3) << 8) + (input[cursor] ?? 0) + 1;
				cursor += 1;
				count = Math.min(count, unpackedSize - written);
				copyOverlapped(output, written - offset, written, count);
				written += count;
			}
		} else if ((control & 0x40) !== 0) {
			const length = Math.min((control & 0x3f) + 2, unpackedSize - written);
			const repeats = input[cursor] ?? 0;
			cursor += 1;
			input.copy(output, written, cursor, cursor + length);
			cursor += length;
			written += length;
			const count = Math.min(repeats * length, unpackedSize - written);
			if (count > 0) {
				copyOverlapped(output, written - length, written, count);
				written += count;
			}
		} else {
			let count = (control & 0x1f) + 1;
			if ((control & 0x20) !== 0) {
				if (cursor >= input.length) break;
				count += (input[cursor] ?? 0) << 5;
				cursor += 1;
			}
			count = Math.min(count, unpackedSize - written);
			input.copy(output, written, cursor, cursor + count);
			cursor += count;
			written += count;
		}
	}
	return output;
}

const LCG_MULTIPLIER = 1103515245;
const LCG_INCREMENT = 39686;

export interface CpsHeader {
	packedSize: number;
	compression: number;
	unpackedSize: number;
	keyOffset: number;
	key: number;
}

/** Reads the CPS trailer and header of an entry. */
export function readCpsHeader(input: Buffer): CpsHeader | undefined {
	if (input.length < 4) return undefined;
	const keyOffset = (input.readUInt32LE(input.length - 4) - 0x7534682) >>> 0;
	if (keyOffset + 4 + 0x10 > input.length) return undefined;
	const key = (input.readUInt32LE(keyOffset) + keyOffset + 0x3786425) >>> 0;
	const header = input.subarray(keyOffset + 4, keyOffset + 4 + 0x10);
	return {
		packedSize: header.readInt32LE(4),
		compression: header.readUInt16LE(0x0a),
		unpackedSize: header.readInt32LE(0x0c),
		keyOffset,
		key,
	};
}

/**
 * `CpsTransform`: a four byte block stream cipher. Blocks are reduced by a rolling key unless they sit
 * at the key offset, and the last block is zeroed.
 */
export function decryptCps(
	input: Buffer,
	start: number,
	header: CpsHeader,
): Buffer {
	const output = Buffer.alloc(input.length - start);
	let position = 0x10;
	let key = header.key;
	let cursor = start;
	let destination = 0;
	while (cursor + 4 <= input.length) {
		if (position === header.packedSize - 4) {
			output.fill(0, destination, destination + 4);
			break;
		}
		let data = input.readUInt32LE(cursor);
		if (position !== header.keyOffset && header.keyOffset !== 0)
			data = (data - (key + header.packedSize)) >>> 0;
		output.writeUInt32LE(data, destination);
		cursor += 4;
		destination += 4;
		position += 4;
		key = (Math.imul(LCG_MULTIPLIER, key) + LCG_INCREMENT) >>> 0;
	}
	return output;
}
