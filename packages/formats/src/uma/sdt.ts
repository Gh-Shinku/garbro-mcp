// Format reference: GARbro Legacy/Uma/ArcSDT.cs, class `SdtOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	readCStringAt,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** The format only opens files named `.sdt` whose first word is zero or one. */
const EXTENSION = "sdt";
const MAXIMUM_NAME_LENGTH = 0x100;
/** Synthesized RIFF prefix: `RIFF`, size, `WAVE`, `fmt `, size, then the format block. */
const RIFF_PREFIX_SIZE = 0x14;
const RIFF_TRAILER_SIZE = 8;
/** GARbro adds this to the stored span for the `RIFF` size word. */
const RIFF_SIZE_BIAS = 0x18;

export const sdtDescriptor: FormatDescriptor = {
	id: "uma-sdt",
	name: "Uma audio archive",
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
			source: "Legacy/Uma/ArcSDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface SdtMetadata {
	headerSize: number;
	/** The `size` word GARbro stores as the unpacked size and reuses as the `data` chunk size. */
	dataSize: string;
	type: "audio";
}

function sdtMetadata(entry: FixedEntry): SdtMetadata {
	const metadata = entry.metadata ?? {};
	return {
		headerSize: Number(metadata.headerSize ?? 0),
		dataSize: String(metadata.dataSize ?? "0"),
		type: "audio",
	};
}

/**
 * GARbro `SdtOpener.TryOpen`. The file is a flat run of records with no index: a packed flag, a size
 * word, a null-terminated CP932 name, and a header size. The record's stored span is the header size
 * plus the size word, and the following record starts after it. GARbro requires the first word to be
 * zero or one and the name to be non-blank, and checks every record against the file.
 */
async function readSdtIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < 4n) return undefined;
	const first = (await source.readAt(0n, 4)).readInt32LE(0);
	if (first !== 0 && first !== 1) return undefined;

	const entries: FixedEntry[] = [];
	let position = 0n;
	let id = 0;
	while (position < source.size) {
		if (position + 8n > source.size) return undefined;
		const record = await source.readAt(position, 8);
		const packed = record.readInt32LE(0);
		if (packed !== 0 && packed !== 1) return undefined;
		const dataSize = BigInt(record.readUInt32LE(4));
		const { value: name, end } = await readCStringAt(
			source,
			position + 8n,
			MAXIMUM_NAME_LENGTH,
		);
		if (name.trim().length === 0) return undefined;
		if (end + 4n > source.size) return undefined;
		const headerSize = BigInt((await source.readAt(end, 4)).readUInt32LE(0));
		const offset = end + 4n;
		const storedSize = headerSize + dataSize;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: BigInt(RIFF_PREFIX_SIZE + RIFF_TRAILER_SIZE) + storedSize,
			packedSize: storedSize,
			compressed: packed !== 0,
			metadata: {
				headerSize: Number(headerSize),
				dataSize: dataSize.toString(),
				/** GARbro calls `ChangeType (AudioFormat.Wav)`, so every entry is audio. */
				type: "audio",
			} satisfies SdtMetadata,
		});
		if (entry.compressed) entry.sizeKnown = false;
		entries.push(entry);
		position = offset + storedSize;
		id += 1;
	}
	return entries;
}

/**
 * GARbro `SdtOpener.OpenEntry`. The reference emits a synthesized RIFF/WAVE stream: `RIFF`, the stored
 * span plus 0x18, `WAVE`, `fmt `, the header length, the stored format block, `data`, the size word,
 * and finally the payload — raw bytes for stored entries, a default LZSS stream for packed ones. The
 * declared sizes are copied verbatim, including GARbro's bias, so the output matches the reference
 * byte for byte even though those sizes can disagree with the emitted length.
 */
const sdtEntryOpener: FixedEntryOpener = async (source, entry) => {
	const { headerSize, dataSize } = sdtMetadata(entry);
	const header = await source.readAt(entry.offset, headerSize);
	const stored = await source.readAt(
		entry.offset + BigInt(headerSize),
		bigintToBufferLength(entry.packedSize - BigInt(headerSize), "Uma SDT data"),
	);
	const data = entry.compressed ? inflateLzssAll(stored) : stored;
	const output = Buffer.alloc(
		RIFF_PREFIX_SIZE + headerSize + RIFF_TRAILER_SIZE + data.length,
	);
	output.write("RIFF", 0, "ascii");
	output.writeUInt32LE(
		Number((entry.packedSize + BigInt(RIFF_SIZE_BIAS)) & 0xffffffffn),
		4,
	);
	output.write("WAVE", 8, "ascii");
	output.write("fmt ", 0x0c, "ascii");
	output.writeUInt32LE(headerSize, 0x10);
	header.copy(output, RIFF_PREFIX_SIZE);
	const trailer = RIFF_PREFIX_SIZE + headerSize;
	output.write("data", trailer, "ascii");
	output.writeUInt32LE(Number(BigInt(dataSize) & 0xffffffffn), trailer + 4);
	data.copy(output, trailer + RIFF_TRAILER_SIZE);
	return Readable.from([output]);
};

export const sdtFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sdtDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSdtIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSdtIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Uma SDT layout");
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: sdtEntryOpener,
});
