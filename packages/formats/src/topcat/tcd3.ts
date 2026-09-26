// Port of GARbro "ArcFormats/TopCat/ArcTCD3.cs" (tag "TCD", class TcdOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. An archive of the TopCat engine of the second and
// the third shapes: a table of sections at the head of the file, and within each section a table of the
// directories of the engine, a table of the names of the pictures of those directories, and a table of the
// places of the pictures themselves.
//
// The reference stands of a table of keys of its own (`TcdOpener.KnownKeys`, filled from the settings of the
// user) for the places of a picture of the engine that stand of the cipher of the engine's own, which stands
// within `OpenSpdc` alone. A stock build carries no key, and so does this port: such a picture stands handed
// over as it stands rather than refused, exactly as the reference hands it over where its table is empty.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
/** `TcdOpener.Signatures`: the two words a file of the engine may begin with. */
export const TCD3_SIGNATURES: readonly Buffer[] = [
	Buffer.from("TCD2", "latin1"),
	Buffer.from("TCD3", "latin1"),
];
/** Where the table of the sections of the engine begins. */
const SECTION_TABLE = 8;
/** The places of the file one word of the table of the sections stands of. */
const SECTION_RECORD = 0x20;
/** `TcdReaderV2` stands of four sections of the engine, and `TcdReaderV3` of five. */
const SECTIONS_V2 = 4;
const SECTIONS_V3 = 5;
/** `TcdIndexReader.Extensions`: the places of a name of each section, of the section's own number. */
const SECTION_EXTENSIONS = [".tct", ".tsf", ".spd", ".ogg", ".wav"] as const;
/** The places of the file one word of the table of the directories of a section stands of. */
const DIR_RECORD = 0x10;
/** The count of the places of the file of one word of a page of an Ogg stream. */
const OGG_PAGE_HEAD = 0x1b;
/** The place of the count of the places of the segments of a page within its head. */
const OGG_SEGMENT_COUNT = 0x1a;
/** The place of the check word of a page within its head. */
const OGG_CHECKSUM = 0x16;

/** One section of the engine: the places of its tables and the counts that stand in them. */
export interface TcdSection {
	extension: string;
	dataSize: number;
	indexOffset: number;
	dirCount: number;
	dirNameLength: number;
	fileCount: number;
	fileNameLength: number;
	dirNamesSize: number;
	fileNamesSize: number;
}

/** A picture of an archive of the engine: the name of it, the places of it and its row in its own section. */
export interface Tcd3Entry {
	name: string;
	offset: number;
	size: number;
	index: number;
}

/** The sections of the head of the file, of the shape the word of the file names. */
export function readTcdSections(
	data: Buffer,
	version: number,
): TcdSection[] | undefined {
	const count = version === 2 ? SECTIONS_V2 : SECTIONS_V3;
	const sections: TcdSection[] = [];
	for (let at = 0; at < count; at += 1) {
		const start = SECTION_TABLE + at * SECTION_RECORD;
		if (start + SECTION_RECORD > data.length) return undefined;
		const section =
			2 === version
				? {
						dataSize: data.readUInt32LE(start),
						fileCount: data.readInt32LE(start + 4),
						dirCount: data.readInt32LE(start + 8),
						indexOffset: data.readUInt32LE(start + 12),
						dirNameLength: data.readInt32LE(start + 16),
						fileNameLength: data.readInt32LE(start + 20),
					}
				: {
						dataSize: data.readUInt32LE(start),
						indexOffset: data.readUInt32LE(start + 4),
						dirCount: data.readInt32LE(start + 8),
						dirNameLength: data.readInt32LE(start + 12),
						fileCount: data.readInt32LE(start + 16),
						fileNameLength: data.readInt32LE(start + 20),
					};
		// The reference stands of no section where the count it reads first stands of nought: the count of
		// the places of the places of a section for the second shape, and the place of the tables of a
		// section for the third.
		if (0 === (2 === version ? section.dataSize : section.indexOffset))
			continue;
		const extension = SECTION_EXTENSIONS[at] ?? "";
		const names =
			2 === version
				? {
						dirNamesSize: section.dirNameLength,
						fileNamesSize: section.fileNameLength,
					}
				: {
						dirNamesSize: section.dirNameLength * section.dirCount,
						fileNamesSize: section.fileNameLength * section.fileCount,
					};
		sections.push({
			...section,
			extension,
			...names,
		});
	}
	return sections;
}

/** `TcdIndexReader.DecryptNames`: every place of a table of names stands the cipher of the section less. */
function decryptNames(names: Buffer, key: number): void {
	for (let at = 0; at < names.length; at += 1) {
		names[at] = ((names[at] ?? 0) - key) & 0xff;
	}
}

