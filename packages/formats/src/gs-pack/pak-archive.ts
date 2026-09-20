// Format reference: GARbro ArcFormats/GsPack/ArcGsPack.cs (class `PakOpener`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	decodeCStringField,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The three marks the reference accepts, which are of two different lengths. */
const MARKS = ["DataPack5", "GsPack5", "GsPack4"];
const HEADER_SIZE = 0x48;
const VERSION_MAJOR_AT = 0x32;
const INDEX_SIZE_AT = 0x34;
const ENCRYPTED_AT = 0x38;
const COUNT_AT = 0x3c;
const DATA_OFFSET_AT = 0x40;
const INDEX_OFFSET_AT = 0x44;
/** A record holds a name of at most this many bytes and then its offset and size. */
const NAME_LENGTH = 0x40;
const OFFSET_AT = 0x40;
const SIZE_AT = 0x44;
/** Records of a version before five are shorter than the ones of the versions from five on. */
const SHORT_ENTRY_SIZE = 0x48;
const LONG_ENTRY_SIZE = 0x68;
const MAJOR_VERSION = 5;
const MAXIMUM_INDEX_SIZE = 0xffffff;
/** The index is XORed with its own position when the lowest flag bit is set, and the records when the
 * second bit is. */
const INDEX_ENCRYPTED = 1;
const DATA_ENCRYPTED = 2;
/** `PakOpener.DecryptData` folds the record name into one word with this factor. */
const NAME_KEY_FACTOR = 37;
const WORD = 4;
/** An index longer than this is refused rather than allocated, whatever the header claims. */
const MAXIMUM_INDEX_BYTES = 0x4000000;

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface GsPackEntryPlan {
	readonly index: number;
	readonly name: string;
	readonly offset: bigint;
	readonly size: bigint;
}

export interface GsPackLayout {
	readonly entries: readonly GsPackEntryPlan[];
	readonly entrySize: number;
	/** Whether the records are folded with their own names, which the second flag bit marks. */
	readonly encrypted: boolean;
	/** The type the reference gives every record, from the name of the archive it read. */
	readonly defaultType: string;
}

/** `PakOpener.TryOpen`'s choice of a type from the archive's own name. */
function defaultTypeOf(sourcePath: string): string {
	const name = sourcePath.replace(/^.*[/\\]/, "");
	if (/^image/i.test(name)) return "image";
	if (/^voice/i.test(name)) return "audio";
	return "";
}

/** The index, which the reference may have XORed with its own positions and packed. */
async function readGsPackIndex(
	source: ByteSource,
	indexSize: number,
	indexOffset: number,
	unpackedSize: number,
	encrypted: boolean,
): Promise<Buffer | undefined> {
	if (0 === indexSize) {
		if (BigInt(indexOffset) + BigInt(unpackedSize) > source.size)
			return undefined;
		return Buffer.from(await source.readAt(BigInt(indexOffset), unpackedSize));
	}
	if (BigInt(indexOffset) + BigInt(indexSize) > source.size) return undefined;
	const packed = Buffer.from(
		await source.readAt(BigInt(indexOffset), indexSize),
	);
	if (encrypted) {
		for (let at = 0; at !== packed.length; at += 1)
			packed[at] = (packed[at] ?? 0) ^ (at & 0xff);
	}
	try {
		return Buffer.from(
			inflateLzss(packed, { outputLength: unpackedSize, literalBit: 1 }),
		);
	} catch {
		return undefined;
	}
}

