import { GarbroError } from "@garbro-mcp/core";

class MsbBitReader {
	readonly #input: Buffer;
	#byteOffset = 0;
	#bitOffset = 0;

	constructor(input: Uint8Array) {
		this.#input = Buffer.from(input);
	}

	readBits(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			if (this.#byteOffset >= this.#input.length) {
				throw new GarbroError("INVALID_ARCHIVE", "ACP LZW stream is truncated");
			}
			value =
				value * 2 +
				(((this.#input[this.#byteOffset] ?? 0) >> (7 - this.#bitOffset)) & 1);
			this.#bitOffset += 1;
			if (this.#bitOffset === 8) {
				this.#bitOffset = 0;
				this.#byteOffset += 1;
			}
		}
		return value;
	}
}

export function decompressAcpLzw(
	input: Uint8Array,
	unpackedSize: number,
): Buffer {
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError("INVALID_ARCHIVE", "ACP LZW output size is invalid");
	}
	const bits = new MsbBitReader(input);
	const output = Buffer.alloc(unpackedSize);
	const dictionary = new Int32Array(0x8900);
	let destination = 0;
	let tokenWidth = 9;
	let dictionaryPosition = 0;
	while (destination < output.length) {
		const token = bits.readBits(tokenWidth);
		if (token === 0x100) break;
		if (token === 0x101) {
			tokenWidth += 1;
			if (tokenWidth > 24) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"ACP LZW token width is invalid",
				);
			}
			continue;
		}
		if (token === 0x102) {
			tokenWidth = 9;
			dictionaryPosition = 0;
			continue;
		}
		if (dictionaryPosition >= dictionary.length) {
			throw new GarbroError("INVALID_ARCHIVE", "ACP LZW dictionary is full");
		}
		dictionary[dictionaryPosition++] = destination;
		if (token < 0x100) {
			output[destination++] = token;
			continue;
		}
		const dictionaryToken = token - 0x103;
		if (dictionaryToken < 0 || dictionaryToken >= dictionaryPosition) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ACP LZW dictionary token",
			);
		}
		const source = dictionary[dictionaryToken] ?? 0;
		const next = dictionary[dictionaryToken + 1] ?? 0;
		const count = Math.min(output.length - destination, next - source + 1);
		if (count < 0 || source < 0 || source >= destination) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ACP LZW dictionary range",
			);
		}
		for (let index = 0; index < count; index += 1) {
			output[destination] = output[source + index] ?? 0;
			destination += 1;
		}
	}
	return output;
}
