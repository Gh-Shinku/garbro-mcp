import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveEntry,
	ArchiveFormat,
	ArchiveHandle,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import { createFixedEntry } from "../shared/fixed-archive.js";

const MARK = Buffer.from("war ", "latin1");
const SECOND_MARK = Buffer.from("war2", "latin1");
const COUNT_FIELD = 0x08;
const ENTRY_SIZE_FIELD = 0x0c;
const INDEX_OFFSET = 0x10;
const MINIMUM_ENTRY_SIZE = 0x18;
const OFFSET_FIELD = 0x00;
const SIZE_FIELD = 0x04;
const FORMAT_FIELD = 0x14;
/** The kinds of sound the head names: a sound that stands as places of a wave, and a sound of the Ogg kind. */
const WAVE_KIND = 0;
const OGG_KIND = 2;
const RIFF = Buffer.from("RIFF", "latin1");
const WAVE = Buffer.from("WAVE", "latin1");
const FORMAT_WORD = Buffer.from("fmt ", "latin1");
const DATA_WORD = Buffer.from("data", "latin1");
const HEAD_SIZE = 8 + 12 + 8;
const WAVE_HEAD_FIELDS = 8;
/** A count of the files of an archive past which an index can stand in no file this project reads. */
const MAXIMUM_COUNT = 0x10000;

export interface WarEntry {
	offset: number;
	size: number;
	format: number;
}

export interface WarIndex {
	entrySize: number;
	entries: WarEntry[];
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `WarOpener.TryOpen`: the head of the file names how many places the index stands in, how many places every
 * one of them stands in — which stands at `0x18` places or more — and where every place of a file of the
 * archive stands, how much of it stands, and the kind of sound it stands for. */
export function readWarIndex(
	data: Buffer,
	fileLength = data.length,
): WarIndex | undefined {
	if (fileLength < INDEX_OFFSET || data.length < INDEX_OFFSET) return undefined;
	const count = data.readInt32LE(COUNT_FIELD);
	const entrySize = data.readUInt32LE(ENTRY_SIZE_FIELD);
	if (count <= 0 || count > MAXIMUM_COUNT) return undefined;
	if (entrySize < MINIMUM_ENTRY_SIZE) return undefined;
	if (INDEX_OFFSET + count * entrySize > fileLength) return undefined;
	const entries: WarEntry[] = [];
	let at = INDEX_OFFSET;
	for (let index = 0; index < count; index += 1) {
		const offset = data.readUInt32LE(at + OFFSET_FIELD);
		const size = data.readUInt32LE(at + SIZE_FIELD);
		const format = data.readUInt8(at + FORMAT_FIELD);
		if (offset + size > fileLength) return undefined;
		entries.push({ offset, size, format });
		at += entrySize;
	}
	return { entrySize, entries };
}

/** `WarOpener.GetDefaultName`: a file of an archive stands under the name of the archive and its place in the
 * index, the place standing as five places. */
export function warEntryName(
	base: string,
	format: number,
	index: number,
): string {
	const name = `${base}#${String(index).padStart(5, "0")}`;
	if (WAVE_KIND === format) return changeExtension(name, "wav");
	if (OGG_KIND === format) return changeExtension(name, "ogg");
	return name;
}

export function openWarWave(data: Buffer, entry: WarEntry): Buffer {
	if (entry.size < WAVE_HEAD_FIELDS) {
		throw invalidArchive("SAS5 sound is cut short of its own head");
	}
	const at = entry.offset;
	const formatSize = data.readUInt32LE(at);
	const dataSize = data.readUInt32LE(at + 4);
	if (at + WAVE_HEAD_FIELDS + formatSize > data.length) {
		throw invalidArchive("SAS5 sound is cut short of its own head");
	}
	const format = data.subarray(
		at + WAVE_HEAD_FIELDS,
		at + WAVE_HEAD_FIELDS + formatSize,
	);
	const pcmAt = at + WAVE_HEAD_FIELDS + formatSize;
	const pcmSize = entry.size - WAVE_HEAD_FIELDS - formatSize;
	if (pcmSize < 0 || pcmAt + pcmSize > data.length) {
		throw invalidArchive("SAS5 sound is cut short of the places of its wave");
	}
	const head: Buffer = Buffer.alloc(HEAD_SIZE + formatSize, 0x00);
	RIFF.copy(head, 0);
	head.writeUInt32LE(head.length + dataSize - 8, 4);
	WAVE.copy(head, 8);
	FORMAT_WORD.copy(head, 12);
	head.writeUInt32LE(formatSize, 16);
	format.copy(head, 20);
	DATA_WORD.copy(head, 20 + formatSize);
	head.writeUInt32LE(dataSize, 24 + formatSize);
	return Buffer.concat([head, data.subarray(pcmAt, pcmAt + pcmSize)]);
}

class WarArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format: FormatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly ArchiveEntry[];
	readonly #source: ByteSource;
	readonly #index: WarIndex;
	readonly #stored: Buffer;