/** The name of a picture of the engine, of the walk the shape of the file stands of. */
function readTcdName(
	names: Buffer,
	at: number,
	nameLength: number,
	version: number,
): { name: string; next: number } | undefined {
	if (2 === version) {
		// The names of the second shape stand of each other, of a place of no name between them, and the
		// count the section names is the count of the places of the whole table rather than of one name.
		const end = names.indexOf(0, at);
		const stop = -1 === end ? names.length : end;
		if (stop < at) return undefined;
		return {
			name: decodeCp932(names.subarray(at, stop)),
			next: stop + 1,
		};
	}
	if (at + nameLength > names.length) return undefined;
	const field = names.subarray(at, at + nameLength);
	const end = field.indexOf(0);
	return {
		name: decodeCp932(-1 === end ? field : field.subarray(0, end)),
		next: at + nameLength,
	};
}

/** `TcdIndexReader.ReadIndex`: the pictures of every section of the archive. */
export function readTcdIndex(data: Buffer): Tcd3Entry[] | undefined {
	if (data.length < SECTION_TABLE + SECTION_RECORD) return undefined;
	const version = data[3] === 0x32 ? 2 : data[3] === 0x33 ? 3 : 0;
	if (0 === version) return undefined;
	const count = data.readInt32LE(4);
	if (!isSaneCount(count)) return undefined;
	const sections = readTcdSections(data, version);
	if (!sections) return undefined;
	const found: Tcd3Entry[] = [];
	for (const section of sections) {
		if (
			section.dirCount < 0 ||
			section.fileCount < 0 ||
			section.dirNameLength < 0 ||
			section.fileNameLength < 0
		) {
			return undefined;
		}
		let at = section.indexOffset;
		if (at + section.dirNamesSize > data.length) return undefined;
		const dirNames = Buffer.from(data.subarray(at, at + section.dirNamesSize));
		at += section.dirNamesSize;
		// The cipher of a section is the place of no name of the first name of the table of directories,
		// which stands of the cipher itself where every place of the table stands of it.
		const key = dirNames[section.dirNameLength - 1] ?? 0;
		if (section.dirNameLength < 1) return undefined;
		decryptNames(dirNames, key);
		if (at + section.dirCount * DIR_RECORD > data.length) return undefined;
		const dirs: {
			fileCount: number;
			namesOffset: number;
			firstIndex: number;
		}[] = [];
		for (let word = 0; word < section.dirCount; word += 1) {
			dirs.push({
				fileCount: data.readInt32LE(at),
				namesOffset: data.readInt32LE(at + 4),
				firstIndex: data.readInt32LE(at + 8),
			});
			at += DIR_RECORD;
		}
		if (at + section.fileNamesSize > data.length) return undefined;
		const fileNames = Buffer.from(
			data.subarray(at, at + section.fileNamesSize),
		);
		at += section.fileNamesSize;
		decryptNames(fileNames, key);
		if (at + (section.fileCount + 1) * 4 > data.length) return undefined;
		const offsets: number[] = [];
		for (let word = 0; word <= section.fileCount; word += 1) {
			offsets.push(data.readUInt32LE(at + word * 4));
		}
		let dirAt = 0;
		for (const dir of dirs) {
			const dirName = readTcdName(
				dirNames,
				dirAt,
				section.dirNameLength,
				version,
			);
			if (!dirName) return undefined;
			dirAt = dirName.next;
			let nameAt = dir.namesOffset;
			let index = dir.firstIndex;
			for (let file = 0; file < dir.fileCount; file += 1) {
				const name = readTcdName(
					fileNames,
					nameAt,
					section.fileNameLength,
					version,
				);
				if (!name) return undefined;
				nameAt = name.next;
				const start = offsets[index];
				const end = offsets[index + 1];
				if (undefined === start || undefined === end || end < start)
					return undefined;
				const path = changeExtension(
					dirName.name.length > 0 ? `${dirName.name}/${name.name}` : name.name,
					section.extension.replace(/^\./, ""),
				);
				if (start + (end - start) > data.length) return undefined;
				found.push({ name: path, offset: start, size: end - start, index });
				index += 1;
			}
		}
	}
	return found;
}

/**
 * `Crc32Normal` (`ArcFormats/Crc32.cs`): the check word of a page of an Ogg stream, of the polynomial
 * 0x04C11DB7 read from the high places of the word down, of no place of the file read of the word of the
 * run backwards in front of it and of no other count of the places of the file. This is the walk the
 * specification of the format of an Ogg stream stands of as well, and it is **not** the walk of
 * `codecs/crc32.ts`, whose table stands of the places of the word read backwards.
 */
export function oggCrc32(input: Uint8Array): number {
	let value = 0;
	for (const byte of input) {
		value ^= (byte << 24) >>> 0;
		for (let step = 0; step < 8; step += 1) {
			value =
				(0 !== (value & 0x80000000)
					? (0x04c11db7 ^ (value << 1)) >>> 0
					: (value << 1) >>> 0) >>> 0;
		}
	}
	return value >>> 0;
}

