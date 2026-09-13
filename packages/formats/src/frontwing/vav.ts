// Format reference: GARbro ArcFormats/FrontWing/ArcVAV.cs, classes `PakOpener`, `VavEntry` and `VavArchive`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("vav", "latin1");
const VERSION_FIELD = 4;
const COUNT_FIELD = 8;
const INDEX_OFFSET_FIELD = 0xc;
const KNOWN_VERSIONS = [100, 200, 201];
const OLD_NAME_SIZE = 0x10;
const NEW_NAME_SIZE = 0x20;
/** A record ends with the stored size, the unpacked size, the offset and the compression flags. */
const RECORD_FOOTER_SIZE = 0x18;
const SIZE_FIELD = 0;
const UNPACKED_SIZE_FIELD = 4;
const ENTRY_OFFSET_FIELD = 8;
const COMPRESSION_FIELD = 0xc;
const COMPRESSION_HUFFMAN = 0x80;
const COMPRESSION_RLE = 0x10;
/** Archives named `voice` hold audio. */
const VOICE_NAME = "voice";
/** The huffman tree of this engine is built from 256 keyed weights. */
const WEIGHT_COUNT = 0x100;
const WEIGHT_KEY = 0x55;
const TREE_SIZE = 0x201;
const ROOT_WEIGHT = 1;
const END_SYMBOL = 0x100;
const NO_WEIGHT = 0x10000;
/** The rle variant packs a seven bit count and a repeat flag. */
const RLE_COUNT_MASK = 0x7f;
const RLE_REPEAT_FLAG = 0x80;
const XOR_KEY = 0x55;

interface VavEntry {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
	compression: number;
}

async function readRange(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	if (offset < 0 || length < 0) return undefined;
	if (BigInt(offset) + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(BigInt(offset), length));
}

/**
 * `PakOpener.UnpackHuffman`: 256 keyed weights feed a tree that merges the two smallest nodes until only one
 * is left, and the walk takes a bit per node, most significant bit first. Symbol 0x100 ends the stream.
 */
export function inflateVavHuffman(input: Buffer): Buffer {
	if (input.length < WEIGHT_COUNT)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Truncated frontwing huffman tree",
		);
	const weights = new Int32Array(TREE_SIZE);
	const left = new Uint16Array(TREE_SIZE);
	const right = new Uint16Array(TREE_SIZE);
	for (let index = 0; index < WEIGHT_COUNT; index += 1)
		weights[index] = (input[index] ?? 0) ^ WEIGHT_KEY;
	weights[END_SYMBOL] = ROOT_WEIGHT;
	let root = END_SYMBOL;
	for (;;) {
		let lmin = NO_WEIGHT;
		let rmin = NO_WEIGHT;
		let lhs = TREE_SIZE;
		let rhs = TREE_SIZE;
		for (let index = 0; index < TREE_SIZE; index += 1) {
			const weight = weights[index] ?? 0;
			if (weight !== 0 && weight < rmin) {
				rmin = lmin;
				rhs = lhs;
				lmin = weight;
				lhs = index;
			}
		}
		if (rmin === NO_WEIGHT || lmin === NO_WEIGHT || lmin === 0 || rmin === 0)
			break;
		root += 1;
		if (root >= TREE_SIZE)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid frontwing huffman tree",
			);
		left[root] = lhs;
		right[root] = rhs;
		weights[root] = rmin + lmin;
		weights[lhs] = 0;
		weights[rhs] = 0;
	}
	const bits = new MsbBitReader(input, WEIGHT_COUNT);
	const output: number[] = [];
	for (;;) {
		let symbol = root;
		while (symbol > END_SYMBOL) {
			const bit = bits.tryReadBits(1);
			if (bit === -1) return Buffer.from(output);
			symbol = bit !== 0 ? (right[symbol] ?? 0) : (left[symbol] ?? 0);
		}
		if (symbol === END_SYMBOL) return Buffer.from(output);
		output.push(symbol);
	}
}

/** `PakOpener.UnpackRle`: a seven bit count either repeats the next byte or copies that many literals. */
export function inflateVavRle(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(Math.max(outputLength, 0));
	let source = 0;
	let target = 0;
	while (target < output.length) {
		if (source >= input.length) break;
		const control = input[source] ?? 0;
		source += 1;
		const count = Math.min(control & RLE_COUNT_MASK, output.length - target);
		if (count === 0) break;
		if ((control & RLE_REPEAT_FLAG) !== 0) {
			if (source >= input.length) break;
			output.fill(input[source] ?? 0, target, target + count);
			source += 1;
		} else {
			const available = Math.min(count, input.length - source);
			if (available <= 0) break;
			input.copy(output, target, source, source + available);
			source += available;
			target += available;
			continue;
		}
		target += count;
	}
	return output.subarray(0, target);
}

