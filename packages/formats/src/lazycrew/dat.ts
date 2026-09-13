// Format reference: GARbro Legacy/Lazycrew/ArcDAT.cs, class `DatOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Volumes are named `0001.dat` upwards or `data`, `data2`, and so on. */
const NAME_PATTERN = /^(?:(0\d{3})\.dat|data(\d+)?)$/i;
const INDEX_NAME = "0001.dat";
const FALLBACK_INDEX_NAME = "data";
const DIR_COUNT_LIMIT = 20;
const DIR_RECORD_SIZE = 0x10;
const DIR_NAME_SIZE = 8;
const DIR_FIRST_OFFSET = 4;
const DIR_OFFSET_FIELD = 8;
const DIR_COUNT_FIELD = 12;
const ENTRY_RECORD_SIZE = 10;
const ENTRY_VOLUME_FIELD = 0;
const ENTRY_OFFSET_FIELD = 2;
const ENTRY_SIZE_FIELD = 6;
const ENTRY_NAME_DIGITS = 5;
const AUDIO_SIGNATURES = [0, 0x10000];
const AUDIO_STRIPPED_SIGNATURES = [1, 0x10001];
const PCM_KEY = 0x4b5ab4a5;
const RIFF_HEADER_SIZE = 0x2c;
const RIFF_FORMAT_OFFSET = 4;
const RIFF_FORMAT_SIZE = 0x10;
const RIFF_DATA_SIZE_FIELD = 0x16;
const RIFF_PCM_OFFSET = 0x1a;

interface LazycrewEntry {
	name: string;
	offset: bigint;
	size: bigint;
	type: string | undefined;
}

/** `DatOpener.TryOpen` derives the volume number from the file name. */
export function lazycrewVolumeId(sourcePath: string): number | undefined {
	const name = sourcePath.split(/[\\/]/).pop() ?? "";
	const match = NAME_PATTERN.exec(name);
	if (!match) return undefined;
	const digits = match[1] ?? match[2];
	const id = digits === undefined ? 1 : Number.parseInt(digits, 10);
	if (!Number.isFinite(id) || id < 1) return undefined;
	return id;
}

function indexNameFor(
	volumeId: number,
	sourcePath: string,
): string | undefined {
	if (volumeId === 1) return undefined;
	return sourcePath.toLowerCase().endsWith(".dat")
		? INDEX_NAME
		: FALLBACK_INDEX_NAME;
}

function readFixedString(
	buffer: Buffer,
	offset: number,
	length: number,
): string {
	const field = buffer.subarray(offset, offset + length);
	const end = field.indexOf(0);
	return decodeCp932(end === -1 ? field : field.subarray(0, end));
}

/**
 * `DatOpener.ReadIndex`: a list of named directories, each holding ten byte records that name the
 * volume an entry lives in.
 */
export function readLazycrewIndex(
	index: Buffer,
	volumeId: number,
	archiveSize: bigint,
): LazycrewEntry[] | undefined {
	if (index.length < DIR_FIRST_OFFSET) return undefined;
	const dirCount = index.readInt32LE(0);
	if (dirCount <= 0 || dirCount > DIR_COUNT_LIMIT) return undefined;
	const firstOffset = dirCount * DIR_RECORD_SIZE + DIR_FIRST_OFFSET;
	if (index.length < firstOffset) return undefined;
	const directories: { name: string; offset: number; count: number }[] = [];
	for (let id = 0; id < dirCount; id += 1) {
		const base = DIR_FIRST_OFFSET + id * DIR_RECORD_SIZE;
		const name = readFixedString(index, base, DIR_NAME_SIZE);
		const offset = index.readInt32LE(base + DIR_OFFSET_FIELD);
		const count = index.readInt32LE(base + DIR_COUNT_FIELD);
		if (offset < firstOffset || offset >= index.length || !isSaneCount(count))
			return undefined;
		directories.push({ name, offset, count });
	}
	const entries: LazycrewEntry[] = [];
	for (const directory of directories) {
		const lower = directory.name.toLowerCase();
		const type =
			lower === "image" ? "image" : lower === "sound" ? "audio" : undefined;
		let offset = directory.offset;
		for (let id = 0; id < directory.count; id += 1) {
			if (offset + ENTRY_RECORD_SIZE > index.length) return undefined;
			if (index.readUInt16LE(offset + ENTRY_VOLUME_FIELD) === volumeId) {
				const dataOffset = BigInt(
					index.readUInt32LE(offset + ENTRY_OFFSET_FIELD),
				);
				const size = BigInt(index.readUInt32LE(offset + ENTRY_SIZE_FIELD));
				if (!checkPlacement(dataOffset, size, archiveSize)) return undefined;
				entries.push({
					name: `${directory.name}/${String(id).padStart(ENTRY_NAME_DIGITS, "0")}`,
					offset: dataOffset,
					size,
					type,
				});
			}
			offset += ENTRY_RECORD_SIZE;
		}
	}
	return entries;
}

