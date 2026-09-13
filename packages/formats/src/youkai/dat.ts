// Format reference: GARBro ArcFormats/Youkai/ArcDAT.cs, classes `GrpDatOpener`, `SoundDatOpener` and
// `VoiceDatOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** Every variant is gated by the archive's extension, exactly like the reference. */
function isDatExtension(sourcePath: string): boolean {
	return extname(sourcePath).toLowerCase() === ".dat";
}

/** Names never exceed 0x100 bytes in any of the three layouts. */
const NAME_SIZE = 0x100;
const GRP_MAGIC = Buffer.from("ACMPRS03", "latin1");
const GRP_HEADER_SIZE = 0x20;
const GRP_RECORD_SIZE = 0x110;
const GRP_SIZE_FIELD = 0x100;
const GRP_OFFSET_FIELD = 0x104;
/** A packed group payload is a magic word, a 0x24-byte header and then the LZSS stream. */
const GRP_PACKED_SIZE_FIELD = 0x14;
const GRP_STREAM_OFFSET = 0x24;
const SOUND_RECORD_SIZE = NAME_SIZE + 4;
const VOICE_INDEX_START = 8;
const VOICE_RECORD_SIZE = NAME_SIZE + 8;

const ATTRIBUTION = {
	project: "GARbro",
	source: "ArcFormats/Youkai/ArcDAT.cs",
	license: "MIT",
	commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
} as const;

/** Reads a 0x100-byte CP932 name, which rejects an empty one. */
function readName(
	buffer: Buffer,
	offset: number,
	limit: number,
): string | undefined {
	if (offset + NAME_SIZE > limit) return undefined;
	const name = decodeCStringField(buffer, offset, NAME_SIZE);
	return name.length === 0 ? undefined : name;
}

/**
 * GARBro `GrpDatOpener.TryOpen`. After a count and a zero word comes a fixed-stride index at 0x20 whose
 * records name a payload, its stored size and its offset; payloads must start behind the index. A payload
 * that begins with `ACMPRS03` is an LZSS stream whose packed size stands at +0x14 and whose data starts at
 * +0x24.
 */
async function readGrpDat(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (!isDatExtension(sourcePath)) return undefined;
	if (source.size < BigInt(GRP_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, 8);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count) || header.readInt32LE(4) !== 0) return undefined;
	const dataStart = BigInt(GRP_HEADER_SIZE + count * GRP_RECORD_SIZE);
	if (dataStart >= source.size) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const cursor = BigInt(GRP_HEADER_SIZE + id * GRP_RECORD_SIZE);
		if (cursor + BigInt(GRP_RECORD_SIZE) > source.size) return undefined;
		const record = await source.readAt(cursor, GRP_RECORD_SIZE);
		const name = readName(record, 0, record.length);
		if (name === undefined) return undefined;
		const storedSize = BigInt(record.readUInt32LE(GRP_SIZE_FIELD));
		const offset = BigInt(record.readUInt32LE(GRP_OFFSET_FIELD));
		if (offset < dataStart) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		// The reference probes for the packed magic when an entry is opened; the port resolves it here so
		// that the listing reports compression and an unknown unpacked size.
		let compressed = false;
		if (offset + BigInt(GRP_MAGIC.length) <= source.size) {
			const probe = await source.readAt(offset, GRP_MAGIC.length);
			compressed = probe.equals(GRP_MAGIC);
		}
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset,
				size: storedSize,
				packedSize: storedSize,
				compressed,
				...(compressed ? { sizeKnown: false } : {}),
			}),
		);
	}
	return entries;
}

/**
 * GARBro `SoundDatOpener.TryOpen`. Records and payloads alternate from offset four, so an entry's payload
 * starts behind its own name and size field, and the last payload must end exactly at the end of the file.
 */
