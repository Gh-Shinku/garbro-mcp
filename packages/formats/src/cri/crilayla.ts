import { GarbroError } from "@garbro-mcp/core";

class MsbBitReader {
	readonly #buffer: Buffer;
	#byte = 0;
	#bit = 0;

	constructor(buffer: Buffer) {
		this.#buffer = buffer;
	}

	readBits(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			if (this.#byte >= this.#buffer.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"CRILAYLA bitstream is truncated",
				);
			}
			value =
				(value << 1) |
				(((this.#buffer[this.#byte] ?? 0) >> (7 - this.#bit)) & 1);
			this.#bit += 1;
			if (this.#bit === 8) {
				this.#bit = 0;
				this.#byte += 1;
			}
		}
		return value;
	}
}

export function decompressCrilayla(input: Uint8Array): Buffer {
	const source = Buffer.from(input);
	if (
		source.length < 16 ||
		!source.subarray(0, 8).equals(Buffer.from("CRILAYLA"))
	) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid CRILAYLA header");
	}
	const unpackedSize = source.readInt32LE(8);
	const packedSize = source.readUInt32LE(12);
	if (
		unpackedSize < 0 ||
		packedSize > source.length - 16 ||
		unpackedSize > 0x7fffffff - (source.length - 16 - packedSize)
	) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid CRILAYLA sizes");
	}
	const prefixSize = source.length - 16 - packedSize;
	const output = Buffer.alloc(unpackedSize + prefixSize);
	const packed = Buffer.from(source.subarray(16, 16 + packedSize)).reverse();
	const bits = new MsbBitReader(packed);
	let destination = prefixSize;
	const countWidths = [2, 3, 5, 8];
	while (destination < output.length) {
		if (bits.readBits(1) === 0) {
			output[destination++] = bits.readBits(8);
			continue;
		}
		let count = 3;
		const offset = bits.readBits(13) + 3;
		for (const width of countWidths) {
			const step = bits.readBits(width);
			count += step;
			if (step !== (1 << width) - 1) break;
		}
		if (offset > destination || count > output.length - destination) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid CRILAYLA back-reference",
			);
		}
		for (let index = 0; index < count; index += 1) {
			output[destination] = output[destination - offset] ?? 0;
			destination += 1;
		}
	}
	output.subarray(prefixSize).reverse();
	source.copy(output, 0, 16 + packedSize);
	return output;
}
