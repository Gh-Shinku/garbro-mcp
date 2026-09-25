// Format reference: GARBro "ArcFormats/Moonhir/ArcFPK.cs", class `FpkOpener` with its `FpkEntry` and
// `FpkArchive` beside it. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { copyOverlapped } from "../shared/copy.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The word the archive opens with, and the mark of the one version of it the reference reads. */
const SIGNATURE = Buffer.from("FPK", "latin1");
const MARK = Buffer.from("0100", "latin1");
const MARK_FIELD = 4;
/** The head names where the index begins and how many entries stand in it. */
const INDEX_FIELD = 8;
const COUNT_FIELD = 0x0c;
/** Every record of the index is twenty four bytes: a word that says whether it is keyed, its place, its
 * length and a name of twelve. */
const RECORD_SIZE = 0x18;
const KEYED_FIELD = 0;
const PLACE_FIELD = 4;
const SIZE_FIELD = 8;
const NAME_FIELD = 0x0c;
const NAME_LENGTH = 12;
/** The names the reference types, and the prefix of an archive whose pictures it leaves untyped. */
const FBX_EXTENSION = "fbx";
const SCRIPT_PREFIX = "scr";
const IMAGE_TYPE = "image";
/** The only ready made key the reference carries. */
const KNOWN_KEYS = [0];
/** A picture of this engine opens with its own word, and says where its packed bytes begin in its head. */
const FBX_MARK = Buffer.from("FBX\x01", "latin1");
const FBX_HEADER_SIZE = 0x10;
const FBX_UNPACKED_FIELD = 0x0c;
const FBX_DATA_FIELD = 7;
/** The longest run a walk of this engine may name, and the most a picture of it may unfold to. */
const RUN_LIMIT = 0x100000;
const PICTURE_LIMIT = 0x10000000;

export interface FpkEntry {
	name: string;
	offset: number;
	size: number;
	keyed: boolean;
	type: string | undefined;
}

