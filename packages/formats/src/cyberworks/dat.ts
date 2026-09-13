// Format reference: GARBro ArcFormats/Cyberworks/ArcDAT.cs — classes `DatOpener`, `OldDatOpener`,
// `OldDatOpener2`, the archive name parsers and the table readers they build on.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	FileByteSource,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	readTocIndex,
	unpackToc,
	type TocIndex,
	type TocTypeOutcome,
} from "./toc.js";

/** Digit fields of the modern tables hold eight digits, the ones of the old tables four. */
const MODERN_NUM_LENGTH = 8;
const OLD_NUM_LENGTH = 4;
/** A meta archive is expected to be small. */
const MAX_META_SIZE = 0x1000n;
/** Two-digit extensions that mark an entry as an image, and the ones that mark audio. */
const IMAGE_EXTENSIONS = new Set(["b0", "n0", "o0", "0b"]);
const AUDIO_EXTENSIONS = new Set(["j0", "k0", "u0", "j", "k"]);
/** Entries of this game name never carry a bare `b` extension. */
const IGNORE_B_TITLE = "ドキドキ母娘レッスン ～教えて♪Ｈなお勉強～";
/** Records of the modern reader hold a sub-archive index once they are this large. */
const ARC_INDEX_ENTRY_SIZE = 0x17;
const ARC_INDEX_FIELD_OFFSET = 6;
/** The old record reader knows exactly one record size. */
const OLD_RECORD_SIZE = 0x11;
/** Sub-archive indices the old archives map their numbers to. */
const OLD_ARC_MAP: Record<string, number> = { "2": 0, "3": 1, "5": 4 };

const ARC_NAME_PATTERN = /^.+0?(?<id>(?<num>\d)(?<idx>[a-z])?)(?:|\..*)$/i;
const DAT_NAME_PATTERN = /^(?<name>d[a-z]+?)(?<idx>[ah])?\.dat$/i;
const OLD_ARC_NAME_PATTERN = /^Arc0(?<num>\d)\..*$/i;
const PATCH_NAME_PATTERN = /^patch0(?<num>[2468])\.dat$/i;
const IN_KYOU_NAME_PATTERN = /^(inyoukyou_kuon|mugen.*)\.app$/i;

export interface ParsedArchiveName {
	tocName: string;
	arcIndex: number;
}

/** GARBro `ArcNameParser`: `?6.dat` and the like open `?3.dat`, with a trailing letter selecting a sub-archive. */
export function parseArcName(arcName: string): ParsedArchiveName | undefined {
	const groups = ARC_NAME_PATTERN.exec(arcName)?.groups;
	const num = groups?.num;
	const id = groups?.id;
	if (num === undefined || id === undefined) return undefined;
	let indexNumber: number;
	if (num >= "4" && num <= "6") indexNumber = Number(num) - 3;
	else if (num === "8") indexNumber = 7;
	else return undefined;
	let arcIndex = 0;
	const idx = groups?.idx;
	if (idx !== undefined) arcIndex = idx.toUpperCase().charCodeAt(0) - 0x40;
	const position = arcName.lastIndexOf(id);
	if (position < 0) return undefined;
	return {
		tocName: `${arcName.slice(0, position)}${indexNumber}${arcName.slice(position + id.length)}`,
		arcIndex,
	};
}

/** GARBro `DatNameParser`: `dh.dat` and `da.dat` open `dh.dat`, the latter with a sub-archive index. */
export function parseDatName(arcName: string): ParsedArchiveName | undefined {
	const groups = DAT_NAME_PATTERN.exec(arcName)?.groups;
	const stem = groups?.name;
	if (stem === undefined) return undefined;
	let name = stem;
	let arcIndex = 0;
	const idx = groups?.idx;
	if (idx !== undefined) {
		if (idx.toLowerCase() === "a") {
			arcIndex = 1;
			name += "h";
		}
	} else name += "h";
	return { tocName: `${name}.dat`, arcIndex };
}