/** `TcdOpener.RestoreOggStream`: the check words of the pages of an Ogg stream stood again. */
export function restoreTcdOggPages(input: Buffer): Buffer {
	const data = Buffer.from(input);
	let at = 0;
	let remaining = data.length;
	while (
		remaining > OGG_PAGE_HEAD &&
		data.toString("latin1", at, at + 4) === "OggS"
	) {
		const segments = data[at + OGG_SEGMENT_COUNT] ?? 0;
		data.fill(0, at + OGG_CHECKSUM, at + OGG_CHECKSUM + 4);
		let pageSize = segments + OGG_PAGE_HEAD;
		if (0 !== segments) {
			if (remaining < pageSize) break;
			let table = at + OGG_PAGE_HEAD;
			for (let segment = 0; segment < segments; segment += 1) {
				pageSize += data[table] ?? 0;
				table += 1;
			}
		}
		remaining -= pageSize;
		if (remaining < 0) break;
		data.writeUInt32LE(
			oggCrc32(data.subarray(at, at + pageSize)),
			at + OGG_CHECKSUM,
		);
		at += pageSize;
	}
	return data;
}

/** `TcdOpener.UnpackLz` through `DecryptScript`: the places of a script of the engine. */
export function unpackTcdScript(input: Buffer): Buffer | undefined {
	if (input.length < 4) return undefined;
	const unpacked = input.readInt32LE(0);
	if (unpacked <= 0 || unpacked > 0x4000000) return undefined;
	const output: Buffer = Buffer.alloc(unpacked, 0x00);
	let source = 4;
	let destination = 0;
	let bits = 2;
	while (destination < output.length) {
		bits >>= 1;
		if (1 === bits) {
			if (source >= input.length) break;
			bits = (input[source] ?? 0) | 0x100;
			source += 1;
		}
		if (0 === (bits & 1)) {
			if (source + 1 >= input.length) break;
			const low = input[source] ?? 0;
			const high = input[source + 1] ?? 0;
			source += 2;
			const offset = high * 0x10 + (low >> 4);
			const count = Math.min((low & 0x0f) + 3, output.length - destination);
			if (destination - offset < 0) return undefined;
			for (let step = 0; step < count; step += 1) {
				output[destination + step] = output[destination - offset + step] ?? 0;
			}
			destination += count;
		} else {
			if (source >= input.length) break;
			output[destination] = input[source] ?? 0;
			destination += 1;
			source += 1;
		}
	}
	// `Binary.RotByteR (b, 1)`: every place of the script stands turned to the right by one place.
	for (let at = 0; at < output.length; at += 1) {
		const byte = output[at] ?? 0;
		output[at] = ((byte >> 1) | (byte << 7)) & 0xff;
	}
	return output;
}

export const topcatTcd3Descriptor: FormatDescriptor = {
	id: "topcat-tcd3",
	name: "TopCat data archive",
	extensions: ["tcd"],
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
			source: "ArcFormats/TopCat/ArcTCD3.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/** The places of one entry of the archive, of the walk the place of its name stands of. */
export const topcatTcd3EntryOpener: FixedEntryOpener = async (
	source,
	entry,
) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const extension = entry.path.replace(/^.*\./, "").toLowerCase();
	if ("ogg" === extension) return Readable.from([restoreTcdOggPages(data)]);
	if ("tsf" === extension || "tct" === extension) {
		const script = unpackTcdScript(data);
		if (!script)
			throw invalidArchive("The script of the engine stands of no walk");
		return Readable.from([script]);
	}
	// `TcdOpener.OpenSpdc`: a picture of the engine stands of the cipher of the engine where the table of
	// the reference names one for its game. This port carries no such table, so the places of the picture
	// stand as they stand, which is what the reference hands over where its own table is empty as well.
	return Readable.from([data]);
};

export const topcatTcd3Format: ArchiveFormat = defineFixedArchive({
	descriptor: topcatTcd3Descriptor,
	detection: {
		signatures: TCD3_SIGNATURES.map((bytes) => ({ bytes })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(SECTION_TABLE + SECTION_RECORD)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readTcdIndex(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, _sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const entries = readTcdIndex(data);
		if (!entries) throw invalidArchive("Not an archive of the TopCat engine");
		const names = new Set<string>();
		// The id of an entry is its place within the whole of the archive: the row of a picture within
		// the table of the places of its own section stands of the same count in every section.
		const fixed: FixedEntry[] = entries.map((entry, id) => {
			if (names.has(entry.name)) {
				throw invalidArchive("The archive stands of two pictures of one name");
			}
			names.add(entry.name);
			const isPicture = /\.spd$/i.test(entry.name);
			return {
				...createFixedEntry({
					id,
					path: entry.name,
					offset: BigInt(entry.offset),
					size: BigInt(entry.size),
					compressed: false,
					metadata: {
						type: isPicture ? "image" : "file",
						sectionIndex: entry.index,
					} as Record<string, unknown>,
				}),
				sizeKnown: true,
			} as FixedEntry;
		});
		return {
			entries: fixed,
			metadata: { count: fixed.length, shape: "sections" },
		};
	},
	openEntry: topcatTcd3EntryOpener,
});

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
