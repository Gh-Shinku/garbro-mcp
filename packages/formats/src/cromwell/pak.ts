// Format reference: GARBro ArcFormats/Cromwell/ArcPAK.cs, class `GraphicPakOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const GRAPHIC_SIGNATURE = Buffer.from("Graphic PackData", "ascii");
const VOICE_SIGNATURE = Buffer.from("Voice PackData. ", "ascii");
const COUNT_OFFSET = 0x10;
const INDEX_OFFSET = 0x14;
const NAME_SIZE = 0xc;
const RECORD_SIZE = NAME_SIZE + 8;
const ZLIB_HEADER_SIZE = 4;
/** GARbro retypes this archive whenever the file itself is named `VOICE`. */
const VOICE_BASE_NAME = "voice";

export function isCromwellGraphicPak(header: Buffer): boolean {
	return header.subarray(0, GRAPHIC_SIGNATURE.length).equals(GRAPHIC_SIGNATURE);
}

export function isCromwellVoicePak(header: Buffer): boolean {
	return header.subarray(0, VOICE_SIGNATURE.length).equals(VOICE_SIGNATURE);
}

/**
 * GARbro `GraphicPakOpener.TryOpen`. Both the `Graphic PackData` and `Voice PackData. ` variants share
 * one layout: a record count at 0x10, then 0x14-byte records holding a 0xC-byte CP932 name, an absolute
 * payload offset and a declared unpacked size. The reference marks every entry as packed and derives
 * each stored extent from the next record's offset, with the last entry running to the end of the file.
 *
 * A graphic archive whose file is itself called `VOICE` counts as audio, which is the reference's way of
 * handling the voice pack that reuses the graphic signature.
 */
async function readCromwellPakIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const filePrefix = await source.readAt(0n, INDEX_OFFSET);
	const graphic = isCromwellGraphicPak(filePrefix);
	if (!graphic && !isCromwellVoicePak(filePrefix)) return undefined;
	const count = filePrefix.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexLength = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexLength) > source.size) return undefined;

	const index = await source.readAt(BigInt(INDEX_OFFSET), indexLength);
	const offsets: bigint[] = [];
	const unpackedSizes: bigint[] = [];
	const records: { name: string; id: number }[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		// The reference rejects records whose names are empty or whitespace only.
		if (name.trim().length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE));
		if (offset >= source.size) return undefined;
		records.push({ name, id });
		offsets.push(offset);
		unpackedSizes.push(BigInt(index.readUInt32LE(record + NAME_SIZE + 4)));
	}

	const baseName = (sourcePath ?? "")
		.split(/[\\/]/)
		.pop()
		?.replace(/\.[^.]*$/, "")
		.toLowerCase();
	const isGraphic = baseName === VOICE_BASE_NAME ? false : graphic;
	const type = isGraphic ? "image" : "audio";

	const entries: FixedEntry[] = [];
	for (const [position, record] of records.entries()) {
		const offset = offsets[position] ?? 0n;
		const nextOffset = offsets[position + 1] ?? source.size;
		// GARbro back-fills sizes from the next offset and lets the stream clamp anything that runs
		// past the end of the file.
		const declared = nextOffset - offset;
		const clamped = declared > 0n ? declared : source.size - offset;
		if (!checkPlacement(offset, clamped, source.size)) return undefined;
		const entry = createFixedEntry({
			id: record.id,
			...normalizeEntryPath(record.name),
			offset,
			size: unpackedSizes[position] ?? 0n,
			packedSize: clamped,
			compressed: true,
			metadata: { type },
		});
		// The reference streams the zlib payload to its end, so the stored size is only a hint.
		entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/** GARbro `GraphicPakOpener.OpenEntry`: every payload is a raw zlib stream over its stored extent. */
const cromwellPakEntryOpener: FixedEntryOpener = async (source, entry) => {
	const input = source.createReadStream(entry.offset, entry.packedSize);
	if (entry.packedSize < BigInt(ZLIB_HEADER_SIZE)) return input;
	return createZlibInflateStream(input);
};

export const cromwellPakDescriptor: FormatDescriptor = {
	id: "cromwell-pak",
	name: "cromwell graphic resource archive",
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
			source: "ArcFormats/Cromwell/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cromwellPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cromwellPakDescriptor,
	detection: {
		signatures: [{ bytes: GRAPHIC_SIGNATURE }, { bytes: VOICE_SIGNATURE }],
	},
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readCromwellPakIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCromwellPakIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid cromwell PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: cromwellPakEntryOpener,
});
