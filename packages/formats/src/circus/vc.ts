// Format reference: GARBro ArcFormats/Circus/ArcValkyrieComplex.cs, classes `VcPakOpener`, `VcPakFile`
// and `ReverseBitStream` from ArcFormats/BitStream.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "pak";
/** The head spells the format's own name in shift-jis, and its last two characters pick the edition. */
const TRIAL_SIGNATURE = Buffer.from([
	0x82, 0x76, 0x82, 0x62, 0x91, 0xcc, 0x91, 0xcc, 0x94, 0xc5,
]);
const RETAIL_SIGNATURE = Buffer.from([
	0x82, 0x76, 0x82, 0x62, 0x90, 0xbb, 0x95, 0x69, 0x94, 0xc5,
]);
const TRIAL_INDEX_KEY = 0x38;
const RETAIL_INDEX_KEY = 0x58;
const TRIAL_DATA_KEY = 0x25;
const RETAIL_DATA_KEY = 0x24;
const COUNT_OFFSET = 0x18;
const INDEX_SIZE_OFFSET = 0x1c;
const INDEX_OFFSET = 0x20;
/** A record is a name length, then the data offset and size. */
const RECORD_SIZE = 0x10;
const NAME_LENGTH_FIELD = 0;
const OFFSET_FIELD = 4;
const SIZE_FIELD = 8;
/** Names trail the records and are separated by a null byte. */
const RECORD_START = 4;
const NAME_SEPARATOR = 1;

/** The `.cps` payloads announce their output length through a masked word in the first four bytes. */
const CPS_SIZE_XOR = 0x0a415fcf;
const CPS_SIZE_MASK = 0x0fffffff;
const CPS_TYPE_SHIFT = 4;
const CPS_TYPE_LIMIT = 3;
const CPS_DATA_OFFSET = 4;
/** The payload swap only applies once a stream is long enough to hold its two positions. */
const CPS_SWAP_MINIMUM = 0x308;
const CPS_SWAP_STEP = 0x200;
const CPS_SWAP_KEY = 0xff;
const CPS_SWAP_TAIL = 8;
const CPS_SWAP_FIRST_OFFSET = 2;
const CPS_V2_HEAD = 36;
const CPS_V2_STREAM_OFFSET = 38;
const CPS_V2_TABLE_OFFSET = 4;
const CPS_V2_UNIT = 2;
const CPS_V2_MAX_PAIR_INDEX = 30;
const CPS_V3_LITERAL_SIZE = 128;
const CPS_V3_OFFSET_BITS = 7;
const CPS_V3_COUNT_BITS = 4;
const CPS_V3_COUNT_BIAS = 2;
/** The decrement applied to script payloads. */
const SCRIPT_EXTENSION = "cs";
const IMAGE_EXTENSION = "cps";

