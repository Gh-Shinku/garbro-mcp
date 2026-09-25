// Format reference: GARbro "ArcFormats/Kaguya/ArcLINK.cs", classes `LinkOpener`, `LinkEntry`,
// `LinkArchive`, `LinkReader`, `Link4Reader`, `Link6Reader` and `BmrDecoder`, and the `UnpackLzss` of
// `ArcFormats/Kaguya/ArcLIN2.cs`, which this project already carries as `unpackLin2`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import { MsbBitReader } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	decodeCp932,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import { unpackLin2 } from "./lin2.js";

/** `LinkOpener.Signature`: `LINK`. */
const MARK = Buffer.from("LINK", "latin1");
const MARK_SIZE = MARK.length;
const VERSION_AT = 4;
const FIRST_VERSION = 3;
const LAST_VERSION = 6;
const DIGIT_ZERO = 0x30;
/** `LinkReader.GetDataOffset` and the overrides of the two readers of the newer versions. */
const DATA_OFFSET_V3 = 8;
const DATA_OFFSET_V4 = 0xa;
const DATA_OFFSET_V6_LENGTH_AT = 7;
/** A record holds its own size, its flags, seven skipped bytes and its name. */
const SIZE_SIZE = 4;
const FLAGS_SIZE = 2;
const SKIPPED_SIZE = 7;
const MIN_RECORD_SIZE = 0x10;
/** `flags & 3` says the entry may be packed and `flags & 4` that it is encrypted. */
const PACKED_FLAGS = 3;
const ENCRYPTED_FLAG = 4;
const MARK_SIZE_BYTES = 4;
const BMR_MARK = "BMR";
const BMR_STREAM_AT = 0x14;
/** The data of an entry whose stored places carry the letters `BM` is a Lin2 walk with a size in front. */
const BM_MARK = 0x4d42;
const BM_SIZE_AT = 0;
const BM_SIZE_BYTES = 4;
const BM_MARK_AT = 5;
const BM_HEAD_SIZE = 8;
/** The names of the older layouts. */
const OLD_COUNT_AT = 4;
const OLD_NAMES_SIZE_AT = 8;
const OLD_NAMES_AT = 12;
const OLD_NAMES_MAX = 0x100000;
const MAX_NAME_LENGTH = 0x400;
/** The head of a `BmrDecoder` walk. */
const BMR_STEP_AT = 3;
const BMR_FINAL_SIZE_AT = 4;
const BMR_KEY_AT = 8;
const BMR_UNPACKED_SIZE_AT = 12;
const BMR_HEAD_SIZE = BMR_STREAM_AT;
const BMR_ALPHABET = 0x100;
const BMR_NODE_COUNT = 0x100;
const BMR_FIRST_TOKEN = 0x100;
const BMR_TREE_SIZE = BMR_NODE_COUNT * 2;
const BYTE_MASK = 0xff;
const RUN_FLAG = 0x80;
const RUN_LOW_MASK = 0x7f;
const RUN_LOW_BIAS = 128;

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw invalidArchive("An archive of the engine of no places of the file");
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

/** A record of the index of a LINK archive, with the name already read. */
export interface LinkRecord {
	name: string;
	/** The place of the data of the entry in the file. */
	offset: number;
	/** The places of the file of the data as it stands stored. */
	size: number;
	/** The stored places carry the `BMR` mark, so they are a walk of their own. */
	packed: boolean;
	encrypted: boolean;
	unpackedSize: number;
}

export interface LinkLayout {
	version: number;
	entries: LinkRecord[];
}

/**
 * `LinkReader.ReadName`: the older layouts carry a byte of length, two skipped bytes and the name, which
 * the reference reads as a null terminated cp932 string inside a field of that length.
 */
function readOldName(
	data: Buffer,
	at: number,
): { name: string; at: number } | undefined {
	if (at >= data.length) return undefined;
	const length = data[at] ?? 0;
	const end = at + 1 + 2 + length;
	if (end > data.length) return undefined;
	return { name: decodeCStringField(data, at + 3, length), at: end };
}

