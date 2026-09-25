// Format reference: GARBro "ArcFormats/Marble/ArcMBL.cs", classes `MblOpener` and `GraMblOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

/** The two names an archive of this engine carries. */
const ARCHIVE_EXTENSIONS = ["mbl", "dns"];
/** The head of the plainer layout names how many entries and how long a name is. */
const COUNT_FIELD = 0;
const NAME_LENGTH_FIELD = 4;
/** The three layouts the reference tries in turn: a length it reads, then two it assumes. */
const INDEX_LAYOUTS: readonly (readonly [number, number])[] = [
	[0, 8],
	[0x10, 4],
	[0x38, 4],
];
/** A name the archive names itself with, and the length of a name it holds. */
const NAME_LENGTH_LIMIT = 0xff;
/** The suffix an archive carries when it holds scripts. */
const SCRIPT_SUFFIX = "_data";
/** The names the reference reads as images, since its own catalogue knows them by their extension. */
const IMAGE_EXTENSIONS = [
	"bmp",
	"grp",
	"png",
	"jpg",
	"jpeg",
	"gif",
	"tif",
	"tiff",
];
const SCRIPT_EXTENSIONS = ["s", "txt", "scr", "ks"];
const AUDIO_EXTENSIONS = ["wav", "ogg", "mp3"];
/** The archive of the graphics of this engine, whose file has to carry this name. */
const GRAPHICS_NAME = "mg_gra";
const GRAPHICS_NAME_MIN = 8;
const GRAPHICS_NAME_MAX = 0x40;
/** The first byte of a zlib stream, which is how the graphics archive tells its entries apart. */
const ZLIB_FIRST = 0x78;
/** An archive this project is willing to read. */
const LIMIT = 0xffffffff;

