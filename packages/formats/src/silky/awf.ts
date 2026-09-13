// Format reference: GARbro ArcFormats/Silky/ArcAWF.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const EXTENSION = "awf";
const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x34;
const NAME_SIZE = 0x20;
const OFFSET_OFFSET = 0x20;
const SIZE_OFFSET = 0x24;
/** GARbro prepends a fixed 44-byte PCM header to every non-MP3 payload. */
const WAV_HEADER_SIZE = 0x2c;
const MP3_FILE_NAME = "voice.awf";
const MP3_EXTENSION = "mp3";
const SAMPLE_RATE = 22050;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;

export const awfDescriptor: FormatDescriptor = {
	id: "silky-awf",
	name: "Silky's audio archive",
	extensions: ["awf"],
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
			source: "ArcFormats/Silky/ArcAWF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `AwfOpener.TryOpen`. The archive is registered for the `awf` extension and holds a 32-bit
 * record count at 0 and 0x34-byte records from 4: a 0x20-byte name, the data offset at +0x20, and
 * the size at +0x24.
 *
 * GARbro decides from the file name whether the payloads are MP3 data: `voice.awf` gets `.mp3`
 * names, everything else is raw PCM that receives a generated WAV header on extraction. The port
 * accounts for that header in the entry size so extraction can verify the declared length.
 */
async function readAwfIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const isMp3 = basename(sourcePath).toLowerCase() === MP3_FILE_NAME;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		let name = decodeCStringField(index, record, NAME_SIZE);
		if (isMp3) name = `${name.replace(/\.[^./\\]*$/, "")}.${MP3_EXTENSION}`;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		const stored = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		if (!checkPlacement(offset, stored, source.size)) return undefined;
		const withHeader = !isMp3;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: withHeader ? stored + BigInt(WAV_HEADER_SIZE) : stored,
			packedSize: stored,
			compressed: withHeader,
		});
		if (withHeader) entry.metadata = { generatedWavHeader: true };
		entries.push(entry);
	}
	return entries;
}

/** Builds the fixed PCM header GARbro writes in front of raw payloads. */
function buildWavHeader(dataSize: bigint): Buffer {
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(Number(dataSize) + (WAV_HEADER_SIZE - 8), 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(0x10, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(CHANNELS, 22);
	header.writeUInt32LE(SAMPLE_RATE, 24);
	header.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28);
	header.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
	header.writeUInt16LE(BITS_PER_SAMPLE, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(Number(dataSize), 40);
	return header;
}

const awfEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([buildWavHeader(entry.packedSize), payload]);
};

export const awfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: awfDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAwfIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAwfIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky AWF layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: awfEntryOpener,
});
