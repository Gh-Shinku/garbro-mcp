// Format reference: GARbro "ArcFormats/CaramelBox/ArcARC4.cs", class `TzCompression` (the compression of the
// pictures of the engine: a header naming how many places of the picture stand behind it, and the places of the
// picture standing as blocks of the places of the picture of their own, the places of the places of the picture
// standing walked or as they stand, walking of the places of the picture of the words of the walk behind the
// places of the walk of them). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";

/** TzCompression markers, read as little endian 16 bit values. */
export const TZ_STORED = 0x7453; // 'St'
export const TZ_PACKED = 0x745a; // 'Zt'
export const TZ_HEADER_SIZE = 6;
export const TZ_BLOCK_HEADER_SIZE = 8;
export const TZ_KEY_FACTOR = 0x1465d9;
export const TZ_KEY_ADDEND = 0x0fb5;
export const TZ_BUFFER_SIZE = 0x10000;

/** GARbro `TzCompression.DecryptBlock`: a running key subtracts from every little endian word. */
function decryptTzBlock(
	data: Buffer,
	offset: number,
	count: number,
	initialKey: number,
): void {
	let key = initialKey >>> 0;
	for (let index = 0; index + 2 <= count; index += 2) {
		key = (key * TZ_KEY_FACTOR + TZ_KEY_ADDEND) >>> 0;
		const position = offset + index;
		const word = data.readUInt16LE(position);
		data.writeUInt16LE((word - (key >>> 16)) & 0xffff, position);
	}
}

/** GARbro `TzCompression.UnpackBlock`: literals and three widths of back reference. */
function unpackTzBlock(
	input: Buffer,
	source: number,
	inputSize: number,
	output: Buffer,
	destination: number,
	outputSize: number,
): void {
	const sourceEnd = Math.min(source + inputSize, input.length);
	const outputEnd = Math.min(destination + outputSize, output.length);
	let src = source;
	let dst = destination;
	while (src < sourceEnd && dst < outputEnd) {
		let control = input[src] ?? 0;
		src += 1;
		if (control === 0) break;
		if ((control & 0x80) !== 0) {
			let count: number;
			let offset: number;
			if ((control & 0x40) !== 0) {
				if ((control & 0x20) !== 0) {
					control =
						(((control << 8) | (input[src] ?? 0)) << 8) | (input[src + 1] ?? 0);
					src += 2;
					count = (control & 0x3f) + 4;
					offset = (control >> 6) & 0x7fff;
				} else {
					control = (control << 8) | (input[src] ?? 0);
					src += 1;
					count = (control & 7) + 3;
					offset = (control >> 3) & 0x3ff;
				}
			} else {
				count = (control & 3) + 2;
				offset = (control >> 2) & 0xf;
			}
			offset += 1;
			for (let i = 0; i < count && dst < outputEnd; i += 1) {
				output[dst] = output[dst - offset] ?? 0;
				dst += 1;
			}
		} else {
			const length = Math.min(control, outputEnd - dst, sourceEnd - src);
			input.copy(output, dst, src, src + length);
			src += length;
			dst += length;
		}
	}
}

/** GARbro `TzCompression.Unpack`: a size header followed by stored and packed blocks. */
export function unpackTz(data: Buffer): Buffer {
	if (data.length < TZ_HEADER_SIZE) return Buffer.alloc(0);
	const unpackedSize = data.readUInt32LE(2);
	const output = Buffer.alloc(unpackedSize);
	let position = TZ_HEADER_SIZE;
	let destination = 0;
	const block = Buffer.alloc(TZ_BUFFER_SIZE);
	while (destination < output.length) {
		if (position + TZ_BLOCK_HEADER_SIZE > data.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated compressed block");
		const signature = data.readUInt16LE(position);
		const blockSize = data.readUInt16LE(position + 2);
		const unpackedBlockSize = data.readUInt16LE(position + 4);
		const key = data.readUInt16LE(position + 6);
		position += TZ_BLOCK_HEADER_SIZE;
		if (unpackedBlockSize === 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid compressed block");
		if (position + blockSize > data.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated compressed block");
		data.copy(block, 0, position, position + blockSize);
		position += blockSize;
		decryptTzBlock(block, 0, blockSize, key);
		if (signature === TZ_STORED) {
			block.copy(output, destination, 0, unpackedBlockSize);
		} else if (signature === TZ_PACKED) {
			unpackTzBlock(
				block,
				0,
				blockSize,
				output,
				destination,
				unpackedBlockSize,
			);
		} else {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid compressed block marker",
			);
		}
		destination += unpackedBlockSize;
	}
	return output;
}