export const vcPakDescriptor: FormatDescriptor = {
	id: "circus-vc-pak",
	name: "Valkyrie Complex resource archive",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Circus/ArcValkyrieComplex.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro's `ReverseBitStream`. Unlike the more common reader in this project it fills bits from the low end of
 * its accumulator, so the first bit of a byte is its least significant one.
 */
export class LsbBitReader {
	readonly #input: Buffer;
	#position = 0;
	#bits = 0;
	#cached = 0;

	constructor(input: Buffer, offset = 0) {
		this.#input = input;
		this.#position = offset;
	}

	/** Returns `-1` once the input runs out, the same signal the reference's reader uses. */
	read(count: number): number {
		while (this.#cached < count) {
			const byte = this.#input[this.#position];
			if (byte === undefined) return -1;
			this.#position += 1;
			this.#bits |= byte << this.#cached;
			this.#cached += 8;
		}
		const value = this.#bits & ((1 << count) - 1);
		this.#bits >>>= count;
		this.#cached -= count;
		return value;
	}
}

/**
 * GARBro `DecryptCps`. Two position pairs are swapped, with the first byte of the payload adjusted first; both
 * positions are derived from the payload length, which is why the swap only applies to streams of at least 0x308
 * bytes.
 */
function decryptCps(input: Buffer): Buffer {
	const output = Buffer.from(input);
	const length = output.length;
	if (length < CPS_SWAP_MINIMUM) return output;
	output[CPS_DATA_OFFSET] =
		(output[CPS_DATA_OFFSET] ?? 0) ^ (output[length - 1] ?? 0);
	const tail = length - CPS_SWAP_TAIL;
	const swapped: [number, number][] = [
		[
			CPS_SWAP_TAIL + tail - CPS_SWAP_KEY,
			CPS_SWAP_TAIL + Math.trunc(tail / CPS_SWAP_STEP) + CPS_SWAP_KEY,
		],
		[
			CPS_SWAP_TAIL +
				CPS_SWAP_KEY +
				CPS_SWAP_FIRST_OFFSET * Math.trunc(tail / CPS_SWAP_STEP),
			CPS_SWAP_TAIL + tail - CPS_SWAP_FIRST_OFFSET * CPS_SWAP_KEY,
		],
	];
	for (const [left, right] of swapped) {
		if (left < 0 || right < 0 || left >= length || right >= length) continue;
		const value = output[left] ?? 0;
		output[left] = output[right] ?? 0;
		output[right] = value;
	}
	return output;
}

/**
 * GARBro `UnpackV1`. Four bits give a count, then one bit chooses between reading that many more bytes plus one
 * literally and repeating a single byte that many times — so a count of zero emits nothing at all in the repeat
 * case.
 */
function unpackV1(input: Buffer, output: Buffer): void {
	const bits = new LsbBitReader(input, CPS_DATA_OFFSET);
	let destination = 0;
	while (destination < output.length) {
		const count = bits.read(4);
		if (count < 0) return;
		if (bits.read(1) !== 0) {
			for (let index = 0; index <= count; index += 1) {
				const value = bits.read(8);
				if (value < 0 || destination >= output.length) return;
				output[destination] = value;
				destination += 1;
			}
		} else {
			const value = bits.read(8);
			if (value < 0) return;
			for (
				let index = 0;
				index < count && destination < output.length;
				index += 1
			) {
				output[destination] = value;
				destination += 1;
			}
		}
	}
}

/**
 * GARBro `UnpackV2`. The payload's last output byte is seeded from its byte 36, and the stream begins at 38.
 * Each step fills two bytes: one bit chooses two literal bytes, which the reference writes in reverse order, or
 * a run of zero bits selects one of fifteen two-byte pairs from a table at offset 4.
 */
function unpackV2(input: Buffer, output: Buffer): void {
	if (output.length > 0) output[output.length - 1] = input[CPS_V2_HEAD] ?? 0;
	const bits = new LsbBitReader(input, CPS_V2_STREAM_OFFSET);
	for (
		let destination = 0;
		destination < output.length;
		destination += CPS_V2_UNIT
	) {
		if (bits.read(1) !== 0) {
			const high = bits.read(8);
			const low = bits.read(8);
			if (high < 0 || low < 0) return;
			if (destination + 1 < output.length) output[destination + 1] = high;
			output[destination] = low;
			continue;
		}
		let pair = 0;
		while (pair < CPS_V2_MAX_PAIR_INDEX && bits.read(1) === 0)
			pair += CPS_V2_UNIT;
		output[destination] = input[CPS_V2_TABLE_OFFSET + pair] ?? 0;
		if (destination + 1 < output.length) {
			output[destination + 1] = input[CPS_V2_TABLE_OFFSET + pair + 1] ?? 0;
		}
	}
}

/**
 * GARBro `UnpackV3`. A stream of up to 128 bytes is stored whole behind the header; anything longer keeps its
 * first 128 bytes literal and decodes the rest from offset 132, where one bit chooses between a seven-bit
 * distance plus one and a four-bit count plus two, and an overlapping copy.
 */
function unpackV3(input: Buffer, output: Buffer): void {
	if (output.length <= CPS_V3_LITERAL_SIZE) {
		input.copy(output, 0, CPS_DATA_OFFSET, CPS_DATA_OFFSET + output.length);
		return;
	}
	input.copy(output, 0, CPS_DATA_OFFSET, CPS_DATA_OFFSET + CPS_V3_LITERAL_SIZE);
	let destination = CPS_V3_LITERAL_SIZE;
	const bits = new LsbBitReader(input, CPS_DATA_OFFSET + CPS_V3_LITERAL_SIZE);
	while (destination < output.length) {
		if (bits.read(1) !== 0) {
			const offset = bits.read(CPS_V3_OFFSET_BITS);
			const count = bits.read(CPS_V3_COUNT_BITS);
			if (offset < 0 || count < 0) return;
			const distance = offset + 1;
			let length = count + CPS_V3_COUNT_BIAS;
			while (length > 0 && destination < output.length) {
				output[destination] = output[destination - distance] ?? 0;
				destination += 1;
				length -= 1;
			}
		} else {
			const value = bits.read(8);
			if (value < 0) return;
			output[destination] = value;
			destination += 1;
		}
	}
}

/**
 * GARBro `UnpackCps`. The output length is a word in the first four bytes with a fixed mask applied, and the top
 * nibble of the fourth byte selects the layout: zero copies the payload behind its header, and one to three use
 * the decoders above. A type above three leaves the payload untouched, which the reference returns as is, and the
 * payload swap runs before any decoding.
 */
export function unpackCps(input: Buffer): Buffer {
	if (input.length < CPS_DATA_OFFSET) return input;
	const unpackedSize =
		((input.readUInt32LE(0) ^ CPS_SIZE_XOR) >>> 0) & CPS_SIZE_MASK;
	const type = (input[3] ?? 0) >> CPS_TYPE_SHIFT;
	if (type > CPS_TYPE_LIMIT) return input;
	const decrypted = decryptCps(input);
	const output = Buffer.alloc(unpackedSize);
	if (type === 0) {
		decrypted.copy(output, 0, CPS_DATA_OFFSET, CPS_DATA_OFFSET + unpackedSize);
	} else if (type === 1) {
		unpackV1(decrypted, output);
	} else if (type === 2) {
		unpackV2(decrypted, output);
	} else {
		unpackV3(decrypted, output);
	}
	return output;
}

/**
 * GARBro `VcPakOpener.TryOpen`. The head spells the format's own name in shift-jis, and its last two characters
 * pick the edition, which in turn picks the key byte the index and payloads are exclusive-ored with. The entry
 * count and index size at 0x18 and 0x1C are masked with that same byte replicated across all four of their bytes,
 * and every byte of the index is then exclusive-ored too.
 *
 * Records start four bytes into the decoded index and are sixteen bytes wide, holding a name length, the data
 * offset and the size, while the names themselves trail the whole record list separated by null bytes. An entry
 * whose name ends in `.cps` is classified as an image.
 *
 * Extraction applies the payload key byte, then a decrement to every byte of a `.cs` payload or a `.cps`
 * expansion, and the decoders are exported for their own tests.
 */
async function readVcIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; key: number } | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const signature = header.subarray(0, TRIAL_SIGNATURE.length);
	const trial = signature.equals(TRIAL_SIGNATURE);
	if (!trial && !signature.equals(RETAIL_SIGNATURE)) return undefined;
	const indexKey = trial ? TRIAL_INDEX_KEY : RETAIL_INDEX_KEY;
	const wordKey = ((indexKey << 8) | indexKey) >>> 0;
	const mask = (wordKey | (wordKey << 16)) >>> 0;
	const count = (header.readUInt32LE(COUNT_OFFSET) ^ mask) >>> 0;
	if (!isSaneCount(count)) return undefined;
	const indexSize = (header.readUInt32LE(INDEX_SIZE_OFFSET) ^ mask) >>> 0;
	if (BigInt(indexSize) >= source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	for (let position = 0; position < index.length; position += 1) {
		index[position] = (index[position] ?? 0) ^ indexKey;
	}

	const entries: FixedEntry[] = [];
	let record = RECORD_START;
	let names = count * RECORD_SIZE;
	for (let id = 0; id < count; id += 1) {
		if (record + RECORD_SIZE > index.length) return undefined;
		const nameLength = index.readInt32LE(record + NAME_LENGTH_FIELD);
		if (nameLength <= 0 || names + nameLength > index.length) return undefined;
		const name = decodeCp932(index.subarray(names, names + nameLength));
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
				...(sourceExtension(name) === IMAGE_EXTENSION
					? { metadata: { inferredType: "image" } }
					: {}),
			}),
		);
		record += RECORD_SIZE;
		names += nameLength + NAME_SEPARATOR;
	}
	return { entries, key: trial ? TRIAL_DATA_KEY : RETAIL_DATA_KEY };
}

