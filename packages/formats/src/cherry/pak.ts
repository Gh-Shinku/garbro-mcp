// Format reference: GARbro ArcFormats/Cherry/ArcCherry.cs, classes `PakOpener`, `CherryPak` and `Pak2Opener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const CHERRY2_SIGNATURES = [
	Buffer.from("CHERRY PACK 2.0\0", "latin1"),
	Buffer.from("CHERRY PACK 3.0\0", "latin1"),
];
const VERSION_FIELD = 0xc;
const COMPRESSED_FIELD = 0x10;
const COUNT_FIELD = 0x14;
const BASE_OFFSET_FIELD = 0x18;
const CHERRY_HEADER_SIZE = 8;
const CHERRY2_HEADER_SIZE = 0x1c;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x10;
const RECORD_OFFSET_FIELD = 0x10;
const RECORD_SIZE_FIELD = 0x14;
const COUNT_KEY = 0xbc138744;
const BASE_OFFSET_KEY = 0x64e0ba23;
/** Version two archives must place their index directly behind the header. */
const DIRECT_INDEX_VERSION = 2;
/** The archive name decides whether the entries are Cherry image groups. */
const GROUP_SUFFIX = "GRP";
const GROUP_EXTENSION = "grp";
/** Script payloads keep their text under an offset dependent key. */
const SCRIPT_SIGNATURE = Buffer.from("GsWIN SC File", "latin1");
const SCRIPT_OFFSET_FIELD = 0x5c;
const SCRIPT_SIZE_FIELD = 0x60;
const SCRIPT_TEXT_OFFSET = 0x68;
/** Encrypted payloads key three words and then swap the remaining byte pairs. */
const PAYLOAD_WORDS = [
	{ offset: 0, key: 0xa53cc35a },
	{ offset: 4, key: 0x35421005 },
	{ offset: 0x10, key: 0xcf42355d },
] as const;
const PAYLOAD_HEADER_SIZE = 0x18;
const PAIR_KEYS = [0x33, 0xcc] as const;

interface CherryEntry {
	name: string;
	offset: bigint;
	size: bigint;
	encrypted: boolean;
}

interface CherryHeader {
	version: number;
	compressed: boolean;
	count: number;
	baseOffset: bigint;
	encrypted: boolean;
}

/** `Pak2Opener.Decrypt`: every byte pair is keyed and swapped. */
export function decryptCherryPairs(
	input: Buffer,
	index: number,
	length: number,
): Buffer {
	const output = Buffer.from(input);
	for (let position = 0; position + 1 < length; position += 2) {
		const lo = (output[index + position] ?? 0) ^ (PAIR_KEYS[0] ?? 0);
		const hi = (output[index + position + 1] ?? 0) ^ (PAIR_KEYS[1] ?? 0);
		output[index + position] = hi;
		output[index + position + 1] = lo;
	}
	return output;
}