/** `Link6Reader.ReadName`: the newer layout carries a word of length and a UTF-16 name. */
function readWideName(
	data: Buffer,
	at: number,
): { name: string; at: number } | undefined {
	if (at + 2 > data.length) return undefined;
	const length = data.readUInt16LE(at);
	if (length > MAX_NAME_LENGTH) return undefined;
	const end = at + 2 + length;
	if (end > data.length) return undefined;
	// The reference hands the letters of the field to `Encoding.Unicode` as they stand, so a name that
	// carries a null at its end keeps it; this port drops it, which is what a path wants.
	let name = data.toString("utf16le", at + 2, end);
	while (name.endsWith("\0")) name = name.slice(0, -1);
	return { name, at: end };
}

/** `LinkReader.ReadIndex`, shared by the readers of the three newer layouts. */
export function readLinkLayout(data: Buffer): LinkLayout {
	if (data.length < MARK_SIZE || !data.subarray(0, MARK_SIZE).equals(MARK)) {
		throw invalidArchive("Not a KaGuYa resource archive");
	}
	if (data.length <= VERSION_AT)
		throw invalidArchive("An archive of the engine of no places of the file");
	const version = (data[VERSION_AT] ?? 0) - DIGIT_ZERO;
	if (version < FIRST_VERSION || version > LAST_VERSION)
		return readOldLinkLayout(data);
	let at =
		LAST_VERSION === version
			? DATA_OFFSET_V3 + (data[DATA_OFFSET_V6_LENGTH_AT] ?? 0)
			: FIRST_VERSION === version
				? DATA_OFFSET_V3
				: DATA_OFFSET_V4;
	const wide = LAST_VERSION === version;
	const entries: LinkRecord[] = [];
	while (at + SIZE_SIZE < data.length) {
		const base = at;
		const size = data.readUInt32LE(at);
		at += SIZE_SIZE;
		if (0 === size) break;
		if (size < MIN_RECORD_SIZE) {
			throw invalidArchive("A record of the index of the engine");
		}
		if (at + FLAGS_SIZE + SKIPPED_SIZE > data.length) {
			throw invalidArchive("A record of the index of the engine");
		}
		const flags = data.readUInt16LE(at);
		at += FLAGS_SIZE;
		at += SKIPPED_SIZE;
		const named = wide ? readWideName(data, at) : readOldName(data, at);
		if (!named || 0 === named.name.length) {
			throw invalidArchive("The name of a record of the index of the engine");
		}
		at = named.at;
		const recordSize = size - (at - base);
		if (recordSize < 0 || at + recordSize > data.length) {
			throw invalidArchive("The places of the file of an entry of the engine");
		}
		const record: LinkRecord = {
			name: named.name,
			offset: at,
			size: recordSize,
			packed: false,
			encrypted: 0 !== (flags & ENCRYPTED_FLAG),
			unpackedSize: recordSize,
		};
		if (
			0 !== (flags & PACKED_FLAGS) &&
			at + MARK_SIZE_BYTES + 4 <= data.length
		) {
			// The reference reads four places for the mark and compares the three letters of it.
			if (data.toString("latin1", at, at + BMR_MARK.length) === BMR_MARK) {
				record.packed = true;
				record.unpackedSize = data.readUInt32LE(at + MARK_SIZE_BYTES);
			}
		}
		entries.push(record);
		at += recordSize;
	}
	return { version, entries };
}

/** `LinkOpener.ReadOldIndex`: the layouts below the third one keep their names and their places apart. */
export function readOldLinkLayout(data: Buffer): LinkLayout {
	if (data.length < OLD_NAMES_AT) {
		throw invalidArchive("An archive of the engine of no places of the file");
	}
	const count = data.readInt32LE(OLD_COUNT_AT);
	if (!isSaneCount(count))
		throw invalidArchive("The count of the entries of the index of the engine");
	if (data.length < OLD_NAMES_AT + 4) {
		throw invalidArchive("An archive of the engine of no places of the file");
	}
	const namesSize = data.readUInt32LE(OLD_NAMES_SIZE_AT);
	if (namesSize > OLD_NAMES_MAX || OLD_NAMES_AT + namesSize > data.length) {
		throw invalidArchive("The names of the index of the engine");
	}
	const names: string[] = [];
	let at = OLD_NAMES_AT;
	for (let i = 0; i < count; i += 1) {
		const end = data.indexOf(0, at);
		if (end < 0 || end > OLD_NAMES_AT + namesSize) {
			throw invalidArchive("The name of a record of the index of the engine");
		}
		names.push(decodeCp932(data.subarray(at, end)));
		at = end + 1;
	}
	const entries: LinkRecord[] = [];
	let place = OLD_NAMES_AT + namesSize;
	for (let i = 0; i < count; i += 1) {
		if (place + 8 > data.length) {
			throw invalidArchive("The places of the file of an entry of the engine");
		}
		const offset = data.readUInt32LE(place);
		const size = data.readUInt32LE(place + 4);
		place += 8;
		if (!checkPlacement(BigInt(offset), BigInt(size), BigInt(data.length))) {
			throw invalidArchive("The place of an entry of the engine");
		}
		entries.push({
			name: names[i] ?? "",
			offset,
			size,
			packed: false,
			encrypted: false,
			unpackedSize: size,
		});
	}
	return { version: FIRST_VERSION - 1, entries };
}