/** GARBro `VcPakOpener.OpenEntry`: the payload key, then a script decrement or a `.cps` expansion. */
async function openVcEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const key = typeof entry.metadata?.key === "number" ? entry.metadata.key : 0;
	const stored = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < stored.length; position += 1) {
		stored[position] = (stored[position] ?? 0) ^ key;
	}
	const extension = sourceExtension(entry.path);
	if (extension === SCRIPT_EXTENSION) {
		for (let position = 0; position < stored.length; position += 1) {
			stored[position] = ((stored[position] ?? 0) - 1) & 0xff;
		}
		return Readable.from([stored]);
	}
	if (extension === IMAGE_EXTENSION) {
		return Readable.from([unpackCps(stored)]);
	}
	return Readable.from([stored]);
}

export const vcPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vcPakDescriptor,
	detection: {
		signatures: [{ bytes: TRIAL_SIGNATURE }, { bytes: RETAIL_SIGNATURE }],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readVcIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const parsed = await readVcIndex(source, sourcePath);
		if (!parsed)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Valkyrie Complex layout",
			);
		for (const entry of parsed.entries) {
			entry.metadata = { ...entry.metadata, key: parsed.key };
			// A `.cps` payload expands on extraction, so its stored span is not the extracted length.
			if (sourceExtension(entry.path) === IMAGE_EXTENSION)
				entry.sizeKnown = false;
		}
		return {
			entries: parsed.entries,
			metadata: { entryCount: parsed.entries.length, key: parsed.key },
		};
	},
	openEntry: openVcEntry,
});