/** `PakOpener.TryOpen`: the header, the index, then a record for every entry. */
export async function readGsPackLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<GsPackLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	// The marks are not all the same length, so each is compared over its own.
	const matched = MARKS.some(
		(mark) =>
			header.length >= mark.length &&
			header.toString("latin1", 0, mark.length) === mark,
	);
	if (!matched) return undefined;
	const indexSize = header.readUInt32LE(INDEX_SIZE_AT);
	const count = header.readInt32LE(COUNT_AT);
	if (!isSaneCount(count) || indexSize > MAXIMUM_INDEX_SIZE) return undefined;
	const encrypted = header.readUInt32LE(ENCRYPTED_AT);
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_AT));
	const indexOffset = header.readInt32LE(INDEX_OFFSET_AT);
	const entrySize =
		header.readUInt16LE(VERSION_MAJOR_AT) < MAJOR_VERSION
			? SHORT_ENTRY_SIZE
			: LONG_ENTRY_SIZE;
	const unpackedSize = count * entrySize;
	if (unpackedSize > MAXIMUM_INDEX_BYTES) return undefined;
	const index = await readGsPackIndex(
		source,
		indexSize,
		indexOffset,
		unpackedSize,
		0 !== (encrypted & INDEX_ENCRYPTED),
	);
	if (!index || index.length < unpackedSize) return undefined;
	const defaultType = defaultTypeOf(sourcePath);
	const entries: GsPackEntryPlan[] = [];
	for (let at = 0; at + entrySize <= unpackedSize; at += entrySize) {
		const name = decodeCStringField(index, at, NAME_LENGTH);
		if (0 === name.length) continue;
		const offset = dataOffset + BigInt(index.readUInt32LE(at + OFFSET_AT));
		const size = BigInt(index.readUInt32LE(at + SIZE_AT));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			index: entries.length,
			name: normalizeEntryPath(name).path,
			offset,
			size,
		});
	}
	return {
		entries,
		entrySize,
		encrypted: 0 !== (encrypted & DATA_ENCRYPTED),
		defaultType,
	};
}

/**
 * `PakOpener.DecryptData`: the record's own name, with every character's case folded away, is folded into
 * one word by repeated multiplication, and that word is mixed into every whole word of the record.
 */
export function packGsPackNameKey(name: string): number {
	let key = 0;
	for (let at = 0; at < name.length; at += 1)
		key = (Math.imul(key, NAME_KEY_FACTOR) + (name.charCodeAt(at) | 0x20)) | 0;
	return key;
}

/** `PakOpener.OpenEntry`: an encrypted record is mixed with the word its name folds into. */
export function unpackGsPackEntry(
	payload: Buffer,
	name: string,
	encrypted: boolean,
): Buffer {
	if (!encrypted) return payload;
	const key = packGsPackNameKey(name);
	const size = Math.trunc(payload.length / WORD);
	if (0 === size) return payload;
	const output = Buffer.from(payload);
	for (let at = 0; at + WORD <= size * WORD; at += WORD)
		output.writeUInt32LE((output.readUInt32LE(at) ^ key) >>> 0, at);
	return output;
}

export const gsPackPakDescriptor: FormatDescriptor = {
	id: "gspack-pak-archive",
	name: "GsPack resource archive",
	extensions: ["pak", "dat", "pa_"],
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
			source: "ArcFormats/GsPack/ArcGsPack.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gsPackPakFormat = defineFixedArchive({
	descriptor: gsPackPakDescriptor,
	// The reference declares two words, `Data` and `GsPa`, one for each of its marks.
	detection: {
		signatures: [
			{ bytes: Buffer.from("Data", "latin1") },
			{ bytes: Buffer.from("GsPa", "latin1") },
		],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGsPackLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readGsPackLayout(source, sourcePath);
		if (!layout) throw invalidArchive("Invalid GsPack layout");
		const entries: FixedEntry[] = layout.entries.map((plan) =>
			createFixedEntry({
				id: plan.index,
				...normalizeEntryPath(plan.name),
				offset: plan.offset,
				size: plan.size,
				encrypted: layout.encrypted,
				metadata: {
					type: layout.defaultType,
					recordSize: layout.entrySize,
				},
			}),
		);
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				recordSize: layout.entrySize,
				defaultType: layout.defaultType,
				encrypted: layout.encrypted,
			},
		};
	},
	async openEntry(source, entry) {
		const payload = await source.readAt(entry.offset, Number(entry.size));
		return Readable.from([
			unpackGsPackEntry(payload, entry.path, entry.encrypted),
		]);
	},
});
