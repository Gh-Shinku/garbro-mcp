// Format reference: GARBro ArcFormats/MAI/ArcMAI.cs, class `ArcOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature spells `MAI` and ends with a 0x0A byte. */
const SIGNATURE = 0x0a49414d;
const EXTENSION = "arc";
const FILE_SIZE_OFFSET = 4;
const COUNT_OFFSET = 8;
const COUNT_LIMIT = 0xfffff;
const DIR_LEVEL_OFFSET = 0x0d;
const DIR_ENTRIES_OFFSET = 0x0e;
const HEADER_SIZE = 0x10;
/** A file record is a 0x10-byte name field plus the data offset and the size. */
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x10;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x14;
/** Folder records only apply at this level and are a four-byte name plus an index. */
const FOLDER_LEVEL = 2;
const FOLDER_SIZE = 8;
const FOLDER_NAME_SIZE = 4;

/** GARbro asks its resource catalog for each type; the port approximates the common ones by extension. */
const IMAGE_EXTENSIONS = new Set([
	"bmp",
	"gif",
	"jpeg",
	"jpg",
	"png",
	"tga",
	"tif",
	"tiff",
]);
const AUDIO_EXTENSIONS = new Set(["ogg", "wav", "mp3"]);

export const maiDescriptor: FormatDescriptor = {
	id: "mai-arc",
	name: "MAI resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/MAI/ArcMAI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface Folder {
	name: string;
	index: number;
}

/**
 * GARBro `ArcOpener.TryOpen`. The head spells `MAI` with a 0x0A byte, the word at 4 repeats the file's own
 * size, and the entry count sits at 8. A level byte and a folder count follow, and the index at 0x10 holds
 * the file records first and the folder records behind them.
 *
 * A folder applies from its own index onward, so the reference walks the entry list while advancing the
 * current folder whenever the entry index reaches the next folder's index; the last folder stays in effect
 * until the end. Folder names are four bytes wide and entries take the folder as a path prefix.
 *
 * GARbro asks its resource catalog for each entry's type through a lazy `AutoEntry`, and treats an archive
 * named `mask.arc` specially; the port instead records an inferred type from the extension and does not
 * special-case that file name. Payloads are stored verbatim.
 */
async function readMaiIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	if (BigInt(header.readUInt32LE(FILE_SIZE_OFFSET)) !== source.size)
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 0 || count > COUNT_LIMIT) return undefined;
	const dirLevel = header.readUInt8(DIR_LEVEL_OFFSET);
	const dirEntries = header.readUInt16LE(DIR_ENTRIES_OFFSET);
	const indexSize = count * RECORD_SIZE + dirEntries * FOLDER_SIZE;
	if (BigInt(HEADER_SIZE + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);

	let folders: Folder[] | undefined;
	if (dirEntries !== 0 && dirLevel === FOLDER_LEVEL) {
		folders = [];
		const base = count * RECORD_SIZE;
		for (let id = 0; id < dirEntries; id += 1) {
			const record = base + id * FOLDER_SIZE;
			const field = index.subarray(record, record + FOLDER_NAME_SIZE);
			const terminator = field.indexOf(0);
			folders.push({
				name: decodeCp932(
					terminator === -1 ? field : field.subarray(0, terminator),
				),
				index: index.readInt32LE(record + FOLDER_NAME_SIZE),
			});
		}
	}

	const entries: FixedEntry[] = [];
	let folder = 0;
	let currentFolder = "";
	let nextFolder = folders === undefined ? count : (folders[0]?.index ?? count);
	for (let id = 0; id < count; id += 1) {
		while (
			folders !== undefined &&
			id >= nextFolder &&
			folder < folders.length
		) {
			currentFolder = folders[folder]?.name ?? "";
			folder += 1;
			nextFolder =
				folder === folders.length ? count : (folders[folder]?.index ?? count);
		}
		const record = id * RECORD_SIZE;
		const field = index.subarray(record, record + NAME_SIZE);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const path = currentFolder.length === 0 ? name : `${currentFolder}/${name}`;
		const extension = sourceExtension(name);
		const inferredType = IMAGE_EXTENSIONS.has(extension)
			? "image"
			: AUDIO_EXTENSIONS.has(extension)
				? "audio"
				: undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(path),
				offset,
				size,
				...(inferredType === undefined ? {} : { metadata: { inferredType } }),
			}),
		);
	}
	return entries;
}

export const maiFormat: ArchiveFormat = defineFixedArchive({
	descriptor: maiDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readMaiIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMaiIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MAI archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