/** GARBro `OldArcNameParser`: `Arc02.dat` and `Arc03.dat` open `Arc00.dat`, `Arc05.dat` opens `Arc04.dat`. */
export function parseOldArcName(
	arcName: string,
): ParsedArchiveName | undefined {
	const num = OLD_ARC_NAME_PATTERN.exec(arcName)?.groups?.num;
	if (num === undefined) return undefined;
	const indexNumber = OLD_ARC_MAP[num];
	if (indexNumber === undefined) return undefined;
	const position = arcName.indexOf(num, 4);
	if (position < 0) return undefined;
	return {
		tocName: `${arcName.slice(0, position)}${indexNumber}${arcName.slice(position + 1)}`,
		arcIndex: 0,
	};
}

/** GARBro `PatchNameParser`: `patch06.dat` and the like open the table numbered one below. */
export function parsePatchName(arcName: string): ParsedArchiveName | undefined {
	const groups = PATCH_NAME_PATTERN.exec(arcName)?.groups;
	if (!groups) return undefined;
	const indexNumber = Number(groups.num) - 1;
	return {
		tocName: `${arcName.slice(0, 6)}${indexNumber}${arcName.slice(7)}`,
		arcIndex: 0,
	};
}

/** GARBro `InKyouParser`: the two named application archives open tables of the same stem. */
export function parseInKyouName(
	arcName: string,
): ParsedArchiveName | undefined {
	const stem = IN_KYOU_NAME_PATTERN.exec(arcName)?.groups?.[1];
	if (stem === undefined) return undefined;
	return { tocName: `${stem}.dat`, arcIndex: 0 };
}

const MODERN_NAME_PARSERS = [
	parseArcName,
	parseDatName,
	parsePatchName,
	parseInKyouName,
];

/** GARBro `DatOpener.TryParseMeta`: a small table whose payload opens with a CP932 title. */
async function readMetaTitle(path: string): Promise<string | undefined> {
	if (!existsSync(path)) return undefined;
	let source: FileByteSource | undefined;
	try {
		source = await FileByteSource.open(path);
		if (source.size > MAX_META_SIZE) return undefined;
		const unpacked = await unpackToc(source, 0, MODERN_NUM_LENGTH);
		if (!unpacked) return undefined;
		const toc = unpacked.toc;
		if (toc.length < 4) return undefined;
		const titleLength = toc.readInt32LE(0);
		if (titleLength <= 0 || titleLength > toc.length) return undefined;
		const title = toc.subarray(4, 4 + titleLength);
		if (title.length !== titleLength) return undefined;
		return decodeCp932(title);
	} catch {
		return undefined;
	} finally {
		await source?.close();
	}
}

/** GARBro `DatOpener.ReadToc`: the table sits in a sibling file. */
async function readTable(
	path: string,
	numLength: number,
): Promise<Buffer | undefined> {
	if (!existsSync(path)) return undefined;
	let source: FileByteSource | undefined;
	try {
		source = await FileByteSource.open(path);
		const unpacked = await unpackToc(source, 0, numLength);
		return unpacked?.toc;
	} catch {
		return undefined;
	} finally {
		await source?.close();
	}
}

/**
 * GARBro `ArcIndexReader.ReadEntryType`. Two type bytes name the entry, a large enough record also carries the
 * index of the sub-archive it belongs to, and records of other sub-archives are left out.
 */