/** `Pak2Opener.TryOpen`: the header is validated as it stands, then once with the constant keys applied. */
async function readCherry2Header(
	source: ByteSource,
): Promise<CherryHeader | undefined> {
	if (source.size < BigInt(CHERRY2_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, CHERRY2_HEADER_SIZE);
	if (
		!CHERRY2_SIGNATURES.some((signature) =>
			header.subarray(0, 0x10).equals(signature),
		)
	)
		return undefined;
	const version = (header[VERSION_FIELD] ?? 0) - 0x30;
	const compressed = header.readInt32LE(COMPRESSED_FIELD) !== 0;
	const rawCount = header.readInt32LE(COUNT_FIELD);
	const rawBaseOffset = BigInt(header.readUInt32LE(BASE_OFFSET_FIELD));
	let count = rawCount;
	let baseOffset = rawBaseOffset;
	let encrypted = false;
	for (;;) {
		const retry =
			!isSaneCount(count) ||
			baseOffset >= source.size ||
			(version === DIRECT_INDEX_VERSION &&
				!compressed &&
				baseOffset !==
					BigInt(CHERRY2_HEADER_SIZE) + BigInt(count) * BigInt(RECORD_SIZE));
		if (!retry) break;
		if (encrypted) return undefined;
		count = (count ^ COUNT_KEY) | 0;
		baseOffset = rawBaseOffset ^ BigInt(BASE_OFFSET_KEY);
		encrypted = true;
	}
	return { version, compressed, count, baseOffset, encrypted };
}

async function readCherryIndex(
	source: ByteSource,
	index: Buffer,
	count: number,
	baseOffset: bigint,
	groupArchive: boolean,
	encrypted: boolean,
): Promise<CherryEntry[] | undefined> {
	const entries: CherryEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * RECORD_SIZE;
		const nameField = index.subarray(position, position + NAME_SIZE);
		const end = nameField.indexOf(0);
		const rawName = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		if (rawName.length === 0) return undefined;
		const relative = BigInt(index.readUInt32LE(position + RECORD_OFFSET_FIELD));
		const offset = baseOffset + relative;
		const size = BigInt(index.readUInt32LE(position + RECORD_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const name = groupArchive
			? `${rawName.replace(/\.[^./\\]*$/, "")}.${GROUP_EXTENSION}`
			: rawName;
		entries.push({ name, offset, size, encrypted });
	}
	if (entries.length === 0) return undefined;
	return entries;
}

async function buildIndex(
	source: ByteSource,
	index: Buffer,
	count: number,
	baseOffset: bigint,
	sourcePath: string,
	encrypted: boolean,
): Promise<CherryEntry[] | undefined> {
	const baseName = (sourcePath.split(/[\\/]/).pop() ?? "").replace(
		/\.[^.]*$/,
		"",
	);
	const groupArchive = baseName.toUpperCase().endsWith(GROUP_SUFFIX);
	return readCherryIndex(
		source,
		index,
		count,
		baseOffset,
		groupArchive,
		encrypted,
	);
}

/** `PakOpener.TryOpen`: an index directly behind the header, with the payloads based at the index end. */
async function readCherry(
	source: ByteSource,
	sourcePath: string,
): Promise<CherryEntry[] | undefined> {
	if (source.size < BigInt(CHERRY_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, CHERRY_HEADER_SIZE);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = BigInt(header.readUInt32LE(4));
	const expected =
		BigInt(CHERRY_HEADER_SIZE) + BigInt(count) * BigInt(RECORD_SIZE);
	if (baseOffset !== expected || baseOffset >= source.size) return undefined;
	const indexSize = count * RECORD_SIZE;
	const index = await source.readAt(BigInt(CHERRY_HEADER_SIZE), indexSize);
	return buildIndex(
		source,
		Buffer.from(index),
		count,
		baseOffset,
		sourcePath,
		false,
	);
}

/** `Pak2Opener.TryOpen`: a signed header, an optionally compressed index and a constant key retry. */
async function readCherry2(
	source: ByteSource,
	sourcePath: string,
): Promise<CherryEntry[] | undefined> {
	const header = await readCherry2Header(source);
	if (!header) return undefined;
	const { count, baseOffset, compressed, encrypted } = header;
	let index: Buffer;
	if (compressed) {
		const size = Number(baseOffset) - CHERRY2_HEADER_SIZE;
		if (size <= 0) return undefined;
		const packed = Buffer.from(
			await source.readAt(BigInt(CHERRY2_HEADER_SIZE), size),
		);
		try {
			index = inflateLzssAll(decryptCherryPairs(packed, 0, packed.length));
		} catch {
			return undefined;
		}
	} else {
		const size = count * RECORD_SIZE;
		if (BigInt(CHERRY2_HEADER_SIZE) + BigInt(size) > source.size)
			return undefined;
		index = Buffer.from(await source.readAt(BigInt(CHERRY2_HEADER_SIZE), size));
	}
	if (index.length < count * RECORD_SIZE) return undefined;
	const entries = await buildIndex(
		source,
		index,
		count,
		baseOffset,
		sourcePath,
		encrypted && compressed,
	);
	if (!entries) return undefined;
	return entries;
}

function toFixedEntries(entries: readonly CherryEntry[]): FixedEntry[] {
	return entries.map((entry, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			encrypted: entry.encrypted,
			metadata: {
				type: entry.name.toLowerCase().endsWith(`.${GROUP_EXTENSION}`)
					? "image"
					: "data",
			},
		}),
	);
}

/**
 * `PakOpener.OpenEntry`: script payloads store their text behind a keyed region; everything else is stored as
 * it is.
 */
export function decryptCherryScript(data: Buffer, size: bigint): Buffer {
	if (
		data.length < SCRIPT_TEXT_OFFSET ||
		!data.subarray(0, SCRIPT_SIGNATURE.length).equals(SCRIPT_SIGNATURE)
	)
		return data;
	const textOffset =
		SCRIPT_TEXT_OFFSET + data.readUInt32LE(SCRIPT_OFFSET_FIELD);
	const textSize = data.readUInt32LE(SCRIPT_SIZE_FIELD);
	if (textSize === 0 || BigInt(textOffset) + BigInt(textSize) > size)
		return data;
	const output = Buffer.from(data);
	for (let index = 0; index < textSize; index += 1) {
		const position = textOffset + index;
		output[position] = (output[position] ?? 0) ^ index;
	}
	return output;
}

/** `Pak2Opener.OpenEntry`: keyed payloads are never script payloads, they get their own treatment. */
export function decryptCherry2Payload(data: Buffer): Buffer {
	if (data.length < PAYLOAD_HEADER_SIZE) return data;
	const output = Buffer.from(data);
	for (const word of PAYLOAD_WORDS) {
		output.writeUInt32LE(
			(output.readUInt32LE(word.offset) ^ word.key) >>> 0,
			word.offset,
		);
	}
	return decryptCherryPairs(
		output,
		PAYLOAD_HEADER_SIZE,
		output.length - PAYLOAD_HEADER_SIZE,
	);
}

export const cherryPakDescriptor: FormatDescriptor = {
	id: "cherry-pak",
	name: "Cherry Soft PACK resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/Cherry/ArcCherry.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cherryPak2Descriptor: FormatDescriptor = {
	...cherryPakDescriptor,
	id: "cherry-pak2",
	name: "Cherry Soft PACK resource archive v2",
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
};

export const cherryPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cherryPakDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCherry(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCherry(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Cherry PACK layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		return Readable.from([decryptCherryScript(stored, entry.size)]);
	},
});

export const cherryPak2Format: ArchiveFormat = defineFixedArchive({
	descriptor: cherryPak2Descriptor,
	detection: { signatures: CHERRY2_SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCherry2(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCherry2(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Cherry PACK 2 layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (entry.encrypted) return Readable.from([decryptCherry2Payload(stored)]);
		return Readable.from([decryptCherryScript(stored, entry.size)]);
	},
});
