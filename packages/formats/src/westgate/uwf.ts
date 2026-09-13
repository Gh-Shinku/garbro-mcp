// Format reference: GARBro Legacy/WestGate/ArcUWF.cs, class `UwfOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readWestGateIndex } from "./index-reader.js";

const EXTENSIONS = ["uwf", "arc"];
const MIN_FILE_SIZE = 0x1500;
const INDEX_OFFSET = 0x14f0;
const FIRST_OFFSET_FIELD = 0x14fc;
const RECORD_SIZE = 0x10;
/** The synthesized header is `RIFF`, a size, `WAVE`, `fmt `, a size and the format block, then `data`. */
const RIFF_HEADER_SIZE = 0x1c;
const PCM_SIZE_FIELD = 2;
const RIFF_MAGIC = Buffer.from("RIFF", "ascii");
const WAVE_MAGIC = Buffer.from("WAVE", "ascii");
const FMT_MAGIC = Buffer.from("fmt ", "ascii");
const DATA_MAGIC = Buffer.from("data", "ascii");

export const uwfDescriptor: FormatDescriptor = {
	id: "westgate-uwf",
	name: "West Gate audio archive",
	extensions: EXTENSIONS,
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
			source: "Legacy/WestGate/ArcUWF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `UwfOpener.TryOpen`. The archive reserves a fixed 0x1500-byte head, and the word at 0x14FC must
 * land inside the file and at or behind that head. The entry count is then derived from how far that
 * word sits beyond the index start at 0x14F0, divided by the record width, and the index is read through
 * the shared WestGate reader that the UCA graphics archive also uses.
 *
 * `UwfOpener.OpenEntry` rewrites each payload as a RIFF/WAVE stream: the format block length sits at the
 * entry start, the PCM length follows that block, and the reference emits a synthesized 28-byte header,
 * the format block, the `data` magic, and then the PCM length word together with the PCM bytes. When
 * either length does not fit inside the entry it falls back to a verbatim copy. The port detects that
 * case while reading the index so listing and extraction agree, marks those entries as having an
 * inexact size because the output is longer than the stored span, and synthesizes the same layout.
 */
async function readUwfIndex(source: ByteSource, sourcePath: string) {
	if (
		sourceExtension(sourcePath) !== "uwf" &&
		sourceExtension(sourcePath) !== "arc"
	)
		return undefined;
	if (source.size <= BigInt(MIN_FILE_SIZE)) return undefined;
	const firstOffset = BigInt(
		(await source.readAt(BigInt(FIRST_OFFSET_FIELD), 4)).readUInt32LE(0),
	);
	if (firstOffset >= source.size || firstOffset < BigInt(MIN_FILE_SIZE))
		return undefined;
	const count = Number(
		(firstOffset - BigInt(INDEX_OFFSET)) / BigInt(RECORD_SIZE),
	);
	const entries = await readWestGateIndex(source, {
		indexOffset: INDEX_OFFSET,
		count,
		entryType: "audio",
	});
	if (!entries) return undefined;
	for (const entry of entries) {
		if (entry.size <= BigInt(PCM_SIZE_FIELD + 4)) continue;
		const fmtSize = Number(
			(await source.readAt(entry.offset, 2)).readUInt16LE(0),
		);
		if (BigInt(fmtSize) >= entry.size) continue;
		const pcmLength = (
			await source.readAt(entry.offset + BigInt(PCM_SIZE_FIELD + fmtSize), 4)
		).readUInt32LE(0);
		if (BigInt(pcmLength) >= entry.size) continue;
		entry.metadata = {
			...entry.metadata,
			synthesizedWav: true,
			formatSize: fmtSize,
			pcmSize: pcmLength,
		};
		entry.sizeKnown = false;
	}
	return entries;
}

/** GARBro `UwfOpener.OpenEntry`: payloads are wrapped in a RIFF header in front of their PCM bytes. */
async function openUwfEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (entry.metadata?.synthesizedWav !== true)
		return source.createReadStream(entry.offset, entry.size);
	const fmtSize =
		typeof entry.metadata.formatSize === "number"
			? entry.metadata.formatSize
			: 0;
	const pcmSize =
		typeof entry.metadata.pcmSize === "number" ? entry.metadata.pcmSize : 0;
	const fmt = await source.readAt(
		entry.offset + BigInt(PCM_SIZE_FIELD),
		fmtSize,
	);
	const header = Buffer.alloc(RIFF_HEADER_SIZE - 4 + fmtSize);
	let position = 0;
	RIFF_MAGIC.copy(header, position);
	position += RIFF_MAGIC.length;
	// GARbro writes `0x1C + fmt_size + pcm_size` as the RIFF size, which the port mirrors exactly.
	header.writeUInt32LE(RIFF_HEADER_SIZE + fmtSize + pcmSize, position);
	position += 4;
	WAVE_MAGIC.copy(header, position);
	position += WAVE_MAGIC.length;
	FMT_MAGIC.copy(header, position);
	position += FMT_MAGIC.length;
	header.writeUInt32LE(fmtSize, position);
	position += 4;
	fmt.copy(header, position);
	position += fmtSize;
	DATA_MAGIC.copy(header, position);
	const pcm = source.createReadStream(
		entry.offset + BigInt(PCM_SIZE_FIELD + fmtSize),
		BigInt(pcmSize) + 4n,
	);
	return Readable.from(
		(async function* () {
			yield header;
			for await (const chunk of pcm) yield chunk as Buffer;
		})(),
	);
}

export const uwfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: uwfDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readUwfIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readUwfIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid West Gate UWF layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openUwfEntry,
});