// GARbro `VcPacOpener`: a plain index of fixed size name records. The head of the file is a version
// word, which GARbro declares as the format signature but never verifies itself.
const PAC_SIGNATURE = Buffer.from([1, 0, 0, 0]);
const PAC_COUNT_OFFSET = 4;
const PAC_BASE_OFFSET = 8;
const PAC_FILE_SIZE_OFFSET = 0xc;
const PAC_INDEX_OFFSET = 0x20;
const PAC_NAME_SIZE = 0x20;
const PAC_RECORD_SIZE = 0x38;
const PAC_FIELD_OFFSET = 0x20;

export const circusVcPacDescriptor: FormatDescriptor = {
	id: "circus-vc-pac",
	name: "Valkyrie Complex resource archive",
	extensions: ["pac"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Circus/ArcValkyrieComplex.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `VcPacOpener.TryOpen`: a fixed record per entry, with offsets shifted by a base offset. */
async function readVcPacIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(PAC_INDEX_OFFSET)) return undefined;
	const head = Buffer.from(await source.readAt(0n, PAC_INDEX_OFFSET));
	const count = head.readInt32LE(PAC_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = head.readUInt32LE(PAC_BASE_OFFSET);
	const fileSize = head.readUInt32LE(PAC_FILE_SIZE_OFFSET);
	if (BigInt(baseOffset) >= source.size || BigInt(fileSize) !== source.size)
		return undefined;
	const indexSize = count * PAC_RECORD_SIZE;
	if (BigInt(PAC_INDEX_OFFSET) + BigInt(indexSize) > source.size)
		return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(PAC_INDEX_OFFSET), indexSize),
	);
	const entries: FixedEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * PAC_RECORD_SIZE;
		const name = decodeCStringField(index, position, PAC_NAME_SIZE);
		const size = index.readUInt32LE(position + PAC_FIELD_OFFSET);
		const offset =
			BigInt(index.readUInt32LE(position + PAC_FIELD_OFFSET + 4)) +
			BigInt(baseOffset);
		if (!checkPlacement(offset, BigInt(size), source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: i,
				...normalizeEntryPath(name),
				offset,
				size: BigInt(size),
			}),
		);
	}
	return entries;
}

export const circusVcPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: circusVcPacDescriptor,
	detection: { signatures: [{ bytes: PAC_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readVcPacIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readVcPacIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Valkyrie Complex layout",
			);
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
});
