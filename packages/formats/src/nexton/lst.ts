// Format reference: GARbro ArcFormats/Tactics/ArcLST.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	decodeCp932,
	FileByteSource,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";

const MOON_KEY = 0xcc;
const MOON_KEY_WORD = 0xcccccccc;
const MOON_RECORD_SIZE = 0x2c;
const NEXTON_RECORD_SIZE = 0x4c;
const MAX_ENTRY_COUNT = 0xfffff;
const TYPE_EXTENSIONS = ["LST", "SNX", "BMP", "PNG", "WAV", "OGG"];

interface LstEntry extends ArchiveEntry {
	offset: bigint;
	scriptKey: number;
}

interface LstDirectory {
	entries: LstEntry[];
	variant: "moon" | "nexton";
}

export const lstDescriptor: FormatDescriptor = {
	id: "nexton-lst",
	name: "Nexton LikeC companion-index archive",
	extensions: [""],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Tactics/ArcLST.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function readEncodedName(
	data: Buffer,
	offset: number,
	size: number,
	key: number,
): string {
	const decoded = Buffer.alloc(size);
	let length = 0;
	for (; length < size; length += 1) {
		let value = data[offset + length] ?? 0;
		if (value === 0) break;
		if (value !== key) value ^= key;
		decoded[length] = value;
	}
	return decodeCp932(decoded.subarray(0, length));
}

function validatePlacement(
	dataSize: bigint,
	offset: bigint,
	size: bigint,
	path: string,
): void {
	if (offset > dataSize || size > dataSize - offset) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`LikeC entry points outside the data file: ${path}`,
		);
	}
}

async function tryMoon(
	list: ByteSource,
	dataSize: bigint,
): Promise<LstDirectory | undefined> {
	if (list.size < 4n) return undefined;
	const count =
		((await list.readAt(0n, 4)).readUInt32LE(0) ^ MOON_KEY_WORD) >>> 0;
	const indexSize = 4 + count * MOON_RECORD_SIZE;
	if (
		count === 0 ||
		count > MAX_ENTRY_COUNT ||
		!Number.isSafeInteger(indexSize) ||
		BigInt(indexSize) > list.size
	) {
		return undefined;
	}
	const index = await list.readAt(0n, indexSize);
	const entries: LstEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = 4 + id * MOON_RECORD_SIZE;
		const rawPath = readEncodedName(index, recordOffset + 8, 0x24, MOON_KEY);
		if (!rawPath) return undefined;
		const offset = BigInt(
			(index.readUInt32LE(recordOffset) ^ MOON_KEY_WORD) >>> 0,
		);
		const size = BigInt(
			(index.readUInt32LE(recordOffset + 4) ^ MOON_KEY_WORD) >>> 0,
		);
		validatePlacement(dataSize, offset, size, rawPath);
		entries.push({
			id: String(id),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: false,
			offset,
			scriptKey: 0,
		});
	}
	return { entries, variant: "moon" };
}

function replaceExtension(path: string, extension: string): string {
	const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	const dot = path.lastIndexOf(".");
	const stem = dot > slash ? path.slice(0, dot) : path;
	return `${stem}.${extension}`;
}

async function tryNexton(
	list: ByteSource,
	dataSize: bigint,
): Promise<LstDirectory | undefined> {
	if (list.size < 4n) return undefined;
	const first = await list.readAt(0n, 4);
	const key = first[3] ?? 0;
	if (key === 0) return undefined;
	const keyWord = (key | (key << 8) | (key << 16) | (key << 24)) >>> 0;
	const count = (first.readUInt32LE(0) ^ keyWord) >>> 0;
	const indexSize = 4 + count * NEXTON_RECORD_SIZE;
	if (
		count === 0 ||
		count > MAX_ENTRY_COUNT ||
		!Number.isSafeInteger(indexSize) ||
		BigInt(indexSize) > list.size
	) {
		return undefined;
	}
	const index = await list.readAt(0n, indexSize);
	const entries: LstEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = 4 + id * NEXTON_RECORD_SIZE;
		const rawPath = readEncodedName(index, recordOffset + 8, 0x40, key);
		if (!rawPath) return undefined;
		const offset = BigInt((index.readUInt32LE(recordOffset) ^ keyWord) >>> 0);
		const size = BigInt((index.readUInt32LE(recordOffset + 4) ^ keyWord) >>> 0);
		validatePlacement(dataSize, offset, size, rawPath);
		const type = index.readInt32LE(recordOffset + 0x48);
		const extension = TYPE_EXTENSIONS[type];
		const path = extension ? replaceExtension(rawPath, extension) : rawPath;
		const scriptKey = type === 1 ? (key + 1) & 0xff : 0;
		entries.push({
			id: String(id),
			path: path.replaceAll("\\", "/"),
			...(path.includes("\\") ? { rawPath: path } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: scriptKey !== 0,
			offset,
			scriptKey,
			metadata: { type },
		});
	}
	return { entries, variant: "nexton" };
}

async function readCompanion(
	dataSize: bigint,
	sourcePath: string,
): Promise<LstDirectory> {
	let list: FileByteSource;
	try {
		list = await FileByteSource.open(`${sourcePath}.lst`);
	} catch (error) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"LikeC companion .lst file is missing",
			{
				cause: error,
			},
		);
	}
	try {
		let directory: LstDirectory | undefined;
		try {
			directory = await tryMoon(list, dataSize);
		} catch (error) {
			if (!(error instanceof GarbroError)) throw error;
		}
		if (!directory) directory = await tryNexton(list, dataSize);
		if (!directory) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"LikeC companion index is invalid",
			);
		}
		return directory;
	} finally {
		await list.close();
	}
}

class LstArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = lstDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly LstEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, directory: LstDirectory) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = {
			variant: directory.variant,
			companionPath: `${sourcePath}.lst`,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		if (entry.scriptKey === 0) {
			return this.#source.createReadStream(entry.offset, entry.size);
		}
		const data = await this.#source.readAt(
			entry.offset,
			bigintToBufferLength(entry.size, "LikeC script"),
		);
		for (let index = 0; index < data.length; index += 1) {
			data[index] = (data[index] ?? 0) ^ entry.scriptKey;
		}
		return Readable.from([data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class LstFormat implements ArchiveFormat {
	readonly descriptor = lstDescriptor;
	readonly detection = { priority: -80 };

	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		const path = sourcePath ?? source.path;
		if (!path) return false;
		try {
			await readCompanion(source.size, path);
			return true;
		} catch (error) {
			if (error instanceof GarbroError && error.code === "INVALID_ARCHIVE") {
				return false;
			}
			throw error;
		}
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new LstArchiveHandle(
			source,
			sourcePath,
			await readCompanion(source.size, sourcePath),
		);
	}
}