async function readSoundDat(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (!isDatExtension(sourcePath)) return undefined;
	if (source.size < 4n) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	let cursor = 4n;
	for (let id = 0; id < count; id += 1) {
		if (cursor + BigInt(SOUND_RECORD_SIZE) > source.size) return undefined;
		const record = await source.readAt(cursor, SOUND_RECORD_SIZE);
		const name = readName(record, 0, record.length);
		if (name === undefined) return undefined;
		const storedSize = BigInt(record.readUInt32LE(NAME_SIZE));
		const offset = cursor + BigInt(SOUND_RECORD_SIZE);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
		cursor = offset + storedSize;
	}
	if (cursor !== source.size) return undefined;
	return entries;
}

/**
 * GARBro `VoiceDatOpener.TryOpen`. A data offset opens the file and a count follows it; the index sits at
 * offset eight and must end before the data area. Unlike the other two layouts the payloads do not have to
 * start behind the index, only inside the file.
 */
async function readVoiceDat(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (!isDatExtension(sourcePath)) return undefined;
	if (source.size < VOICE_INDEX_START) return undefined;
	const header = await source.readAt(0n, VOICE_INDEX_START);
	const dataOffset = BigInt(header.readUInt32LE(0));
	const count = header.readInt32LE(4);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(VOICE_INDEX_START + count * VOICE_RECORD_SIZE) > dataOffset)
		return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const cursor = BigInt(VOICE_INDEX_START + id * VOICE_RECORD_SIZE);
		if (cursor + BigInt(VOICE_RECORD_SIZE) > source.size) return undefined;
		const record = await source.readAt(cursor, VOICE_RECORD_SIZE);
		const name = readName(record, 0, record.length);
		if (name === undefined) return undefined;
		const storedSize = BigInt(record.readUInt32LE(NAME_SIZE));
		const offset = BigInt(record.readUInt32LE(NAME_SIZE + 4));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
	}
	return entries;
}

/**
 * GARBro `GrpDatOpener.OpenEntry`. A payload that starts with the packed magic is an LZSS stream whose input
 * range is the packed size at +0x14 starting at +0x24; everything else is stored.
 */
const openGrpDatEntry: FixedEntryOpener = async (source, entry) => {
	if (entry.offset + BigInt(GRP_MAGIC.length) <= source.size) {
		const probe = await source.readAt(entry.offset, GRP_MAGIC.length);
		if (!probe.equals(GRP_MAGIC))
			return source.createReadStream(entry.offset, entry.packedSize);
		if (entry.offset + BigInt(GRP_STREAM_OFFSET) > source.size)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Truncated Youkai packed group payload",
			);
		const header = await source.readAt(entry.offset, GRP_STREAM_OFFSET);
		const packedSize = BigInt(header.readUInt32LE(GRP_PACKED_SIZE_FIELD));
		const streamOffset = entry.offset + BigInt(GRP_STREAM_OFFSET);
		if (!checkPlacement(streamOffset, packedSize, source.size))
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Youkai packed group payload lies outside the archive",
			);
		const input = await source.readAt(streamOffset, Number(packedSize));
		return Readable.from([inflateLzssAll(input)]);
	}
	return source.createReadStream(entry.offset, entry.packedSize);
};

export const youkaiDatGrpDescriptor: FormatDescriptor = {
	id: "youkai-dat-grp",
	name: "Youkai Tamanokoshi resource archive",
	extensions: ["dat"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [ATTRIBUTION],
};

export const youkaiDatSoundDescriptor: FormatDescriptor = {
	id: "youkai-dat-sound",
	name: "Youkai Tamanokoshi audio archive (sound bank)",
	extensions: ["dat"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [ATTRIBUTION],
};

export const youkaiDatVoiceDescriptor: FormatDescriptor = {
	id: "youkai-dat-voice",
	name: "Youkai Tamanokoshi audio archive (voice bank)",
	extensions: ["dat"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [ATTRIBUTION],
};

export const youkaiDatGrpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: youkaiDatGrpDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readGrpDat(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGrpDat(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Youkai DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openGrpDatEntry,
});

export const youkaiDatSoundFormat: ArchiveFormat = defineFixedArchive({
	descriptor: youkaiDatSoundDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readSoundDat(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSoundDat(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Youkai DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});

export const youkaiDatVoiceFormat: ArchiveFormat = defineFixedArchive({
	descriptor: youkaiDatVoiceDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readVoiceDat(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readVoiceDat(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Youkai DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