export interface FpkIndex {
	entries: FpkEntry[];
	/** The key the archive is read with, or nothing when its entries are not keyed at all. */
	key: number | undefined;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/**
 * `FpkOpener.FindKey`: the two words that stand behind the end of an entry tell the reference whether a key
 * fits, by asking the arithmetic of the cipher to name the length of the entry itself. The key that answers
 * with the length of the entry is the one the archive is read with.
 */
export function findFpkKey(
	data: Buffer,
	offset: number,
	size: number,
): number | undefined {
	if (size < 8) return undefined;
	const tail = offset + size - 8;
	if (tail + 8 > data.length) return undefined;
	const t0 = data.readUInt32LE(tail);
	const t1 = data.readUInt32LE(tail + 4);
	for (const key of KNOWN_KEYS) {
		const first = (key + size - 4) >>> 0;
		const second =
			(((key - (((t1 - first) >>> 0) ^ key)) >>> 0) >>> 7) ^
			(((first + key) << 7) >>> 0);
		const inner = ((t0 - ((first - 3) >>> 0)) >>> 0) ^ second;
		const length = ((((inner + 3) >>> 0) & 0xfffffffc) + 8) >>> 0;
		if (length === size) return key;
	}
	return undefined;
}

/**
 * `FpkOpener.Decrypt`: the words of an entry are walked from its **last** one back to its first, every word
 * losing a place and then meeting a key of its own that walks on with the word just written. A walk shorter
 * than the eight bytes the reference reads a length from is left alone.
 */
export function decryptFpk(words: Uint32Array, key: number): void {
	if (words.length < 2) return;
	let first = (key + words.length * 4 - 4) >>> 0;
	let second = key >>> 0;
	for (let at = words.length - 1; at >= 0; at -= 1) {
		const word = (((words[at] ?? 0) - first) ^ second) >>> 0;
		words[at] = word;
		second = (((second - word) >>> 0) >>> 7) ^ (((first + second) << 7) >>> 0);
		first = (first - 3) >>> 0;
	}
}

/**
 * `FpkOpener.TryOpen`: the index records a word that says whether an entry is keyed, the place and length of
 * the entry and its name. A name ending in `.fbx` holds a picture of this engine, which the reference leaves
 * untyped when the archive itself is named after its scripts. The key of an archive stands behind the end of
 * the first keyed entry long enough to carry one, and the reference falls back on reading the archive
 * **without** a key when it does not find one - which this port keeps, marking those entries as keyed.
 */
export function readFpkIndex(
	data: Buffer,
	maxOffset: bigint,
	fileName: string,
): FpkIndex | undefined {
	if (data.length < FBX_HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!data.subarray(MARK_FIELD, MARK_FIELD + MARK.length).equals(MARK)) {
		return undefined;
	}
	const indexOffset = data.readUInt32LE(INDEX_FIELD);
	const count = data.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	if (indexOffset + count * RECORD_SIZE > data.length) return undefined;
	const scripts = basename(fileName).toLowerCase().startsWith(SCRIPT_PREFIX);
	const entries: FpkEntry[] = [];
	for (let number = 0; number < count; number += 1) {
		const at = indexOffset + number * RECORD_SIZE;
		const field = data.subarray(at + NAME_FIELD, at + NAME_FIELD + NAME_LENGTH);
		const end = field.indexOf(0);
		const name = field
			.subarray(0, end === -1 ? field.length : end)
			.toString("latin1");
		const offset = data.readUInt32LE(at + PLACE_FIELD);
		const size = data.readUInt32LE(at + SIZE_FIELD);
		if (!checkPlacement(BigInt(offset), BigInt(size), maxOffset)) {
			return undefined;
		}
		const picture = sourceExtension(name) === FBX_EXTENSION;
		entries.push({
			name,
			offset,
			size,
			keyed: 0 !== data.readUInt32LE(at + KEYED_FIELD),
			type: picture && !scripts ? IMAGE_TYPE : undefined,
		});
	}
	const keyed = entries.find((entry) => entry.keyed && entry.size > 8);
	if (!keyed) return { entries, key: undefined };
	return { entries, key: findFpkKey(data, keyed.offset, keyed.size) };
}

/** The words of a run of an entry, out of the bytes it stands in and back into them. */
function readWords(data: Buffer): Uint32Array {
	const count = Math.trunc(data.length / 4);
	const words = new Uint32Array(count);
	for (let at = 0; at < count; at += 1) {
		words[at] = data.readUInt32LE(at * 4);
	}
	return words;
}

function writeWords(words: Uint32Array, data: Buffer): void {
	for (let at = 0; at < words.length; at += 1) {
		data.writeUInt32LE(words[at] ?? 0, at * 4);
	}
}

/**
 * `FpkOpener.UnpackFbx`: a walk whose control bits are read **two at a time from the lowest up**, every byte
 * of them naming four decisions. A decision draws a byte of its own, a run of the bytes that stand behind it,
 * a copy from behind the place the walk has reached, or - the fourth way - a longer form of a run or of a
 * copy, or a stretch of bytes the picture holds no room for, which is stepped over.
 */
export function unpackFbx(
	data: Buffer,
	inputStart: number,
	unpackedSize: number,
): Buffer {
	const output = Buffer.alloc(unpackedSize, 0x00);
	let at = inputStart;
	let destination = 0;
	let control = 1;
	const readByte = (): number => {
		if (at >= data.length) return -1;
		const value = data[at] ?? 0;
		at += 1;
		return value;
	};
	const drawBytes = (count: number): void => {
		const wanted = Math.max(0, Math.min(count, output.length - destination));
		const available = Math.max(0, Math.min(wanted, data.length - at));
		data.copy(output, destination, at, at + available);
		at += available;
		destination += available;
	};
	while (destination < output.length) {
		if (1 === control) {
			const next = readByte();
			if (-1 === next) break;
			control = next | 0x100;
		}
		switch (control & 3) {
			case 0: {
				const value = readByte();
				if (-1 === value) break;
				output[destination] = value;
				destination += 1;
				break;
			}
			case 1: {
				const count = readByte();
				if (-1 === count) break;
				drawBytes(Math.min(count + 2, RUN_LIMIT));
				break;
			}
			case 2: {
				let place = readByte();
				if (-1 === place) break;
				const low = readByte();
				if (-1 === low) break;
				place = (place << 8) | low;
				const count = Math.min((place & 0x1f) + 4, RUN_LIMIT);
				copyOverlapped(
					output,
					destination - (place >> 5) - 1,
					destination,
					count,
				);
				destination += count;
				break;
			}
			default: {
				const extended = readByte();
				if (-1 === extended) break;
				let count = extended & 0x3f;
				const way = extended >> 6;
				if (0 === way) {
					const low = readByte();
					if (-1 === low) break;
					drawBytes(Math.min(((count << 8) | low) + 0x102, RUN_LIMIT));
				} else if (1 === way) {
					let place = readByte();
					if (-1 === place) break;
					const low = readByte();
					if (-1 === low) break;
					place = (place << 8) | low;
					count = Math.min(((count << 5) | (place & 0x1f)) + 0x24, RUN_LIMIT);
					copyOverlapped(
						output,
						destination - (place >> 5) - 1,
						destination,
						count,
					);
					destination += count;
				} else if (3 === way) {
					// A stretch of bytes the picture holds no room for: the reference steps over them and
					// refills its control bits on the next step.
					at += count;
					control = 1 << 2;
				}
				break;
			}
		}
		control >>= 2;
	}
	return output;
}

/** One entry of the index, unkeyed when it is keyed at all, and drawn out of its own stream when it holds one. */
async function readFpkEntry(
	source: ByteSource,
	metadata: Record<string, unknown>,
	key: number | undefined,
	size: number,
	offset: number,
): Promise<Buffer> {
	let data = Buffer.from(await source.readAt(BigInt(offset), Number(size)));
	if ("true" === String(metadata.keyed ?? "")) {
		if (undefined === key) {
			throw unsupported(
				"The entry is keyed and the reference holds no key for it: the key of an archive stands behind the end of its first keyed entry, and its own table carries the key of nothing besides",
			);
		}
		const words = readWords(data);
		decryptFpk(words, key);
		writeWords(words, data);
		// The words behind the end of a keyed entry name how long it really is.
		const length = data.length >= 8 ? data.readInt32LE(data.length - 8) : -1;
		if (length < 0 || length > data.length) {
			throw invalid(
				"A keyed entry of the archive names a length it does not hold",
			);
		}
		data = Buffer.from(data.subarray(0, length));
	}
	if (data.length < FBX_HEADER_SIZE) return data;
	if (!data.subarray(0, FBX_MARK.length).equals(FBX_MARK)) return data;
	const unpackedSize = data.readInt32LE(FBX_UNPACKED_FIELD);
	if (unpackedSize <= 0 || unpackedSize > PICTURE_LIMIT) {
		throw invalid(
			"A picture of the archive names a size this project will not hold",
		);
	}
	// The packed length the head names is never asked for: the walk ends where the picture does.
	return unpackFbx(data, data[FBX_DATA_FIELD] ?? 0, unpackedSize);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const moonhirFpkDescriptor: FormatDescriptor = {
	id: "moonhir-fpk-archive",
	name: "MoonhirGames engine resource archive",
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
			source: "ArcFormats/Moonhir/ArcFPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const moonhirFpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: moonhirFpkDescriptor,
	detection: {
		signatures: [
			{ bytes: SIGNATURE },
			{ bytes: Buffer.concat([SIGNATURE, MARK]) },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(FBX_HEADER_SIZE)) return false;
		const data = await readStored(source);
		if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
		return readFpkIndex(data, source.size, "archive.fpk") !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const index = readFpkIndex(data, source.size, basename(sourcePath));
		if (!index) throw invalid("Not a MoonhirGames engine resource archive");
		const built: FixedEntry[] = index.entries.map((item, number) =>
			createFixedEntry({
				id: number,
				...normalizeEntryPath(item.name),
				offset: BigInt(item.offset),
				size: BigInt(item.size),
				// An entry the reference holds no key for is marked as keyed, so a caller can tell why it
				// cannot hand its bytes over.
				encrypted: item.keyed && index.key === undefined,
				metadata: {
					keyed: String(item.keyed),
					...(item.type ? { type: item.type } : {}),
				},
			}),
		);
		return {
			entries: built,
			metadata: {
				entryCount: built.length,
				hasKey: index.key !== undefined,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = await readStored(source);
		const index = readFpkIndex(stored, source.size, "archive.fpk");
		return Readable.from([
			await readFpkEntry(
				source,
				entry.metadata ?? {},
				index?.key,
				Number(entry.packedSize),
				Number(entry.offset),
			),
		]);
	},
});
