// Format reference: GARbro "Legacy/Lune/ArcPACK.cs", class `PackOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { writeRiffHeader } from "../kapp/asd.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Little endian records hold the offset and the stored size; the index is the first span of them. */
const RECORD_SIZE = 8;
/** `first_offset` has to be larger than this and a multiple of the record size. */
const MIN_FIRST_OFFSET = 8;
const RECORD_ALIGNMENT = 7;
/** `base_name` is replaced by the file extension without its dot when it reads as this. */
const GENERIC_BASE_NAME = "pack";
const AUDIO_EXTENSIONS = new Set(["wda", "bgm"]);
const SCRIPT_EXTENSIONS = new Set(["scr"]);
const WDA_SAMPLE_RATE = 22050;
const BGM_SAMPLE_RATE = 44100;
/** The reference builds a mono, sixteen bit PCM format. */
const PCM_CHANNELS = 1;
const PCM_BLOCK_ALIGN = 2;
const PCM_BITS_PER_SAMPLE = 16;
const PCM_FORMAT_TAG = 1;

interface LuneEntry {
	index: number;
	path: string;
	type: string;
	offset: bigint;
	size: bigint;
	/** Sample rate of the RIFF wrapper for audio archives, zero for stored entries. */
	sampleRate: number;
}

/** GARbro `PackOpener.TryOpen`: an index of offset and size pairs at the head of the file. */
async function readLuneIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<LuneEntry[] | undefined> {
	if (source.size < BigInt(MIN_FIRST_OFFSET + RECORD_SIZE)) return undefined;
	const head = Buffer.from(await source.readAt(0n, 4));
	const firstOffset = head.readUInt32LE(0);
	if (firstOffset <= MIN_FIRST_OFFSET || BigInt(firstOffset) >= source.size)
		return undefined;
	if ((firstOffset & RECORD_ALIGNMENT) !== 0) return undefined;
	const count = firstOffset / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	const index = Buffer.from(await source.readAt(0n, count * RECORD_SIZE));
	const extension = sourceExtension(sourcePath);
	const isAudio = AUDIO_EXTENSIONS.has(extension);
	const type = isAudio
		? "audio"
		: SCRIPT_EXTENSIONS.has(extension)
			? "script"
			: "image";
	let baseName = basename(sourcePath, `.${extension}`);
	if (baseName === GENERIC_BASE_NAME) baseName = extension;
	const sampleRate = extension === "bgm" ? BGM_SAMPLE_RATE : WDA_SAMPLE_RATE;
	const entries: LuneEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(position));
		const size = BigInt(index.readUInt32LE(position + 4));
		if (offset < BigInt(firstOffset)) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		// Zero sized records still consume an index slot but are not listed.
		if (size === 0n) continue;
		entries.push({
			index: i,
			path: `${baseName}#${String(i).padStart(5, "0")}`,
			type,
			offset,
			size,
			sampleRate: isAudio ? sampleRate : 0,
		});
	}
	const last = entries[entries.length - 1];
	if (!last || last.offset + last.size !== source.size) return undefined;
	return entries;
}

export const lunePackDescriptor: FormatDescriptor = {
	id: "lune-pack",
	name: "Lune Adv Game engine resource archive",
	extensions: ["dat", "wda"],
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
			source: "Legacy/Lune/ArcPACK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lunePackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lunePackDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLuneIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const parsed = await readLuneIndex(source, sourcePath);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Lune Adv Game layout");
		const entries: FixedEntry[] = parsed.map((entry) => {
			const created = createFixedEntry({
				id: entry.index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				metadata: {
					type: entry.type,
					sampleRate: entry.sampleRate,
				} as Record<string, unknown>,
			});
			// Audio entries gain a RIFF header on extraction, so their stored size is not final.
			return entry.sampleRate > 0 ? { ...created, sizeKnown: false } : created;
		});
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				type: parsed[0]?.type ?? "image",
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = (entry.metadata ?? {}) as {
			sampleRate?: number;
			type?: string;
		};
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const sampleRate = metadata.sampleRate ?? 0;
		if (sampleRate <= 0) return Readable.from([data]);
		const header = writeRiffHeader(
			{
				formatTag: PCM_FORMAT_TAG,
				channels: PCM_CHANNELS,
				sampleRate,
				averageBytesPerSecond: sampleRate * PCM_BLOCK_ALIGN,
				blockAlign: PCM_BLOCK_ALIGN,
				bitsPerSample: PCM_BITS_PER_SAMPLE,
			},
			data.length,
		);
		return Readable.from([header, data]);
	},
});