/**
 * `PakOpener.DecryptEntry`: with a stride the payload is a difference chain against its own decoded bytes,
 * without one the whole payload is keyed, except in the oldest version where only the first byte is.
 */
export function decryptVavEntry(
	input: Buffer,
	stride: number,
	oldVersion: boolean,
): Buffer {
	const output = Buffer.from(input);
	if (stride > 0) {
		for (let position = stride; position < output.length; position += 1)
			output[position] =
				(output[position] ?? 0) ^ (output[position - stride] ?? 0);
		return output;
	}
	const length = oldVersion ? Math.min(1, output.length) : output.length;
	for (let position = 0; position < length; position += 1)
		output[position] = (output[position] ?? 0) ^ XOR_KEY;
	return output;
}

/**
 * GARbro `PakOpener.TryOpen`. The index sits at an offset from the header and holds one record per entry with
 * a fixed name field whose size depends on the version.
 */
async function readVavIndex(
	source: ByteSource,
): Promise<{ version: number; entries: VavEntry[] } | undefined> {
	const header = await readRange(source, 0, INDEX_OFFSET_FIELD + 4);
	if (!header?.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const version = header.readInt32LE(VERSION_FIELD);
	if (!KNOWN_VERSIONS.includes(version)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = header.readUInt32LE(INDEX_OFFSET_FIELD);
	const nameSize = version < 200 ? OLD_NAME_SIZE : NEW_NAME_SIZE;
	const recordSize = nameSize + RECORD_FOOTER_SIZE;
	const index = await readRange(source, indexOffset, recordSize * count);
	if (!index) return undefined;
	const entries: VavEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * recordSize;
		const nameField = index.subarray(position, position + nameSize);
		const end = nameField.indexOf(0);
		const name = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		const footer = position + nameSize;
		const size = BigInt(index.readUInt32LE(footer + SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(footer + ENTRY_OFFSET_FIELD));
		if (offset + size > source.size) return undefined;
		entries.push({
			name,
			offset,
			size,
			unpackedSize: BigInt(index.readUInt32LE(footer + UNPACKED_SIZE_FIELD)),
			compression: index.readInt32LE(footer + COMPRESSION_FIELD),
		});
	}
	if (entries.length === 0) return undefined;
	return { version, entries };
}

function toFixedEntries(
	version: number,
	entries: readonly VavEntry[],
	voice: boolean,
): FixedEntry[] {
	return entries.map((entry, id) => {
		const compressed =
			(entry.compression & (COMPRESSION_HUFFMAN | COMPRESSION_RLE)) !== 0;
		const size = entry.unpackedSize > 0n ? entry.unpackedSize : entry.size;
		const fixed = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size,
			packedSize: entry.size,
			compressed,
			encrypted: true,
			metadata: {
				type: voice ? "audio" : "data",
				compression: entry.compression,
				version,
			},
		});
		// A compressed entry without a declared size only reveals its length while decoding.
		return compressed && entry.unpackedSize === 0n
			? { ...fixed, sizeKnown: false }
			: fixed;
	});
}

export const vavDescriptor: FormatDescriptor = {
	id: "frontwing-vav",
	name: "FrontWing ADV System resource archive",
	extensions: [],
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
			source: "ArcFormats/FrontWing/ArcVAV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vavFormat = defineFixedArchive({
	descriptor: vavDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readVavIndex(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath?: string) {
		const index = await readVavIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FrontWing VAV layout");
		const path = sourcePath ?? "";
		const voice = basename(path, extname(path)).toLowerCase() === VOICE_NAME;
		return {
			entries: toFixedEntries(index.version, index.entries, voice),
			metadata: { entryCount: index.entries.length, version: index.version },
		};
	},
	/** `PakOpener.OpenEntry` unpacks huffman, then rle, and decrypts the result. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		const compression = Number(entry.metadata?.compression ?? 0);
		const version = Number(entry.metadata?.version ?? 0);
		const unpackedSize = Number(entry.size);
		try {
			let data: Buffer = stored;
			if ((compression & COMPRESSION_HUFFMAN) !== 0)
				data = inflateVavHuffman(data);
			if ((compression & COMPRESSION_RLE) !== 0)
				data = inflateVavRle(data, unpackedSize);
			data = decryptVavEntry(data, compression & 0x0f, version < 200);
			return Readable.from([data]);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FrontWing payload");
		}
	},
});