/** `BmrDecoder.CreateHuffmanTree`: a branch is one letter and a leaf its eight letters. */
function readBmrTree(
	bits: MsbBitReader,
	tree: Uint16Array,
	nextToken: () => number,
): number {
	const branch = bits.tryReadBits(1);
	if (1 === branch) {
		const token = nextToken();
		if (token - BMR_FIRST_TOKEN >= BMR_NODE_COUNT) {
			throw invalidArchive("The tree of the walk of the engine");
		}
		tree[(token - BMR_FIRST_TOKEN) * 2] = readBmrTree(bits, tree, nextToken);
		tree[(token - BMR_FIRST_TOKEN) * 2 + 1] = readBmrTree(
			bits,
			tree,
			nextToken,
		);
		return token;
	}
	if (-1 === branch) throw invalidArchive("The tree of the walk of the engine");
	const symbol = bits.tryReadBits(8);
	if (-1 === symbol) throw invalidArchive("The tree of the walk of the engine");
	return symbol;
}

/** `BmrDecoder.UndoMoveToFront`: every place names its colour through the dictionary in front of it. */
function undoBmrMoveToFront(output: Buffer): void {
	const dict = Buffer.alloc(BMR_ALPHABET, 0);
	for (let i = 0; i < BMR_ALPHABET; i += 1) dict[i] = i;
	for (let i = 0; i < output.length; i += 1) {
		const value = output[i] ?? 0;
		output[i] = dict[value] ?? 0;
		for (let j = value; j > 0; j -= 1) {
			dict[j] = dict[j - 1] ?? 0;
		}
		dict[0] = output[i] ?? 0;
	}
}

/** `BmrDecoder.Decode`: the places of the walk are sorted by their own colour and then read in a chain. */
export function decodeBmrPlaces(input: Buffer, key: number): Buffer {
	const frequencies = new Int32Array(BMR_ALPHABET);
	for (const value of input) frequencies[value] = (frequencies[value] ?? 0) + 1;
	for (let i = 1; i < BMR_ALPHABET; i += 1) {
		frequencies[i] = (frequencies[i] ?? 0) + (frequencies[i - 1] ?? 0);
	}
	const places = new Int32Array(input.length);
	for (let i = input.length - 1; i >= 0; i -= 1) {
		const value = input[i] ?? 0;
		const place = (frequencies[value] ?? 0) - 1;
		frequencies[value] = place;
		places[place] = i;
	}
	const output = Buffer.alloc(input.length, 0);
	let position = key;
	for (let i = 0; i < output.length; i += 1) {
		if (position < 0 || position >= places.length) {
			throw invalidArchive("The walk of the places of the engine");
		}
		position = places[position] ?? 0;
		output[i] = input[position] ?? 0;
	}
	return output;
}

/** `BmrDecoder.DecompressRLE`: runs of a colour, taken down the columns of the picture. */
export function decompressBmrRuns(
	input: Buffer,
	step: number,
	finalSize: number,
): Buffer {
	const result = Buffer.alloc(finalSize, 0);
	let source = 0;
	for (let i = 0; i < step; i += 1) {
		if (source >= input.length) break;
		let previous = input[source] ?? 0;
		source += 1;
		result[i] = previous;
		let destination = i + step;
		while (destination < result.length) {
			if (source >= input.length) return result;
			let value = input[source] ?? 0;
			source += 1;
			result[destination] = value;
			destination += step;
			if (value === previous) {
				if (source >= input.length) return result;
				let count = input[source] ?? 0;
				source += 1;
				if (0 !== (count & RUN_FLAG)) {
					if (source >= input.length) return result;
					count =
						(input[source] ?? 0) + ((count & RUN_LOW_MASK) << 8) + RUN_LOW_BIAS;
					source += 1;
				}
				while (count > 0 && destination < result.length) {
					result[destination] = value;
					destination += step;
					count -= 1;
				}
				if (destination < result.length) {
					if (source >= input.length) return result;
					value = input[source] ?? 0;
					source += 1;
					result[destination] = value;
					destination += step;
				}
			}
			previous = value;
		}
	}
	return result;
}