export interface MblEntry {
	name: string;
	offset: number;
	size: number;
	type: string | undefined;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The kind of an entry, as the reference reaches for its own catalogue to name one. */
function entryType(name: string, scripts: boolean): string | undefined {
	const extension = extname(name).slice(1).toLowerCase();
	if (scripts || SCRIPT_EXTENSIONS.includes(extension)) return "script";
	if (IMAGE_EXTENSIONS.includes(extension)) return "image";
	if (AUDIO_EXTENSIONS.includes(extension)) return "audio";
	return undefined;
}

/**
 * `MblOpener.ReadIndex`: every record holds a name - and, when the field is wide enough, the extension that
 * stands behind it - with the place and the length of the entry after them. A record whose name is empty ends
 * the walk, and the index is kept only when it names something and every entry stands inside the archive.
 */
function readMblIndex(
	data: Buffer,
	maxOffset: bigint,
	nameLength: number,
	indexOffset: number,
	scripts: boolean,
): MblEntry[] | undefined {
	if (nameLength <= 0 || nameLength > NAME_LENGTH_LIMIT) return undefined;
	const count = data.readInt32LE(COUNT_FIELD);
	const indexSize = (8 + nameLength) * count;
	if (indexOffset + indexSize > data.length) return undefined;
	const entries: MblEntry[] = [];
	let at = indexOffset;
	for (let number = 0; number < count; number += 1) {
		const field = data.subarray(at, at + nameLength);
		const end = field.indexOf(0);
		const name = field
			.subarray(0, end === -1 ? field.length : end)
			.toString("latin1");
		if (0 === name.length) break;
		let full = name;
		// The extension of a name stands behind it inside the field, when the field has room for one.
		if (nameLength - name.length > 1) {
			const rest = field
				.subarray(name.length + 1)
				.toString("latin1")
				.split("\0", 1)[0];
			if (rest && rest.length > 0) {
				full = `${name}.${rest}`;
			}
		}
		at += nameLength;
		const offset = data.readUInt32LE(at);
		const size = data.readUInt32LE(at + 4);
		at += 8;
		if (
			offset < indexSize ||
			!checkPlacement(BigInt(offset), BigInt(size), maxOffset)
		) {
			return undefined;
		}
		const lowered = full.toLowerCase();
		entries.push({
			name: lowered,
			offset,
			size,
			type: entryType(lowered, scripts),
		});
	}
	if (0 === entries.length || (1 === entries.length && count > 1))
		return undefined;
	return entries;
}

/** `MblOpener.TryOpen`: the three layouts of the index, tried in the order the reference tries them. */
export function readMblArchive(
	data: Buffer,
	maxOffset: bigint,
	fileName: string,
): MblEntry[] | undefined {
	if (data.length < 8) return undefined;
	if (!isSaneCount(data.readInt32LE(COUNT_FIELD))) return undefined;
	const declared = data.readUInt32LE(NAME_LENGTH_FIELD);
	const scripts = basename(fileName, extname(fileName))
		.toLowerCase()
		.endsWith(SCRIPT_SUFFIX);
	const layouts: (readonly [number, number])[] = [];
	if (declared > 0 && declared <= NAME_LENGTH_LIMIT) {
		layouts.push([declared, 8]);
	}
	layouts.push(...INDEX_LAYOUTS.slice(1));
	for (const [nameLength, indexOffset] of layouts) {
		const entries = readMblIndex(
			data,
			maxOffset,
			nameLength,
			indexOffset,
			scripts,
		);
		if (entries) return entries;
	}
	return undefined;
}

/**
 * `GraMblOpener.TryOpen`: the archive of the graphics of this engine keeps the length of a name at 0 and the
 * count at 4, names its entries after the pictures they hold, and stands at an index of its own. It is told
 * by the **name of the file** alone, which has to be the one the engine writes.
 */
export function readGraArchive(
	data: Buffer,
	maxOffset: bigint,
	fileName: string,
): FixedEntry[] | undefined {
	// The reference asks the name of the file to be the one the engine writes, and nothing else.
	if (basename(fileName, extname(fileName)).toLowerCase() !== GRAPHICS_NAME) {
		return undefined;
	}
	if (data.length < 8) return undefined;
	const nameLength = data.readUInt32LE(0);
	const count = data.readInt32LE(4);
	if (
		nameLength < GRAPHICS_NAME_MIN ||
		nameLength > GRAPHICS_NAME_MAX ||
		!isSaneCount(count)
	) {
		return undefined;
	}
	const indexSize = (8 + nameLength) * count;
	if (8 + indexSize > data.length) return undefined;
	const entries: FixedEntry[] = [];
	let at = 8;
	for (let number = 0; number < count; number += 1) {
		const field = data.subarray(at, at + nameLength);
		const end = field.indexOf(0);
		const name = field
			.subarray(0, end === -1 ? field.length : end)
			.toString("latin1")
			.toLowerCase();
		if (0 === name.length) break;
		at += nameLength;
		const offset = data.readUInt32LE(at);
		const size = data.readUInt32LE(at + 4);
		at += 8;
		if (offset < indexSize) return undefined;
		if (!checkPlacement(BigInt(offset), BigInt(size), maxOffset)) {
			return undefined;
		}
		entries.push(
			createFixedEntry({
				id: number,
				path: `${name.replace(/\.[^.]*$/, "")}.bmp`,
				offset: BigInt(offset),
				size: BigInt(size),
				metadata: { type: "image" },
			}),
		);
	}
	if (0 === entries.length || (1 === entries.length && count > 1))
		return undefined;
	return entries;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mblDescriptor: FormatDescriptor = {
	id: "marble-mbl-archive",
	name: "Marble engine resource archive",
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
			source: "ArcFormats/Marble/ArcMBL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mblFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mblDescriptor,
	// The archive writes no word of its own: the reference tells it by the shape of its head.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		const extension = extname(sourcePath).slice(1).toLowerCase();
		if (!ARCHIVE_EXTENSIONS.includes(extension)) return false;
		if (source.size < 8n || source.size > BigInt(LIMIT)) return false;
		return (
			readMblArchive(
				await readStored(source),
				source.size,
				basename(sourcePath),
			) !== undefined
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const fileName = basename(sourcePath);
		const entries = readMblArchive(
			await readStored(source),
			source.size,
			fileName,
		);
		if (!entries) throw invalid("Not a Marble engine resource archive");
		const built: FixedEntry[] = entries.map((item, number) =>
			createFixedEntry({
				id: number,
				...normalizeEntryPath(item.name),
				offset: BigInt(item.offset),
				size: BigInt(item.size),
				...(item.type ? { metadata: { type: item.type } } : {}),
			}),
		);
		return {
			entries: built,
			metadata: {
				entryCount: built.length,
				scripts: built.some(
					(entry) => (entry.metadata?.type ?? "") === "script",
				),
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(
			await source.readAt(BigInt(entry.offset), Number(entry.size)),
		);
		if ("script" !== (entry.metadata?.type ?? "")) {
			return Readable.from([stored]);
		}
		// The scripts of this engine stand behind a byte of their own negation, which is what a stock build
		// reads them with: the reference keys them with a pass phrase a user may type instead, and that way
		// is not ported.
		for (let at = 0; at < stored.length; at += 1) {
			stored[at] = (0x100 - (stored[at] ?? 0)) & 0xff;
		}
		return Readable.from([stored]);
	},
});

export const graDescriptor: FormatDescriptor = {
	id: "marble-gra-archive",
	name: "Marble engine graphics archive",
	extensions: [],
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
			source: "ArcFormats/Marble/ArcMBL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const graFormat: ArchiveFormat = defineFixedArchive({
	descriptor: graDescriptor,
	// The archive writes no word of its own either, and the reference tells it by the name of its **file**.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		if (source.size < 8n) return false;
		return (
			readGraArchive(
				await readStored(source),
				source.size,
				basename(sourcePath),
			) !== undefined
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = readGraArchive(
			await readStored(source),
			source.size,
			basename(sourcePath),
		);
		if (!entries) throw invalid("Not a Marble engine graphics archive");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(
			await source.readAt(BigInt(entry.offset), Number(entry.size)),
		);
		if ((stored[0] ?? 0) !== ZLIB_FIRST) return Readable.from([stored]);
		// The entries of this archive are streams of their own, told apart by the first byte of a zlib one.
		try {
			return Readable.from([await inflateZlibBuffer(stored)]);
		} catch {
			throw invalid("A zlib stream of the archive does not read");
		}
	},
});
