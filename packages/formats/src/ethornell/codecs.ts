import { GarbroError } from "@garbro-mcp/core";

class MsbBitReader {
	readonly #buffer: Buffer;
	#byteOffset: number;
	#bitOffset = 0;

	constructor(buffer: Buffer, offset: number) {
		this.#buffer = buffer;
		this.#byteOffset = offset;
	}

	readBits(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			if (this.#byteOffset >= this.#buffer.length) {
				throw new GarbroError("INVALID_ARCHIVE", "BGI bitstream is truncated");
			}
			value =
				(value << 1) |
				(((this.#buffer[this.#byteOffset] ?? 0) >> (7 - this.#bitOffset)) & 1);
			this.#bitOffset += 1;
			if (this.#bitOffset === 8) {
				this.#bitOffset = 0;
				this.#byteOffset += 1;
			}
		}
		return value;
	}
}

function rotateLeft8(value: number, shift: number): number {
	if (shift === 0) return value & 0xff;
	return ((value << shift) | (value >>> (8 - shift))) & 0xff;
}

function rotateRight8(value: number, shift: number): number {
	if (shift === 0) return value & 0xff;
	return ((value >>> shift) | (value << (8 - shift))) & 0xff;
}

interface BseGenerator {
	nextKey(): number;
}

class BseGenerator100 implements BseGenerator {
	#key: number;

	constructor(key: number) {
		this.#key = key | 0;
	}

	nextKey(): number {
		const value =
			((Math.imul(this.#key, 257) >> 8) + Math.imul(this.#key, 97) + 23) ^
			0xa6cd9b75;
		const rotated = ((value >>> 16) | (value << 16)) >>> 0;
		this.#key = rotated | 0;
		return this.#key;
	}
}

class BseGenerator101 implements BseGenerator {
	#key: number;

	constructor(key: number) {
		this.#key = key | 0;
	}

	nextKey(): number {
		const value =
			((Math.imul(this.#key, 127) >> 7) + Math.imul(this.#key, 83) + 53) ^
			0xb97a7e5c;
		const rotated = ((value >>> 16) | (value << 16)) >>> 0;
		this.#key = rotated | 0;
		return this.#key;
	}
}

function createBseGenerator(version: number, key: number): BseGenerator {
	if (version === 0x100) return new BseGenerator100(key);
	if (version === 0x101) return new BseGenerator101(key);
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		`Unsupported BSE version: 0x${version.toString(16)}`,
	);
}

export function decryptBseHeader(
	input: Uint8Array,
	version: number,
	key: number,
): Buffer {
	if (input.length !== 0x40) {
		throw new GarbroError("INVALID_ARCHIVE", "BSE header must be 64 bytes");
	}
	const data = Buffer.from(input);
	const generator = createBseGenerator(version, key);
	const decoded = new Uint8Array(0x40);
	for (let index = 0; index < decoded.length; index += 1) {
		let destination = generator.nextKey() & 0x3f;
		while (decoded[destination] !== 0) destination = (destination + 1) & 0x3f;
		const shift = generator.nextKey() & 7;
		const rightShift = (generator.nextKey() & 1) === 0;
		const symbol = ((data[destination] ?? 0) - generator.nextKey()) & 0xff;
		data[destination] = rightShift
			? rotateRight8(symbol, shift)
			: rotateLeft8(symbol, shift);
		decoded[destination] = 1;
	}
	return data;
}

function updateDscKey(state: { key: number; magic: number }): number {
	const lowProduct = 20021 * (state.key & 0xffff);
	let high = (state.magic | (state.key >>> 16)) >>> 0;
	high = (Math.imul(high, 20021) + Math.imul(state.key, 346)) >>> 0;
	high = (high + (lowProduct >>> 16)) & 0xffff;
	state.key = ((high << 16) + (lowProduct & 0xffff) + 1) >>> 0;
	return high & 0xff;
}

interface HuffmanCode {
	depth: number;
	code: bigint;
	symbol: number;
}

function buildCanonicalCodes(depths: number[]): HuffmanCode[] {
	const symbols = depths
		.map((depth, symbol) => ({ depth, symbol }))
		.filter(({ depth }) => depth !== 0)
		.sort(
			(left, right) => left.depth - right.depth || left.symbol - right.symbol,
		);
	if (symbols.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "DSC Huffman table is empty");
	}
	const codes: HuffmanCode[] = [];
	let code = 0n;
	let previousDepth = 0;
	for (const symbol of symbols) {
		if (symbol.depth < previousDepth) {
			throw new GarbroError("INVALID_ARCHIVE", "DSC Huffman depth is invalid");
		}
		code <<= BigInt(symbol.depth - previousDepth);
		if (code >= 1n << BigInt(symbol.depth)) {
			throw new GarbroError("INVALID_ARCHIVE", "DSC Huffman table is overfull");
		}
		codes.push({ ...symbol, code });
		code += 1n;
		previousDepth = symbol.depth;
	}
	return codes;
}

function readHuffmanSymbol(bits: MsbBitReader, codes: HuffmanCode[]): number {
	let value = 0n;
	const maximumDepth = codes[codes.length - 1]?.depth ?? 0;
	for (let depth = 1; depth <= maximumDepth; depth += 1) {
		value = value * 2n + BigInt(bits.readBits(1));
		const match = codes.find(
			(candidate) => candidate.depth === depth && candidate.code === value,
		);
		if (match) return match.symbol;
	}
	throw new GarbroError("INVALID_ARCHIVE", "Invalid DSC Huffman code");
}

export function decompressDsc(input: Uint8Array): Buffer {
	const source = Buffer.from(input);
	if (
		source.length <= 0x220 ||
		!source.subarray(0, 16).equals(Buffer.from("DSC FORMAT 1.00\0", "binary"))
	) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid DSC header");
	}
	const outputSize = source.readInt32LE(0x14);
	const decodeCount = source.readUInt32LE(0x18);
	if (outputSize < 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid DSC output size");
	}
	const state = {
		key: source.readUInt32LE(0x10),
		magic: (source.readUInt16LE(0) << 16) >>> 0,
	};
	const depths: number[] = [];
	for (let index = 0; index < 512; index += 1) {
		depths.push(((source[0x20 + index] ?? 0) - updateDscKey(state)) & 0xff);
	}
	const codes = buildCanonicalCodes(depths);
	const bits = new MsbBitReader(source, 0x220);
	const output = Buffer.alloc(outputSize);
	let destination = 0;
	for (let index = 0; index < decodeCount; index += 1) {
		const symbol = readHuffmanSymbol(bits, codes);
		if (symbol < 256) {
			if (destination >= output.length) {
				throw new GarbroError("INVALID_ARCHIVE", "DSC output exceeds its size");
			}
			output[destination++] = symbol;
			continue;
		}
		const offset = bits.readBits(12) + 2;
		const count = (symbol & 0xff) + 2;
		if (offset > destination || count > output.length - destination) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DSC back-reference");
		}
		for (let copied = 0; copied < count; copied += 1) {
			output[destination] = output[destination - offset] ?? 0;
			destination += 1;
		}
	}
	return output;
}
