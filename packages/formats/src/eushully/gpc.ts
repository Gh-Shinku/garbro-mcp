// Format reference: GARBro ArcFormats/Eushully/ArcGPC.cs, classes `HOpener`, `GpcOpener`, `SndOpener` and
// `SnrOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The companion index replaces the extension's last letter with `h`, keeping its case. */
const INDEX_SUFFIX = "H";
const NAME_MASK = 0xff;
/** A record is a one-byte length, the name, and a 32-bit offset. */
const OFFSET_SIZE = 4;
/** The SND variant synthesizes a RIFF header in front of its PCM data. */
const WAV_HEADER_SIZE = 0x2c;
const WAV_FMT_PAYLOAD_SIZE = 0x10;
const WAV_FMT_PAYLOAD_OFFSET = 1;
const WAV_DATA_SIZE_OFFSET = 0x11;
const WAV_DATA_OFFSET = 0x15;
const WAV_MINIMUM_SIZE = 0x16;
const WAV_DATA_SIZE_TAIL = 0x24;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/Eushully/ArcGPC.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export const gpcDescriptor: FormatDescriptor = {
	id: "eushully-gpc",
	name: "Eushully graphic archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const sndDescriptor: FormatDescriptor = {
	id: "eushully-snd",
	name: "Eushully audio archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const snrDescriptor: FormatDescriptor = {
	id: "eushully-snr",
	name: "Eushully script archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

/**
 * GARBro `HOpener.TryOpenWithIndex`. The archive itself carries neither a signature nor stored sizes: the
 * index lives in a companion file whose name takes the archive's three-letter extension, drops its last
 * letter and appends `h`, so a `.gpc` archive is indexed by `.gph`. An archive whose extension is already
 * four characters long, or whose last character is `h`, is not treated this way, which keeps the index files
 * from being read as archives themselves.
 *
 * Each index record is a one-byte name length, that many name bytes with every bit inverted, and a 32-bit
 * data offset. The names are CP932 and the reference appends a fixed extension to each, which is how the
 * graphic and audio archives reach their own extensions. Offsets are then sorted, so a record's size is the
 * gap to the next offset and the last one runs to the end of the file.
 *
 * The reference reads the uppercased companion name, which relies on a case-insensitive filesystem; the port
 * tries that form first and then the lowercased one so case-sensitive systems work too.
 */
async function readEushullyIndex(
	source: ByteSource,
	sourcePath: string,
	entryExtension: string,
	entryType: string,
): Promise<FixedEntry[] | undefined> {
	const extension = sourceExtension(sourcePath);
	if (extension.length !== 3) return undefined;
	if (extension.endsWith("h")) return undefined;
	const stem = extension.slice(0, 2);
	const candidates = [
		`${stem}${INDEX_SUFFIX}`,
		`${stem}${INDEX_SUFFIX.toLowerCase()}`,
	];
	let index: Buffer | undefined;
	for (const candidate of candidates) {
		index = await readCompanionFile(
			sourcePath,
			changeExtension(sourcePath, candidate),
		);
		if (index) break;
	}
	if (!index) return undefined;

	const entries: FixedEntry[] = [];
	let position = 0;
	while (position < index.length) {
		const nameLength = index.readUInt8(position);
		position += 1;
		if (position + nameLength + OFFSET_SIZE > index.length) return undefined;
		const nameBytes = Buffer.from(
			index.subarray(position, position + nameLength),
		);
		for (let byte = 0; byte < nameBytes.length; byte += 1)
			nameBytes[byte] = ~(nameBytes[byte] ?? 0) & NAME_MASK;
		const name = `${decodeCp932(nameBytes)}${entryExtension}`;
		position += nameLength;
		const offset = BigInt(index.readUInt32LE(position));
		position += OFFSET_SIZE;
		if (offset > source.size) return undefined;
		if (name.length === entryExtension.length) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size: 0n,
				metadata: { inferredType: entryType },
			}),
		);
	}
	if (entries.length === 0) return undefined;

	entries.sort((left, right) =>
		left.offset < right.offset ? -1 : left.offset > right.offset ? 1 : 0,
	);
	for (const [index0, entry] of entries.entries()) {
		const next = entries[index0 + 1]?.offset ?? source.size;
		if (next < entry.offset) return undefined;
		entry.size = next - entry.offset;
	}
	return entries;
}

/** GARBro `SndOpener.OpenEntry`: a RIFF header is synthesized in front of the payload's PCM data. */
async function openSndEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (entry.size < BigInt(WAV_MINIMUM_SIZE)) {
		return source.createReadStream(entry.offset, entry.size);
	}
	const dataSize = BigInt(
		(
			await source.readAt(entry.offset + BigInt(WAV_DATA_SIZE_OFFSET), 4)
		).readUInt32LE(0),
	);
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	const fmt = await source.readAt(
		entry.offset + BigInt(WAV_FMT_PAYLOAD_OFFSET),
		WAV_FMT_PAYLOAD_SIZE,
	);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(Number(dataSize) + WAV_DATA_SIZE_TAIL, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 0x0c, "ascii");
	header.writeUInt32LE(WAV_FMT_PAYLOAD_SIZE, 0x10);
	fmt.copy(header, 0x14);
	header.write("data", 0x24, "ascii");
	header.writeUInt32LE(Number(dataSize), 0x28);
	const pcm = source.createReadStream(
		entry.offset + BigInt(WAV_DATA_OFFSET),
		dataSize,
	);
	return Readable.from(
		(async function* () {
			yield header;
			for await (const chunk of pcm) yield chunk as Buffer;
		})(),
	);
}

/** GARBro `GpcOpener.TryOpen`: graphic entries, whose names gain a `.gpcf` extension. */
async function readGpcIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	return readEushullyIndex(source, sourcePath, ".gpcf", "image");
}

/** GARBro `SnrOpener.TryOpen`: script entries, whose names are used as stored. */
async function readSnrIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	return readEushullyIndex(source, sourcePath, "", "script");
}

/** GARBro `SndOpener.TryOpen`: audio entries, whose names gain a `.wav` extension. */
async function readSndIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const entries = await readEushullyIndex(source, sourcePath, ".wav", "audio");
	if (!entries) return undefined;
	for (const entry of entries) {
		// The synthesized header makes the extracted span differ from the stored one.
		if (entry.size >= BigInt(WAV_MINIMUM_SIZE)) entry.sizeKnown = false;
	}
	return entries;
}

/** The graphic archive stores its payloads verbatim. */
async function openGpcEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	return source.createReadStream(entry.offset, entry.size);
}

export const gpcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gpcDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGpcIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGpcIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Eushully GPC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openGpcEntry,
});

export const snrFormat: ArchiveFormat = defineFixedArchive({
	descriptor: snrDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSnrIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSnrIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Eushully SNR layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openGpcEntry,
});

export const sndFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sndDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSndIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSndIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Eushully SND layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openSndEntry,
});
