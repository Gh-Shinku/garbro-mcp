// Format reference: GARBro "ArcFormats/DigitalWorks/ArcBIN.cs", class `BinOpener`. The reference's own
// `KnownSchemes` - a table of ready made indexes, one per archive name per game - ships as an **empty**
// dictionary, so this port keeps only the way the reference falls back on when the table holds nothing: the
// index is read out of the executable that stands beside the archive, in its `.data` section. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import {
	type ExeFile,
	type ExeSection,
	findExeString,
	readExeFile,
} from "../microsoft/exe-file.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The names an archive of this engine may carry. */
const ARCHIVE_EXTENSIONS = ["bin", "pac"];
/** The section of the executable the index is read from. */
const INDEX_SECTION = ".data";
/** One entry of the index, and the twelve bytes it takes. */
const INDEX_ENTRY_SIZE = 12;
const INDEX_OFFSET_FIELD = 0;
const INDEX_SIZE_FIELD = 4;
const INDEX_PACKED_FIELD = 8;
const INDEX_ID_FIELD = 10;
/** The twelve bytes the index is found by: the size of the archive, twice over. */
const INDEX_MARK_SIZE = 12;
const INDEX_MARK_STEP = 4;
/** How many digits an entry's number is written with. */
const ENTRY_NUMBER_DIGITS = 5;
/** The extension every archive name takes, as the reference's own table gives it. */
const EXTENSION_MAP: ReadonlyMap<string, string> = new Map([
	["ANM", "BIN"],
	["MOV", "MPG"],
	["STR", "OGG"],
	["TAK", "BIN"],
	["VCE", "OGG"],
	["VIS", "TMX"],
	["_SE", "OGG"],
]);
/** The kinds of thing an entry may hold, as the reference names the formats it knows. */
const CONTAINED_FORMATS: ReadonlyMap<string, string> = new Map([
	["OGG", "audio"],
	["SCR", "script"],
	["TX", "image"],
]);
/** An archive this project is willing to read. */
const LIMIT = 0xffffffff;

interface BinIndexEntry {
	offset: number;
	size: number;
	packed: boolean;
	id: number;
}

export interface BinScheme {
	extension: string;
	size: number;
	index: BinIndexEntry[];
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BinOpener.ParseIndexTable`: the index stands **behind** the mark, twelve bytes to an entry, and is walked
 * **backwards** from it. Every entry has to stand before the one read last, so the walk ends where the
 * archive itself begins.
 */
export function parseBinIndex(
	data: Buffer,
	section: ExeSection,
	markAt: number,
	archiveName: string,
): BinScheme | undefined {
	if (markAt + 4 > data.length) return undefined;
	const archiveSize = data.readUInt32LE(markAt);
	let lastOffset = archiveSize;
	const index: BinIndexEntry[] = [];
	for (
		let at = markAt - INDEX_ENTRY_SIZE;
		at >= section.offset && 0 !== lastOffset;
		at -= INDEX_ENTRY_SIZE
	) {
		if (at + INDEX_ENTRY_SIZE > data.length) return undefined;
		const offset = data.readUInt32LE(at + INDEX_OFFSET_FIELD);
		const size = data.readUInt32LE(at + INDEX_SIZE_FIELD);
		const packed = data.readUInt16LE(at + INDEX_PACKED_FIELD);
		const id = data.readUInt16LE(at + INDEX_ID_FIELD);
		if (
			0 === size ||
			offset + size > lastOffset ||
			(0 !== packed && 1 !== packed)
		) {
			return undefined;
		}
		index.push({ offset, size, packed: 0 !== packed, id });
		lastOffset = offset;
	}
	const name = basename(archiveName, extname(archiveName)).toUpperCase();
	return {
		extension: EXTENSION_MAP.get(name) ?? "",
		size: archiveSize,
		index,
	};
}

/** `BinOpener.FindScheme`: the index is found by the size of the archive, written twice over, in `.data`. */
export function findBinScheme(
	exe: ExeFile,
	archiveSize: number,
	archiveName: string,
): BinScheme | undefined {
	const section = exe.sections.get(INDEX_SECTION);
	if (!section) return undefined;
	const mark = Buffer.alloc(INDEX_MARK_SIZE, 0x00);
	mark.writeUInt32LE(archiveSize, 0);
	mark.writeUInt32LE(archiveSize, 4);
	const at = findExeString(exe, section, mark, INDEX_MARK_STEP);
	if (!(at > 0)) return undefined;
	return parseBinIndex(exe.data, section, at, archiveName);
}

/**
 * The reference's fallback: the executable stands in the **parent** of the directory that holds the archive,
 * and the first one whose `.data` section carries the mark is the one the index is read from.
 */
export async function findBinSchemeInDirectory(
	archivePath: string,
	archiveSize: number,
): Promise<BinScheme | undefined> {
	const gameDir = dirname(dirname(resolve(archivePath)));
	let names: string[];
	try {
		names = await readdir(gameDir);
	} catch {
		return undefined;
	}
	const archiveName = basename(archivePath);
	for (const name of names) {
		if (!/\.exe$/i.test(name)) continue;
		let bytes: Buffer;
		try {
			bytes = await readFile(resolve(gameDir, name));
		} catch {
			continue;
		}
		const exe = readExeFile(bytes);
		if (!exe?.sections.has(INDEX_SECTION)) continue;
		const scheme = findBinScheme(exe, archiveSize, archiveName);
		if (scheme) return scheme;
	}
	return undefined;
}

export const digitalWorksBinPacDescriptor: FormatDescriptor = {
	id: "digitalworks-bin-pac",
	name: "Digital Works resource archive",
	extensions: ARCHIVE_EXTENSIONS,
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
			source: "ArcFormats/DigitalWorks/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const digitalWorksBinPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: digitalWorksBinPacDescriptor,
	// The archive writes no word of its own: it is told by its name and by the index the executable holds.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		const extension = extname(sourcePath).slice(1).toLowerCase();
		if (!ARCHIVE_EXTENSIONS.includes(extension)) return false;
		const size = Number(source.size);
		if (size <= 0 || size >= LIMIT) return false;
		return (await findBinSchemeInDirectory(sourcePath, size)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const size = Number(source.size);
		if (size <= 0 || size >= LIMIT) {
			throw invalid("The archive is larger than this project will read");
		}
		const scheme = await findBinSchemeInDirectory(sourcePath, size);
		if (!scheme) {
			throw invalid("Not a Digital Works resource archive");
		}
		const archiveName = basename(sourcePath, extname(sourcePath));
		const entries: FixedEntry[] = [];
		for (const item of scheme.index) {
			const name = `${archiveName}${String(item.id).padStart(ENTRY_NUMBER_DIGITS, "0")}.${scheme.extension}`;
			const contained = CONTAINED_FORMATS.get(scheme.extension);
			entries.push(
				createFixedEntry({
					id: item.id,
					path: name,
					offset: BigInt(item.offset),
					size: BigInt(item.size),
					compressed: item.packed,
					metadata: {
						...(contained ? { type: contained } : {}),
						packed: item.packed,
					},
				}),
			);
		}
		if (0 === entries.length) {
			throw invalid("The archive's index names no entry");
		}
		return {
			entries,
			metadata: {
				archiveSize: scheme.size,
				extension: scheme.extension,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		// The bytes of an entry stand in the archive as they are, packed or not.
		return Readable.from([
			Buffer.from(
				await source.readAt(BigInt(entry.offset), Number(entry.size)),
			),
		]);
	},
});