	constructor(
		source: ByteSource,
		sourcePath: string,
		descriptor: FormatDescriptor,
		stored: Buffer,
		index: WarIndex,
	) {
		this.#source = source;
		this.#stored = stored;
		this.#index = index;
		this.format = descriptor;
		this.sourcePath = sourcePath;
		this.size = source.size;
		const base = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");
		this.entries = index.entries.map((entry, at) =>
			createFixedEntry({
				id: at,
				path: warEntryName(base, entry.format, at),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				compressed: false,
				metadata: {
					type:
						WAVE_KIND === entry.format || OGG_KIND === entry.format
							? "audio"
							: "file",
					kind: entry.format,
				},
			}),
		);
		this.metadata = {
			entryCount: this.entries.length,
			entrySize: index.entrySize,
		};
	}

	async openEntry(id: string): Promise<Readable> {
		const at = this.entries.findIndex((entry) => entry.id === id);
		const entry = at < 0 ? undefined : this.#index.entries[at];
		if (!entry) throw invalidArchive("No such place in the archive");
		if (WAVE_KIND === entry.format) {
			return Readable.from([openWarWave(this.#stored, entry)]);
		}
		const stored = Buffer.from(
			await this.#source.readAt(BigInt(entry.offset), entry.size),
		);
		return Readable.from([stored]);
	}

	async close(): Promise<void> {}
}

function makeWarFormat(
	descriptor: FormatDescriptor,
	mark: Buffer,
): ArchiveFormat {
	const read = async (source: ByteSource, sourcePath: string) => {
		const stored = Buffer.from(
			await source.readAt(0n, Math.min(Number(source.size), 4 << 20)),
		);
		const index = readWarIndex(stored, Number(source.size));
		if (!index) throw invalidArchive("Not a SAS5 sound archive");
		return new WarArchiveHandle(source, sourcePath, descriptor, stored, index);
	};
	return {
		descriptor,
		detection: { signatures: [{ bytes: mark }] },
		async detect(source: ByteSource): Promise<boolean> {
			if (source.size < BigInt(INDEX_OFFSET)) return false;
			try {
				const head = Buffer.from(
					await source.readAt(0n, Math.min(Number(source.size), INDEX_OFFSET)),
				);
				if (!head.subarray(0, mark.length).equals(mark)) return false;
				const count = head.readInt32LE(COUNT_FIELD);
				const entrySize = head.readUInt32LE(ENTRY_SIZE_FIELD);
				if (count <= 0 || count > MAXIMUM_COUNT) return false;
				if (entrySize < MINIMUM_ENTRY_SIZE) return false;
				return (
					BigInt(INDEX_OFFSET) + BigInt(count) * BigInt(entrySize) <=
					source.size
				);
			} catch {
				return false;
			}
		},
		open: read,
	};
}

export const sas5WarDescriptor: FormatDescriptor = {
	id: "sas5-war",
	name: "SAS5 engine audio archive",
	extensions: ["war"],
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
			source: "ArcFormats/Sas5/ArcWAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sas5War2Descriptor: FormatDescriptor = {
	...sas5WarDescriptor,
	id: "sas5-war2",
	name: "SAS5 engine audio archive, second kind",
};

export const sas5WarFormat: ArchiveFormat = makeWarFormat(
	sas5WarDescriptor,
	MARK,
);

export const sas5War2Format: ArchiveFormat = makeWarFormat(
	sas5War2Descriptor,
	SECOND_MARK,
);