function readArcIndexType(
	index: Buffer,
	position: number,
	entrySize: number,
	arcNumber: number,
	ignoreBFiles: boolean,
): TocTypeOutcome {
	const first = index[position];
	const second = index[position + 1];
	let entryIndex = 0;
	if (entrySize >= ARC_INDEX_ENTRY_SIZE)
		entryIndex = index[position + ARC_INDEX_FIELD_OFFSET] ?? -1;
	if (entryIndex !== arcNumber) return { skip: true };
	const outcome: TocTypeOutcome = {};
	if (first === undefined || first <= 0x20 || first >= 0x7f) return outcome;
	const extension =
		second !== undefined && second > 0x20 && second < 0x7f
			? String.fromCharCode(first, second)
			: String.fromCharCode(first);
	outcome.extension = extension;
	if (IMAGE_EXTENSIONS.has(extension) || (extension === "b" && !ignoreBFiles)) {
		outcome.type = "image";
		outcome.image = true;
	} else if (AUDIO_EXTENSIONS.has(extension)) outcome.type = "audio";
	return outcome;
}

/** GARBro `DatIndexReader.ReadEntryType`: one type byte on a record of exactly 0x11 bytes. */
function readDatIndexType(
	index: Buffer,
	position: number,
	entrySize: number,
): TocTypeOutcome {
	if (entrySize > OLD_RECORD_SIZE) return { reject: true };
	const type = index[position];
	const outcome: TocTypeOutcome = {};
	if (type === undefined || type <= 0x20 || type >= 0x7f) return outcome;
	outcome.extension = String.fromCharCode(type);
	if (type === 0x62) {
		outcome.type = "image";
		outcome.image = true;
	} else if (type === 0x6b || type === 0x6a) outcome.type = "audio";
	return outcome;
}

/** GARBro `DatOpener.TryOpen`. */
async function readModernDat(
	source: ByteSource,
	sourcePath: string,
): Promise<TocIndex | undefined> {
	const arcName = basename(sourcePath);
	const directory = dirname(sourcePath);
	// The meta archive of the series names the game, and which of its archives a file belongs to.
	let gameName: string | undefined;
	if (arcName !== "Arc06.dat")
		gameName = await readMetaTitle(resolve(directory, "Arc06.dat"));
	let parsed: ParsedArchiveName | undefined;
	if (!gameName) {
		gameName = await readMetaTitle(resolve(directory, "Arc00.dat"));
		for (const parser of MODERN_NAME_PARSERS) {
			parsed = parser(arcName);
			if (parsed) break;
		}
	} else parsed = parseOldArcName(arcName);
	if (!parsed) return undefined;

	const toc = await readTable(
		resolve(directory, parsed.tocName),
		MODERN_NUM_LENGTH,
	);
	if (!toc) return undefined;
	const arcNumber = parsed.arcIndex;
	const ignoreBFiles = gameName === IGNORE_B_TITLE;
	const result = readTocIndex(toc, source.size, (index, position, entrySize) =>
		readArcIndexType(index, position, entrySize, arcNumber, ignoreBFiles),
	);
	if (!result || result.entries.length === 0) return undefined;
	return result;
}

/** Parses the comma separated table of an old archive. */
function parseOldTable(
	toc: Buffer,
	maxOffset: bigint,
): { entries: FixedEntry[]; hasImages: boolean } | undefined {
	let text = toc.toString("latin1");
	if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
	const lines = text.split(/\r\n|\r|\n/);
	// A file that ends with a line break does not contribute a final empty line.
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	const entries: FixedEntry[] = [];
	let hasImages = false;
	for (const line of lines) {
		const fields = line.split(",");
		if (fields.length !== 5) return undefined;
		const extension = fields[4] ?? "";
		const unpackedSize = parseUnsigned(fields[1] ?? "");
		const storedSize = parseUnsigned(fields[2] ?? "");
		const offset = parseUnsigned(fields[3] ?? "");
		if (
			unpackedSize === undefined ||
			storedSize === undefined ||
			offset === undefined
		)
			return undefined;
		let type: string | undefined;
		if (extension === "b") {
			type = "image";
			hasImages = true;
		} else if (extension === "k" || extension === "j") type = "audio";
		if (!checkPlacement(offset, storedSize, maxOffset)) return undefined;
		const packed = unpackedSize !== storedSize;
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: changeExtension(fields[0] ?? "", extension),
				offset,
				size: packed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed: packed,
				...(type === undefined ? {} : { metadata: { type } }),
			}),
		);
	}
	return { entries, hasImages };
}

