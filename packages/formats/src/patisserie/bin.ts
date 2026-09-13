// Format reference: GARbro ArcFormats/Patisserie/ArcBIN.cs, class `BinOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferByteSource,
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import { detectFileType } from "../shared/detect-type.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'OZ' plus a version byte, and an `OFST` marker behind it. */
const SIGNATURE = Buffer.from([0x4f, 0x5a, 0x00, 0x01]);
const INDEX_MARKER = Buffer.from("OFST", "latin1");
const INDEX_SIZE_FIELD = 8;
const INDEX_OFFSET = 0xc;
const OFFSET_SIZE = 4;
/** Payload markers decide how an entry is stored. */
const PACKED_MARKER = Buffer.from("DFLT", "latin1");
const DATA_MARKER = Buffer.from("DATA", "latin1");
const PACKED_HEADER_SIZE = 12;
const DATA_HEADER_SIZE = 8;
const PACKED_SIZE_FIELD = 4;
const UNPACKED_SIZE_FIELD = 8;
const MARKER_SIZE = 4;
/** Archives that only hold audio are named after their content. */
const AUDIO_SUFFIXES: readonly { suffix: string; extension: string }[] = [
	{ suffix: "flac", extension: "flac" },
	{ suffix: "ogg", extension: "ogg" },
];
const FLAC_SIGNATURE = 0x43614c66;
/** Names come from a sibling list, or from a shared list index next to the archive. */
const LIST_EXTENSION = "lst";
const SHARED_LIST_NAME = "lists.lst";
const SHARED_INDEX_NAME = "lists.bin";
const GENERATED_NAME_DIGITS = 5;

interface OzEntry {
	name: string;
	offset: bigint;
	packedSize: bigint;
	size: bigint;
	compressed: boolean;
	type: string | undefined;
	extension: string | undefined;
}

async function readRange(
	source: ByteSource,
	offset: bigint,
	length: number,
): Promise<Buffer | undefined> {
	if (length < 0 || offset < 0n) return undefined;
	if (offset + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(offset, length));
}

/** Reads a four byte marker at an absolute offset, bounded by the end of the file. */
async function readMarker(
	source: ByteSource,
	offset: bigint,
	marker: Buffer,
): Promise<boolean> {
	const bytes = await readRange(source, offset, marker.length);
	return bytes?.equals(marker) ?? false;
}

/** The offset table of a Patisserie index: `count` payload offsets behind the header. */
async function readOffsetTable(
	source: ByteSource,
): Promise<bigint[] | undefined> {
	const header = await readRange(source, 0n, INDEX_OFFSET);
	if (!header?.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	if (!header.subarray(SIGNATURE.length, 8).equals(INDEX_MARKER))
		return undefined;
	const indexSize = header.readInt32LE(INDEX_SIZE_FIELD);
	const count = Math.floor(indexSize / OFFSET_SIZE);
	if (!isSaneCount(count)) return undefined;
	const table = await readRange(
		source,
		BigInt(INDEX_OFFSET),
		count * OFFSET_SIZE,
	);
	if (!table) return undefined;
	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1)
		offsets.push(BigInt(table.readUInt32LE(id * OFFSET_SIZE)));
	return offsets;
}

/** Splits a cp932 name list, dropping the empty line a trailing newline would add. */
function parseNameList(data: Buffer): string[] {
	const names = decodeCp932(data)
		.split(/\r?\n/)
		.map((line) => line.trim());
	while (names.length > 0 && names[names.length - 1] === "") names.pop();
	return names;
}

/** `BinOpener.ReadFileNames`: the entry of a shared list index that holds the names of one archive. */
async function readSharedNames(
	sourcePath: string,
	baseName: string,
): Promise<string[] | undefined> {
	const sharedList = await readCompanionFile(sourcePath, SHARED_LIST_NAME);
	if (!sharedList) return undefined;
	const arcNumber = decodeCp932(sharedList)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.indexOf(baseName);
	if (arcNumber === -1) return undefined;
	const sharedIndex = await readCompanionFile(sourcePath, SHARED_INDEX_NAME);
	if (!sharedIndex) return undefined;
	const source = new BufferByteSource(sharedIndex);
	const offsets = await readOffsetTable(source);
	const offset = offsets?.[arcNumber];
	if (!offset) return undefined;
	const end =
		(offsets?.[arcNumber + 1] ?? undefined) === undefined
			? source.size
			: (offsets?.[arcNumber + 1] as bigint);
	if (end <= offset) return undefined;
	if (await readMarker(source, offset, PACKED_MARKER)) {
		const header = await readRange(source, offset, PACKED_HEADER_SIZE);
		if (!header) return undefined;
		const packedSize = BigInt(header.readUInt32LE(PACKED_SIZE_FIELD));
		const stored = await readRange(
			source,
			offset + BigInt(PACKED_HEADER_SIZE),
			Number(packedSize),
		);
		if (!stored) return undefined;
		return parseNameList(await inflateZlibBuffer(stored));
	}
	if (await readMarker(source, offset, DATA_MARKER)) {
		const header = await readRange(source, offset, DATA_HEADER_SIZE);
		if (!header) return undefined;
		const stored = await readRange(
			source,
			offset + BigInt(DATA_HEADER_SIZE),
			Number(BigInt(header.readUInt32LE(PACKED_SIZE_FIELD))),
		);
		if (!stored) return undefined;
		return parseNameList(stored);
	}
	return undefined;
}

