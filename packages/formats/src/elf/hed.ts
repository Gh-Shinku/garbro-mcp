// Format reference: GARBro ArcFormats/elf/ArcHED.cs, class `PakOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "bin";
/** The index lives in a sibling file that replaces the archive's own extension. */
const INDEX_EXTENSION = "pak";
/** The index begins with the four bytes `hed` and a null. */
const INDEX_MAGIC = 0x00646568;
const INDEX_COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
/** A graphic record is an offset and a size; a voice record is three times that with the same first two. */
const CG_RECORD_SIZE = 8;
const VOICE_RECORD_SIZE = 0x18;
const OFFSET_FIELD = 0;
const SIZE_FIELD = 4;
/** The name list is a sibling text file that is searched upwards from the archive's directory. */
const MAP_NAME = "avking.map";
const MAP_HEADER = /^\/\/([A-Z]+) FILES = (\d+)/;
/** Only these archive names have a name list, and each picks a different section of it. */
const CG_ARCHIVE = "cg";
const VOICE_ARCHIVE = "voice";
const CG_MAP_TYPES = new Set(["BG", "CHR"]);
const VOICE_MAP_TYPE = "VOICE";

export const hedDescriptor: FormatDescriptor = {
	id: "elf-hed",
	name: "elf AV King resource archive",
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
			source: "ArcFormats/elf/ArcHED.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface NameMaps {
	readonly cg: string[];
	readonly voice: string[];
}

/**
 * GARBro's `ReadMap`. The name list is a sequence of blocks, each opened by a header line of the form
 * `//<TYPE> FILES = <count>` and followed by exactly that many name lines. A `BG` or `CHR` block fills the
 * graphic list and a `VOICE` block the voice one, while any other type still has its names *consumed* and
 * discarded, so an unknown block does not desynchronise the parse. Every line is either a header or a
 * consumed name; anything else rejects the map, which is why a stray blank line is fatal here. Names have
 * trailing nulls trimmed.
 */
export function parseNameMap(text: string): NameMaps | undefined {
	const lines = text.split(/\r?\n/);
	const cg: string[] = [];
	const voice: string[] = [];
	let position = 0;
	while (position < lines.length) {
		const line = lines[position] ?? "";
		if (line.length === 0 && position === lines.length - 1) break;
		const match = MAP_HEADER.exec(line);
		if (!match) return undefined;
		const type = match[1] ?? "";
		const count = Number.parseInt(match[2] ?? "0", 10);
		if (!Number.isSafeInteger(count) || count < 0) return undefined;
		let target: string[] | undefined;
		if (CG_MAP_TYPES.has(type)) target = cg;
		else if (type === VOICE_MAP_TYPE) target = voice;
		position += 1;
		for (let index = 0; index < count; index += 1) {
			const name = lines[position];
			if (name === undefined) return undefined;
			target?.push(name.replace(/\0+$/, ""));
			position += 1;
		}
	}
	if (cg.length === 0 && voice.length === 0) return undefined;
	return { cg, voice };
}

/** GARBro's `GetFileMap`: the name list is looked for upwards from the archive's own directory. */
function findNameMap(startPath: string): NameMaps | undefined {
	let directory = dirname(resolve(startPath));
	for (;;) {
		const candidate = resolve(directory, MAP_NAME);
		if (existsSync(candidate)) {
			return parseNameMap(readFileSync(candidate, "latin1"));
		}
		const parent = dirname(directory);
		if (parent === directory) return undefined;
		directory = parent;
	}
}

/**
 * GARBro `PakOpener.TryOpen`. The archive itself is a plain payload file whose data is described by two
 * companions: a `.pak` file holding the index, and an `avking.map` name list found by walking upwards from the
 * archive's directory. Only archives named `cg` or `voice` are handled, and the map section that applies is
 * chosen by that name.
 *
 * The index begins with the four bytes `hed` and a null, then an entry count that must equal the number of
 * names the map supplied for this archive. Graphic indexes use eight-byte records of an offset and a size,
 * while voice indexes use 0x18-byte records whose first eight bytes hold the same pair; the reference reads
 * only those first bytes, and the port mirrors that. Every entry is checked against the *archive's* own length,
 * since that is the file the offsets address, and payloads are stored verbatim.
 */
async function readHedIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	const indexPath = changeExtension(sourcePath, INDEX_EXTENSION);
	if (indexPath === sourcePath) return undefined;
	const archiveName = basename(indexPath).replace(/\.[^.]*$/, "");
	if (archiveName !== CG_ARCHIVE && archiveName !== VOICE_ARCHIVE)
		return undefined;
	const index = await readCompanionFile(sourcePath, basename(indexPath));
	if (!index || index.length < INDEX_OFFSET) return undefined;
	if (index.readUInt32LE(0) !== INDEX_MAGIC) return undefined;
	const count = index.readInt32LE(INDEX_COUNT_OFFSET);
	const maps = findNameMap(sourcePath);
	if (!maps) return undefined;
	const names = archiveName === CG_ARCHIVE ? maps.cg : maps.voice;
	if (names.length !== count) return undefined;

	const recordSize =
		archiveName === CG_ARCHIVE ? CG_RECORD_SIZE : VOICE_RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + count * recordSize) > BigInt(index.length))
		return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = INDEX_OFFSET + id * recordSize;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const name = names[id] ?? "";
		if (name.length === 0) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries;
}

/** GARBro installs no entry decoder for this format, so payloads are emitted as stored. */
export const hedFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hedDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readHedIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readHedIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid elf AV King layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