/** Parses a decimal field the way `UInt32.Parse` does: surrounding whitespace is allowed. */
function parseUnsigned(value: string): bigint | undefined {
	const text = value.trim();
	if (!/^\d+$/.test(text)) return undefined;
	const parsed = BigInt(text);
	if (parsed > 0xffffffffn) return undefined;
	return parsed;
}

/** GARBro `OldDatOpener.TryOpen`. */
async function readOldDatCsv(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; hasImages: boolean } | undefined> {
	const parsed = parseOldArcName(basename(sourcePath));
	if (!parsed) return undefined;
	const toc = await readTable(
		resolve(dirname(sourcePath), parsed.tocName),
		OLD_NUM_LENGTH,
	);
	if (!toc) return undefined;
	const result = parseOldTable(toc, source.size);
	if (!result || result.entries.length === 0) return undefined;
	return result;
}

/** GARBro `OldDatOpener2.TryOpen`. */
async function readOldDatIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<TocIndex | undefined> {
	const parsed = parseOldArcName(basename(sourcePath));
	if (!parsed) return undefined;
	const toc = await readTable(
		resolve(dirname(sourcePath), parsed.tocName),
		OLD_NUM_LENGTH,
	);
	if (!toc) return undefined;
	const result = readTocIndex(toc, source.size, readDatIndexType);
	if (!result || result.entries.length === 0) return undefined;
	return result;
}

/** GARBro `DatOpener.OpenEntry`: packed payloads are LZSS streams, everything else is stored. */
async function openDatEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	return Readable.from([inflateLzssAll(data)]);
}

function datDescriptor(
	id: string,
	name: string,
	extensions: readonly string[],
	reference: string,
): FormatDescriptor {
	return {
		id,
		name,
		extensions: [...extensions],
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
				source: reference,
				license: "MIT",
				commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
			},
		],
	};
}

export const cyberworksDatDescriptor: FormatDescriptor = datDescriptor(
	"cyberworks-dat",
	"Cyberworks/TinkerBell resource archive",
	["dat", "04", "05", "06", "app"],
	"ArcFormats/Cyberworks/ArcDAT.cs",
);

export const cyberworksCsystemDatDescriptor: FormatDescriptor = datDescriptor(
	"cyberworks-csystem-dat",
	"TinkerBell resource archive",
	["dat"],
	"ArcFormats/Cyberworks/ArcDAT.cs",
);

export const cyberworksCsystemDat2Descriptor: FormatDescriptor = datDescriptor(
	"cyberworks-csystem-dat2",
	"TinkerBell resource archive",
	["dat"],
	"ArcFormats/Cyberworks/ArcDAT.cs",
);

export const cyberworksDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cyberworksDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readModernDat(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readModernDat(source, sourcePath);
		if (!result)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Cyberworks resource archive",
			);
		return {
			entries: result.entries,
			metadata: {
				entryCount: result.entries.length,
				hasImages: result.hasImages,
			},
		};
	},
	openEntry: openDatEntry,
});

export const cyberworksCsystemDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cyberworksCsystemDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readOldDatCsv(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readOldDatCsv(source, sourcePath);
		if (!result)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid TinkerBell resource archive",
			);
		return {
			entries: result.entries,
			metadata: {
				entryCount: result.entries.length,
				hasImages: result.hasImages,
			},
		};
	},
	openEntry: openDatEntry,
});

export const cyberworksCsystemDat2Format: ArchiveFormat = defineFixedArchive({
	descriptor: cyberworksCsystemDat2Descriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readOldDatIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readOldDatIndex(source, sourcePath);
		if (!result)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid TinkerBell resource archive",
			);
		return {
			entries: result.entries,
			metadata: {
				entryCount: result.entries.length,
				hasImages: result.hasImages,
			},
		};
	},
	openEntry: openDatEntry,
});
