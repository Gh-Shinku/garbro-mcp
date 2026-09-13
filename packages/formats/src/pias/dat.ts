// Format reference: GARbro "Legacy/Pias/ArcDAT.cs", classes `DatOpener`, `IndexReader` and
// `TextReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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

const ENCRYPTED_SIGNATURE = 0x03184767;
const TEXT_OPCODE = 0x68;
/** Resource payloads carry a four byte length for audio and a eight byte header for graphics. */
export const AUDIO_HEADER_SIZE = 4;
export const IMAGE_HEADER_SIZE = 8;
const RIFF_HEADER_SIZE = 44;
const RIFF_SIZE_BIAS = 0x24;
const RIFF_TAG = 0x46464952;
const WAVE_TAG = 0x45564157;
const FMT_TAG = 0x20746d66;
const DATA_TAG = 0x61746164;

/** `ResourceType` selects the text.dat list that drives the directory. */
export type ResourceType = "undefined" | "graphics" | "sound";

/** `DatOpener.TryOpen` picks the resource type from the archive file name. */
export function resourceTypeOf(sourcePath: string): ResourceType | undefined {
	const name = (sourcePath.split(/[\\/]/).pop() ?? "").toLowerCase();
	if (name === "sound.dat") return "sound";
	if (name === "graph.dat") return "graphics";
	if (name === "voice.dat" || name === "music.dat") return "undefined";
	return undefined;
}