/** `DatOpener.DecryptData`: a byte-wise XOR driven by a rolling key. */
export function decryptLazycrewData(data: Buffer, key = PCM_KEY): void {
	let state = key >>> 0;
	for (let position = 0; position < data.length; position += 1) {
		const value = (data[position] ?? 0) ^ (state & 0xff);
		data[position] = value;
		state = (value ^ (((state << 9) >>> 0) | ((state >>> 23) & 0x1f0))) >>> 0;
	}
}

/** `DatOpener.OpenAudio`: wraps a keyed PCM stream into a RIFF container. */
export function wrapLazycrewAudio(stored: Buffer): Buffer {
	const dataSize = stored.readUInt32LE(RIFF_DATA_SIZE_FIELD);
	if (stored.length < RIFF_PCM_OFFSET + dataSize) return stored;
	const header = Buffer.alloc(RIFF_HEADER_SIZE);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(RIFF_HEADER_SIZE - 8 + dataSize, RIFF_FORMAT_OFFSET);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 12, "latin1");
	header.writeUInt32LE(RIFF_FORMAT_SIZE, 16);
	stored.copy(
		header,
		20,
		RIFF_FORMAT_OFFSET,
		RIFF_FORMAT_OFFSET + RIFF_FORMAT_SIZE,
	);
	header.write("data", 0x24, "latin1");
	header.writeUInt32LE(dataSize, 0x28);
	const pcm = Buffer.from(
		stored.subarray(RIFF_PCM_OFFSET, RIFF_PCM_OFFSET + dataSize),
	);
	decryptLazycrewData(pcm);
	return Buffer.concat([header, pcm]);
}

async function readEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<LazycrewEntry[] | undefined> {
	const volumeId = lazycrewVolumeId(sourcePath);
	if (volumeId === undefined) return undefined;
	const indexName = indexNameFor(volumeId, sourcePath);
	let index: Buffer;
	if (indexName === undefined) {
		if (source.size > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
		index = Buffer.from(await source.readAt(0n, Number(source.size)));
	} else {
		const companion = await readCompanionFile(sourcePath, indexName);
		if (!companion) return undefined;
		index = companion;
	}
	const entries = readLazycrewIndex(index, volumeId, source.size);
	if (!entries || entries.length === 0) return undefined;
	return entries;
}

export const lazycrewDatDescriptor: FormatDescriptor = {
	id: "lazycrew-dat",
	name: "Lazycrew resource archive",
	extensions: ["dat", ""],
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
			source: "Legacy/Lazycrew/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lazycrewDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lazycrewDatDescriptor,
	detection: {
		signatures: [
			{ bytes: new Uint8Array([0, 0, 0, 0]) },
			{ bytes: new Uint8Array([2, 0, 0, 0]) },
		],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Lazycrew index");
		return {
			entries: entries.map((entry, id) => ({
				...createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.size,
					metadata: entry.type === undefined ? {} : { type: entry.type },
				}),
				// Audio records are rewritten into a RIFF container, so their stored size is a lower bound.
				...(entry.type === "audio" ? { sizeKnown: false } : {}),
			})),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (entry.metadata?.type !== "audio") return Readable.from([stored]);
		if (stored.length < 4) return Readable.from([stored]);
		const signature = stored.readUInt32LE(0);
		if (AUDIO_STRIPPED_SIGNATURES.includes(signature))
			return Readable.from([stored.subarray(4)]);
		if (!AUDIO_SIGNATURES.includes(signature)) return Readable.from([stored]);
		return Readable.from([wrapLazycrewAudio(stored)]);
	},
});
