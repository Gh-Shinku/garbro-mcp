// Format reference: GARBro ArcFormats/Nejii/ArcPCD.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const EXTENSION = "pcd";
const MIN_SIZE = 0x30;
const CHANNELS_OFFSET = 0x12;
const SAMPLE_RATE_OFFSET = 0x14;
const BYTE_RATE_OFFSET = 0x18;
const BLOCK_ALIGN_OFFSET = 0x1c;
const BITS_OFFSET = 0x1e;
const MAX_CHANNELS = 2;
const NAME_SIZE = 0x10;
const WAVEFORMAT_OFFSET = 0x10;
const WAVEFORMAT_SIZE = 0x10;
const DATA_OFFSET = 0x20;
/** GARbro prepends a 40-byte RIFF header built from the stored wave format. */
const WAV_HEADER_SIZE = 40;
const VALID_BITS = new Set([8, 16]);

export const pcdDescriptor: FormatDescriptor = {
	id: "nejii-pcd",
	name: "NEJII engine resource archive",
	extensions: ["pcd"],
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
			source: "ArcFormats/Nejii/ArcPCD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PcdOpener.TryOpen`. The first record's wave format doubles as a layout check: one or two
 * channels, a byte rate that matches block alignment times sample rate, and 8 or 16 bits per sample.
 * Records chain through the file with a 0x10-byte name, the wave format at +0x10, a 0x20-byte
 * header, and the data offset and size at the end of that header.
 */
async function readPcdIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(MIN_SIZE)) return undefined;
	const header = await source.readAt(0n, DATA_OFFSET);
	const channels = header.readUInt16LE(CHANNELS_OFFSET);
	if (channels === 0 || channels > MAX_CHANNELS) return undefined;
	const sampleRate = header.readUInt32LE(SAMPLE_RATE_OFFSET);
	const byteRate = header.readUInt32LE(BYTE_RATE_OFFSET);
	const blockAlign = header.readUInt16LE(BLOCK_ALIGN_OFFSET);
	if (blockAlign * sampleRate !== byteRate) return undefined;
	const bits = header.readUInt16LE(BITS_OFFSET);
	if (!VALID_BITS.has(bits)) return undefined;

	const entries: FixedEntry[] = [];
	let offset = 0n;
	while (offset < source.size) {
		if (offset + BigInt(DATA_OFFSET) > source.size) return undefined;
		const record = await source.readAt(offset, DATA_OFFSET);
		const name = decodeCStringField(record, 0, NAME_SIZE);
		const entryOffset = offset + BigInt(DATA_OFFSET);
		if (entryOffset + 4n > source.size) return undefined;
		const stored = BigInt(
			(await source.readAt(entryOffset, 4)).readUInt32LE(0),
		);
		const packed = stored + 4n;
		if (!checkPlacement(entryOffset, packed, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset: entryOffset,
			size: packed + BigInt(WAV_HEADER_SIZE),
			packedSize: packed,
			compressed: true,
		});
		entry.metadata = { bitsPerSample: bits, channels, sampleRate };
		entries.push(entry);
		offset = entryOffset + packed;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARbro `PcdOpener.OpenEntry`: a RIFF header built from the record's own wave format. */
const pcdEntryOpener: FixedEntryOpener = async (source, entry) => {
	const waveFormat = await source.readAt(
		entry.offset - BigInt(WAVEFORMAT_OFFSET),
		WAVEFORMAT_SIZE,
	);
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	header.writeUInt32LE(0x46464952, 0); // 'RIFF'
	header.writeUInt32LE(Number(entry.size) + 0x20, 4);
	header.writeUInt32LE(0x45564157, 8); // 'WAVE'
	header.writeUInt32LE(0x20746d66, 12); // 'fmt '
	header.writeUInt32LE(WAVEFORMAT_SIZE, 16);
	waveFormat.copy(header, 20);
	header.writeUInt32LE(0x61746164, 36); // 'data'
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([header, payload]);
};

export const pcdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pcdDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readPcdIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readPcdIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NEJII PCD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pcdEntryOpener,
});