/** `TextReader.ReadInt`: a one to four byte big endian integer with a length code in the top bits. */
function readPackedInt(
	data: Buffer,
	offset: number,
): { value: number; next: number } {
	const first = data[offset];
	if (first === undefined)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated text.dat");
	const code = first & 0xc0;
	if (code === 0) return { value: first, next: offset + 1 };
	let value = (first & 0x3f) << 8;
	const second = data[offset + 1];
	if (second === undefined)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated text.dat");
	value |= second;
	if (code === 0x40) return { value, next: offset + 2 };
	for (let index = 0; index < 2; index += 1) {
		const next = data[offset + 2 + index];
		if (next === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated text.dat");
		value = (value << 8) | next;
	}
	return { value, next: offset + 4 };
}

/**
 * `TextReader.GetResourceList`: walks the opcode records of text.dat and collects the offsets of the
 * record whose resource type matches. Records for other types are skipped.
 */
export function readTextOffsets(
	data: Buffer,
	resourceType: ResourceType,
): number[] | undefined {
	if (data.length < 4) return undefined;
	if (data.readUInt32LE(0) === ENCRYPTED_SIGNATURE) return undefined;
	let offset = 0;
	while (offset < data.length) {
		if (data[offset] !== TEXT_OPCODE) return undefined;
		offset += 1;
		let type: number;
		let count: number;
		try {
			const readType = readPackedInt(data, offset);
			type = readType.value;
			offset = readType.next;
			const readCount = readPackedInt(data, offset);
			count = readCount.value;
			offset = readCount.next;
		} catch {
			return undefined;
		}
		const wanted =
			resourceType === "graphics" ? 1 : resourceType === "sound" ? 2 : 0;
		const matching = type === wanted;
		if (matching && !isSaneCount(count)) return undefined;
		const offsets: number[] = [];
		for (let index = 0; index < count; index += 1) {
			if (offset + 4 > data.length) return undefined;
			const value = data.readUInt32LE(offset);
			offset += 4;
			if (matching) offsets.push(value);
		}
		if (matching) return offsets;
	}
	return undefined;
}

export interface PiasEntry {
	name: string;
	type: string;
	offset: number;
	size: number;
}

/**
 * `IndexReader.FillEntries`: text.dat offsets become index numbered entries, then the whole file is
 * walked as a chain of length prefixed resources.
 */
export async function buildPiasEntries(
	source: ByteSource,
	sourcePath: string,
	textData?: Buffer,
): Promise<PiasEntry[] | undefined> {
	const resourceType = resourceTypeOf(sourcePath);
	if (!resourceType) return undefined;
	const entryType = resourceType === "graphics" ? "image" : "audio";
	const headerSize =
		resourceType === "graphics" ? IMAGE_HEADER_SIZE : AUDIO_HEADER_SIZE;
	const entries: PiasEntry[] = [];
	const knownOffsets = new Set<number>();
	if (resourceType !== "undefined") {
		// The encrypted flavour passes the decrypted text.dat list instead of reading the plain one.
		const text = textData ?? (await readCompanionFile(sourcePath, "text.dat"));
		if (!text) return undefined;
		const offsets = readTextOffsets(text, resourceType);
		if (!offsets) return undefined;
		for (const [index, offset] of offsets.entries()) {
			knownOffsets.add(offset);
			entries.push({
				name: index.toString().padStart(4, "0"),
				type: entryType,
				offset,
				size: await readEntrySize(source, offset, headerSize),
			});
		}
	}
	const maxOffset = Number(source.size);
	let offset = 0;
	while (offset < maxOffset) {
		if (offset + 4 > maxOffset) break;
		const first = Buffer.from(
			await source.readAt(BigInt(offset), 4),
		).readUInt32LE(0);
		const entrySize = first === 0xffffffff ? 4 : first + headerSize;
		if (first !== 0xffffffff && !knownOffsets.has(offset)) {
			if (!checkPlacement(BigInt(offset), BigInt(entrySize), source.size))
				return undefined;
			entries.push({
				name: offset.toString().padStart(8, "0"),
				type: entryType,
				offset,
				size: entrySize,
			});
		}
		offset += entrySize;
	}
	return entries;
}

/**
 * Reads up to `size` bytes, truncating the request at the end of the file. GARbro's ArcView clamps
 * its streams the same way, which matters because text.dat offsets are not placement checked and can
 * describe an entry that runs past the end of the archive.
 */
export async function readClamped(
	source: ByteSource,
	offset: bigint,
	size: number,
): Promise<Buffer> {
	const available = Number(source.size) - Number(offset);
	if (available <= 0) return Buffer.alloc(0);
	return Buffer.from(await source.readAt(offset, Math.min(size, available)));
}

export async function readEntrySize(
	source: ByteSource,
	offset: number,
	headerSize: number,
): Promise<number> {
	const value = Buffer.from(
		await source.readAt(BigInt(offset), 4),
	).readUInt32LE(0);
	return value + headerSize;
}

/** `WaveAudio.WriteRiffHeader`: a fixed 44 byte RIFF/WAVE header without any extra chunks. */
function writeRiffHeader(dataSize: number, channels: number): Buffer {
	const header = Buffer.alloc(RIFF_HEADER_SIZE);
	header.writeUInt32LE(RIFF_TAG, 0);
	header.writeUInt32LE((RIFF_SIZE_BIAS + dataSize) >>> 0, 4);
	header.writeUInt32LE(WAVE_TAG, 8);
	header.writeUInt32LE(FMT_TAG, 0xc);
	header.writeUInt32LE(0x10, 0x10);
	header.writeUInt16LE(1, 0x14);
	header.writeUInt16LE(channels, 0x16);
	header.writeUInt32LE(22050, 0x18);
	header.writeUInt32LE(22050 * channels, 0x1c);
	header.writeUInt16LE(channels, 0x20);
	header.writeUInt16LE(8, 0x22);
	header.writeUInt32LE(DATA_TAG, 0x24);
	header.writeUInt32LE(dataSize >>> 0, 0x28);
	return header;
}

export const piasDatDescriptor: FormatDescriptor = {
	id: "pias-dat",
	name: "Pias resource archive",
	extensions: ["dat"],
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
			source: "Legacy/Pias/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const piasDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: piasDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!resourceTypeOf(sourcePath)) return false;
		return (await buildPiasEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await buildPiasEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pias index");
		const fixed: FixedEntry[] = entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				metadata: { type: entry.type },
			});
			// Audio extraction wraps the payload in a RIFF container, so the stored size does not
			// describe the extracted stream.
			return entry.type === "audio"
				? { ...created, sizeKnown: false }
				: created;
		});
		return {
			entries: fixed,
			metadata: {
				entryCount: fixed.length,
				resourceType: resourceTypeOf(sourcePath),
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		if (entry.size === 0n) return Readable.from([]);
		const type = (entry.metadata as { type?: string } | undefined)?.type;
		const offset = entry.offset ?? 0n;
		if (type !== "audio") {
			return Readable.from([
				await readClamped(source, offset, Number(entry.size)),
			]);
		}
		const dataSize = Number(entry.size) - AUDIO_HEADER_SIZE;
		const channels =
			(sourcePath.split(/[\\/]/).pop() ?? "").toLowerCase() === "sound.dat"
				? 2
				: 1;
		const data = await readClamped(
			source,
			offset + BigInt(AUDIO_HEADER_SIZE),
			dataSize,
		);
		return Readable.from([
			Buffer.concat([writeRiffHeader(data.length, channels), data]),
		]);
	},
});
