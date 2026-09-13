// Format reference: GARBro ArcFormats/DDSystem/ArcDDP.cs, classes `Ddp2Opener` and `Ddp3Opener`, with
// `Him4Opener.DetectFileTypes` from ArcFormats/SHSystem/ArcHXP.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	buildShsEntry,
	decompressShs,
	readShsSections,
} from "../shsystem/hxp.js";

const EXTENSION = "dat";
const COUNT_OFFSET = 4;
const WORD_SIZE = 4;
const GENERATED_NAME_DIGITS = 5;

const DDP2_SIGNATURE = Buffer.from("DDP2", "ascii");
const DDP2_INDEX_OFFSET = 0x20;
/** A version two record is an offset and two sizes, with four bytes to spare. */
const DDP2_RECORD_SIZE = 0x10;
const DDP2_OFFSET_FIELD = 0;
const DDP2_UNPACKED_FIELD = 4;
const DDP2_SIZE_FIELD = 8;

const DDP3_SIGNATURE = Buffer.from("DDP3", "ascii");
const DDP3_INDEX_OFFSET = 0x20;
const DDP3_SECTION_RECORD_SIZE = 8;
/** A version three section entry carries a length, an offset, both sizes and a name. */
const DDP3_ENTRY_OFFSET_FIELD = 1;
const DDP3_ENTRY_UNPACKED_FIELD = 5;
const DDP3_ENTRY_SIZE_FIELD = 9;
const DDP3_ENTRY_NAME_OFFSET = 17;
const MINIMUM_ENTRY_SIZE = 17;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/DDSystem/ArcDDP.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
	{
		project: "GARbro",
		source: "ArcFormats/SHSystem/ArcHXP.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export const ddp2Descriptor: FormatDescriptor = {
	id: "ddsystem-ddp2",
	name: "DDSystem engine resource archive",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const ddp3Descriptor: FormatDescriptor = {
	id: "ddsystem-ddp3",
	name: "DDSystem engine resource archive, version 3",
	extensions: [EXTENSION],
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
 * GARBro `Ddp2Opener.TryOpen`. The count sits at 4 and sixteen-byte records follow at 0x20, each holding the
 * data offset, an unpacked size and a stored size. `Him4Opener.DetectFileTypes` then re-reads those sizes from
 * the payload itself, so the index's two size words are effectively hints: what extraction uses is the pair
 * stored inside the payload, and the entry's data begins eight bytes into it.
 *
 * Entries carry generated five-digit names. The reference also probes each payload's first bytes to classify it
 * through its catalog, which the port leaves out.
 */
async function readDdp2Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(DDP2_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, DDP2_INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(DDP2_SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * DDP2_RECORD_SIZE;
	if (BigInt(DDP2_INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(DDP2_INDEX_OFFSET), indexSize);
	const baseName = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * DDP2_RECORD_SIZE;
		const hintOffset = BigInt(index.readUInt32LE(record + DDP2_OFFSET_FIELD));
		if (hintOffset > source.size) return undefined;
		const entry = await buildShsEntry(source, id, hintOffset, source.size);
		if (!entry) return undefined;
		entry.path = `${baseName}#${String(id).padStart(GENERATED_NAME_DIGITS, "0")}`;
		entry.metadata = {
			...entry.metadata,
			indexUnpackedSize: index.readUInt32LE(record + DDP2_UNPACKED_FIELD),
			indexSize: index.readUInt32LE(record + DDP2_SIZE_FIELD),
		};
		entries.push(entry);
	}
	return entries;
}

/**
 * GARBro `Ddp3Opener.TryOpen`. The count sits at 4 and `Him5Opener.ReadIndex` reads the section descriptors
 * that follow at 0x20, so this version builds on the version five layout: a zero-sized descriptor is skipped
 * and each section is walked until its size runs out. A section entry begins with its own length, which must be
 * at least seventeen or the walk stops, and holds a little-endian offset, an unpacked size, a stored size and a
 * name behind them.
 *
 * As in version two the payload's own size pair is what extraction follows, and the entry's data begins eight
 * bytes into the payload. The sizes the index carries are kept as metadata, the reference's content-signature
 * classification is left out, and a blank name rejects the archive, which the reference does not enforce.
 */
async function readDdp3Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(DDP3_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, DDP3_INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(DDP3_SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * DDP3_SECTION_RECORD_SIZE;
	if (BigInt(DDP3_INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(DDP3_INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (const section of readShsSections(index, count)) {
		let position = section.offset;
		let remaining = section.size;
		while (remaining > 0) {
			if (BigInt(position) + 1n > source.size) return undefined;
			const lengthField = await source.readAt(BigInt(position), 1);
			const entrySize = lengthField.readUInt8(0);
			if (entrySize < MINIMUM_ENTRY_SIZE) break;
			if (BigInt(position + entrySize) > source.size) return undefined;
			const body = await source.readAt(BigInt(position), entrySize);
			const offset = BigInt(body.readUInt32LE(DDP3_ENTRY_OFFSET_FIELD));
			if (offset > source.size) return undefined;
			const nameField = body.subarray(DDP3_ENTRY_NAME_OFFSET);
			const terminator = nameField.indexOf(0);
			const name = decodeCp932(
				terminator === -1 ? nameField : nameField.subarray(0, terminator),
			);
			if (name.length === 0) return undefined;
			const entry = await buildShsEntry(
				source,
				entries.length,
				offset,
				source.size,
			);
			if (!entry) return undefined;
			Object.assign(entry, normalizeEntryPath(name));
			entry.metadata = {
				...entry.metadata,
				indexUnpackedSize: body.readUInt32LE(DDP3_ENTRY_UNPACKED_FIELD),
				indexSize: body.readUInt32LE(DDP3_ENTRY_SIZE_FIELD),
			};
			entries.push(entry);
			position += entrySize;
			remaining -= entrySize;
		}
	}
	return entries;
}

/** GARBro `Ddp2Opener`'s inherited `OpenEntry`: compressed payloads use the SH System codec. */
async function openDdpEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([decompressShs(stored, Number(entry.size))]);
}

export const ddp2Format: ArchiveFormat = defineFixedArchive({
	descriptor: ddp2Descriptor,
	detection: { signatures: [{ bytes: DDP2_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readDdp2Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDdp2Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DDSystem DDP2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openDdpEntry,
});

export const ddp3Format: ArchiveFormat = defineFixedArchive({
	descriptor: ddp3Descriptor,
	detection: { signatures: [{ bytes: DDP3_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDdp3Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDdp3Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DDSystem DDP3 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openDdpEntry,
});
