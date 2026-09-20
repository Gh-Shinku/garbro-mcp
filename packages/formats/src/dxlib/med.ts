// Format reference: GARbro "ArcFormats/DxLib/ArcMED.cs", classes `MedOpener` and `ScrMedArchive` (an archive
// of the DxLib engine: the head names how long every place of the index stands and how many of them stand, and
// every place of the index names a file of the archive and where its places stand). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveEntry,
	ArchiveFormat,
	ArchiveHandle,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { createFixedEntry } from "../shared/fixed-archive.js";

/** The words every archive of this kind stands behind, and the head the index stands behind. */
const MARK = "MD";
const HEAD_SIZE = 0x10;
const ENTRY_LENGTH_FIELD = 0x04;
const COUNT_FIELD = 0x06;
/** Every place of the index stands as the places of the name of a file of the archive and the places of where
 * it stands and how much of it stands. */
const NAME_FIELDS = 8;
/** The place of a file of the archive stands in the four places behind the places of how much of it stands. */
const OFFSET_FIELD = 4;
/** A count of the files of an archive past which an index can stand in no file this project reads. */
const MAXIMUM_COUNT = 0x10000;

export interface MedEntry {
	name: string;
	offset: number;
	size: number;
}

export interface MedIndex {
	entryLength: number;
	nameLength: number;
	entries: MedEntry[];
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `MedOpener.TryOpen`: the words of the head name the places of every place of the index and how many of them
 * stand, every place of the index naming a file of the archive, where its places stand, and how much of it
 * stands. */
export function readMedIndex(
	data: Buffer,
	fileLength = data.length,
): MedIndex | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (data.toString("latin1", 0, MARK.length) !== MARK) return undefined;
	const entryLength = data.readUInt16LE(ENTRY_LENGTH_FIELD);
	const count = data.readUInt16LE(COUNT_FIELD);
	if (entryLength <= NAME_FIELDS || count <= 0 || count > MAXIMUM_COUNT) {
		return undefined;
	}
	const nameLength = entryLength - NAME_FIELDS;
	if (HEAD_SIZE + count * entryLength > fileLength) return undefined;
	const entries: MedEntry[] = [];
	let at = HEAD_SIZE;
	for (let index = 0; index < count; index += 1) {
		const raw = data.subarray(at, at + nameLength);
		const end = raw.indexOf(0x00);
		const name = raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
		const size = data.readUInt32LE(at + nameLength);
		const offset = data.readUInt32LE(at + nameLength + OFFSET_FIELD);
		if (offset + size > fileLength) return undefined;
		entries.push({ name, offset, size });
		at += entryLength;
		if (at > fileLength) return undefined;
	}
	return { entryLength, nameLength, entries };
}

/** What the reference names a file of the archive with where it names it with nothing. */
function entryName(entry: MedEntry, index: number): string {
	return entry.name.length > 0 ? entry.name : `entry_${index}`;
}

class MedArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = medDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly ArchiveEntry[];
	readonly #source: ByteSource;
	readonly #index: MedIndex;

	constructor(source: ByteSource, sourcePath: string, index: MedIndex) {
		this.#source = source;
		this.#index = index;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = index.entries.map((entry, at) =>
			createFixedEntry({
				id: at,
				path: entryName(entry, at),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				// The reference hands the places of a file of this kind out as they stand, and names the kind
				// of file behind them for the reader of the places of the archive to read.
				compressed: false,
				metadata: { type: "file" },
			}),
		);
		this.metadata = {
			entryCount: this.entries.length,
			entryLength: index.entryLength,
			nameLength: index.nameLength,
		};
	}

	async openEntry(id: string): Promise<Readable> {
		const at = this.entries.findIndex((entry) => entry.id === id);
		const entry = at < 0 ? undefined : this.#index.entries[at];
		if (!entry) throw invalidArchive("No such place in the archive");
		const stored = Buffer.from(
			await this.#source.readAt(BigInt(entry.offset), entry.size),
		);
		return Readable.from([stored]);
	}

	async close(): Promise<void> {}
}

export const medDescriptor: FormatDescriptor = {
	id: "dxlib-med",
	name: "DxLib engine resource archive",
	extensions: ["med"],
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
			source: "ArcFormats/DxLib/ArcMED.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const medFormat: ArchiveFormat = {
	descriptor: medDescriptor,
	// The reference registers no word of its own and tells an archive of this kind by the words of its head,
	// which every file of the plainest kind stands in front of.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const head = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), HEAD_SIZE)),
			);
			if (head.toString("latin1", 0, MARK.length) !== MARK) return false;
			const entryLength = head.readUInt16LE(ENTRY_LENGTH_FIELD);
			const count = head.readUInt16LE(COUNT_FIELD);
			if (entryLength <= NAME_FIELDS || count <= 0 || count > MAXIMUM_COUNT) {
				return false;
			}
			return (
				BigInt(HEAD_SIZE) + BigInt(count) * BigInt(entryLength) <= source.size
			);
		} catch {
			return false;
		}
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const stored = Buffer.from(
			await source.readAt(0n, Math.min(Number(source.size), 1 << 20)),
		);
		const index = readMedIndex(stored, Number(source.size));
		if (!index) throw invalidArchive("Not a DxLib resource archive");
		return new MedArchiveHandle(source, sourcePath, index);
	},
};