/**
 * `BinOpener.GetFileNames`: a sibling `.lst` file wins, otherwise the archive may be listed in the shared
 * `lists.lst`, whose `lists.bin` index holds the names of every archive in the directory.
 */
async function readNames(
	sourcePath: string,
	baseName: string,
): Promise<string[] | undefined> {
	const ownList = await readCompanionFile(
		sourcePath,
		changeExtension(basename(sourcePath), LIST_EXTENSION),
	);
	if (ownList) return parseNameList(ownList);
	return readSharedNames(sourcePath, baseName);
}

/**
 * GARbro `BinOpener.TryOpen`. The index is a table of payload offsets and the payload behind the last offset
 * reaches the end of the file. A payload may carry a `DFLT` header with a zlib stream or a `DATA` header with
 * its own size.
 */
async function readOzIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<OzEntry[] | undefined> {
	const offsets = await readOffsetTable(source);
	if (!offsets) return undefined;
	const fullName = basename(sourcePath);
	const dot = fullName.lastIndexOf(".");
	const baseName = dot > 0 ? fullName.slice(0, dot) : fullName;
	let contentExtension = "";
	let contentType = "";
	for (const audio of AUDIO_SUFFIXES) {
		if (baseName.toLowerCase().endsWith(audio.suffix)) {
			contentExtension = audio.extension;
			contentType = "audio";
			break;
		}
	}
	const stem =
		contentExtension === ""
			? baseName
			: baseName.slice(0, baseName.length - contentExtension.length);
	const listed = (await readNames(sourcePath, baseName)) ?? [];
	const entries: OzEntry[] = [];
	for (const [id, offset] of offsets.entries()) {
		const end = offsets[id + 1] ?? source.size;
		const adjacent = end - offset;
		if (adjacent < 0n) return undefined;
		if (adjacent > 0n && !checkPlacement(offset, adjacent, source.size))
			return undefined;
		let marker = "";
		if (adjacent > BigInt(MARKER_SIZE)) {
			if (await readMarker(source, offset, PACKED_MARKER)) marker = "packed";
			else if (await readMarker(source, offset, DATA_MARKER)) marker = "data";
		}
		let entryOffset = offset;
		let packedSize = adjacent;
		let size = adjacent;
		let type: string | undefined = contentType === "" ? undefined : contentType;
		let extension: string | undefined =
			contentExtension === "" ? undefined : contentExtension;
		if (marker === "packed") {
			const header = await readRange(source, offset, PACKED_HEADER_SIZE);
			if (!header) return undefined;
			packedSize = BigInt(header.readUInt32LE(PACKED_SIZE_FIELD));
			size = BigInt(header.readUInt32LE(UNPACKED_SIZE_FIELD));
			entryOffset = offset + BigInt(PACKED_HEADER_SIZE);
		} else if (marker === "data") {
			const header = await readRange(source, offset, DATA_HEADER_SIZE);
			if (!header) return undefined;
			size = BigInt(header.readUInt32LE(PACKED_SIZE_FIELD));
			packedSize = size;
			entryOffset = offset + BigInt(DATA_HEADER_SIZE);
			if (contentType === "") {
				const signature = await readRange(source, entryOffset, MARKER_SIZE);
				const value = signature?.readUInt32LE(0) ?? 0;
				if (value === FLAC_SIGNATURE) {
					type = "audio";
					extension = "flac";
				} else {
					const detected = detectFileType(value);
					type = detected?.type;
					extension = detected?.extension;
				}
			}
		}

		entries.push({
			name:
				listed[id] ??
				`${stem}#${id.toString().padStart(GENERATED_NAME_DIGITS, "0")}`,
			offset: entryOffset,
			packedSize,
			size,
			compressed: marker === "packed",
			type,
			extension,
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function toFixedEntries(entries: readonly OzEntry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const name =
			entry.extension === undefined
				? entry.name
				: changeExtension(entry.name, entry.extension);
		return createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset: entry.offset,
			size: entry.size,
			packedSize: entry.packedSize,
			compressed: entry.compressed,
			metadata: { type: entry.type },
		});
	});
}

export const ozDescriptor: FormatDescriptor = {
	id: "patisserie-oz",
	name: "Patisserie resource archive",
	extensions: ["bin"],
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
			source: "ArcFormats/Patisserie/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ozFormat = defineFixedArchive({
	descriptor: ozDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readOzIndex(source, sourcePath ?? "")) !== undefined;
	},
	async read(source: ByteSource, sourcePath?: string) {
		const entries = await readOzIndex(source, sourcePath ?? "");
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Patisserie OZ layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (!entry.compressed) return Readable.from([stored]);
		try {
			return Readable.from([
				await inflateZlibBuffer(stored, Number(entry.size)),
			]);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Patisserie payload");
		}
	},
});