/** `BmrDecoder.Unpack`: the walk of a packed entry of the engine. */
export function unpackBmr(data: Buffer): Buffer {
	if (data.length < BMR_HEAD_SIZE) {
		throw invalidArchive("The walk of the engine of no places of the file");
	}
	const step = data[BMR_STEP_AT] ?? 0;
	const finalSize = data.readInt32LE(BMR_FINAL_SIZE_AT);
	const key = data.readInt32LE(BMR_KEY_AT);
	const unpackedSize = data.readInt32LE(BMR_UNPACKED_SIZE_AT);
	if (unpackedSize < 0 || finalSize < 0) {
		throw invalidArchive("The walk of the engine of no places of the file");
	}
	const output = Buffer.alloc(unpackedSize, 0);
	const bits = new MsbBitReader(data, BMR_STREAM_AT);
	const tree = new Uint16Array(BMR_TREE_SIZE);
	let token = BMR_FIRST_TOKEN;
	const root = readBmrTree(bits, tree, () => {
		const assigned = token;
		token += 1;
		return assigned;
	});
	let at = 0;
	while (at < output.length) {
		let symbol = root;
		while (symbol >= BMR_FIRST_TOKEN) {
			const bit = bits.tryReadBits(1);
			if (-1 === bit) {
				throw invalidArchive("The walk of the engine of no places of the file");
			}
			symbol = tree[(symbol - BMR_FIRST_TOKEN) * 2 + bit] ?? 0;
		}
		output[at] = symbol & BYTE_MASK;
		at += 1;
	}
	undoBmrMoveToFront(output);
	const places = decodeBmrPlaces(output, key);
	if (0 === step) return places;
	return decompressBmrRuns(places, step, finalSize);
}

export const kaguyaLinkDescriptor: FormatDescriptor = {
	id: "kaguya-link-archive",
	name: "KaGuYa script engine resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Kaguya/ArcLINK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kaguyaLinkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaguyaLinkDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(MARK_SIZE + 1)) return false;
		try {
			readLinkLayout(await readStored(source));
			return true;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const layout = readLinkLayout(data);
		const entries: FixedEntry[] = layout.entries.map((record, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset: BigInt(record.offset),
				size:
					0 !== record.unpackedSize
						? BigInt(record.unpackedSize)
						: BigInt(record.size),
				packedSize: BigInt(record.size),
				compressed: record.packed,
				encrypted: record.encrypted,
				metadata: {
					packed: record.packed,
					encrypted: record.encrypted,
					storedSize: record.size,
				},
			}),
		);
		return { entries, metadata: { version: layout.version } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (true === entry.metadata?.encrypted) {
			// `LinkReader.GetEncryption` reads the scheme of the game out of a `params.dat` beside the
			// archive, which ships outside this port.
			throw unsupported(
				"The walk of an entry of the engine of the scheme of the game of it",
			);
		}
		const stored = Number(entry.packedSize);
		if (!Number.isSafeInteger(stored) || stored < 0) {
			throw invalidArchive("The places of the file of the entry of the engine");
		}
		const read = await source.readAt(entry.offset, stored);
		const data = Buffer.isBuffer(read) ? read : Buffer.from(read as Uint8Array);
		if (true === entry.metadata?.packed)
			return Readable.from([unpackBmr(data)]);
		if (
			data.length >= BM_HEAD_SIZE &&
			data.readUInt16LE(BM_MARK_AT) === BM_MARK
		) {
			const unpackedSize = data.readUInt32LE(BM_SIZE_AT);
			return Readable.from([
				unpackLin2(data.subarray(BM_SIZE_BYTES), unpackedSize),
			]);
		}
		return Readable.from([data]);
	},
});
