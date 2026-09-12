// Format reference: GARbro ArcFormats/Favorite/ArcBIN.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	BufferCursor,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import type { Readable } from "node:stream";

const HEADER_SIZE = 8;
const RECORD_SIZE = 12;
const MAX_ENTRY_COUNT = 0xfffff;

interface FavoriteBinEntry extends ArchiveEntry {
	offset: bigint;
}

interface FavoriteBinDirectory {
	entries: FavoriteBinEntry[];
	nameIndexSize: number;
}

interface InferredResource {
	extension: string;
	type: "audio" | "image";
	signature: string;
}

export const favoriteBinDescriptor: FormatDescriptor = {
	id: "favorite-bin",
	name: "Favorite View Point BIN archive",
	extensions: ["bin"],
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
			source: "ArcFormats/Favorite/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function checkedIndexSize(entryCount: number): number {
	const size = entryCount * RECORD_SIZE;
	if (!Number.isSafeInteger(size)) {
		throw new GarbroError("INVALID_ARCHIVE", "Favorite BIN index is too large");
	}
	return size;
}

async function inferResource(
	source: ByteSource,
	offset: bigint,
	size: bigint,
): Promise<InferredResource | undefined> {
	if (size < 4n) return undefined;
	const probe = await source.readAt(offset, Number(size < 12n ? size : 12n));
	if (
		probe.length >= 12 &&
		probe.subarray(0, 4).equals(Buffer.from("RIFF")) &&
		probe.subarray(8, 12).equals(Buffer.from("WAVE"))
	) {
		return { extension: "wav", type: "audio", signature: "RIFF/WAVE" };
	}
	if (probe.subarray(0, 4).equals(Buffer.from("hzc1"))) {
		return { extension: "hzc", type: "image", signature: "hzc1" };
	}
	return undefined;
}

async function readDirectory(
	source: ByteSource,
	sourcePath: string,
	inferTypes: boolean,
): Promise<FavoriteBinDirectory> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Favorite BIN header is truncated",
		);
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	const entryCount = header.readInt32LE(0);
	if (entryCount <= 0 || entryCount > MAX_ENTRY_COUNT) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Favorite BIN entry count is invalid",
		);
	}
	const indexSize = checkedIndexSize(entryCount);
	const nameIndexSize = header.readUInt32LE(4);
	const namesOffset = BigInt(HEADER_SIZE + indexSize);
	const dataOffset = namesOffset + BigInt(nameIndexSize);
	if (dataOffset >= source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Favorite BIN index exceeds the archive",
		);
	}

	const [index, names] = await Promise.all([
		source.readAt(BigInt(HEADER_SIZE), indexSize),
		source.readAt(
			namesOffset,
			bigintToBufferLength(BigInt(nameIndexSize), "Favorite BIN name index"),
		),
	]);
	const cursor = new BufferCursor(index);
	const entries: FavoriteBinEntry[] = [];
	for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
		const filenameOffset = cursor.readU32LE();
		const offset = BigInt(cursor.readU32LE());
		const size = BigInt(cursor.readU32LE());
		if (filenameOffset >= nameIndexSize) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Favorite BIN filename offset is outside the name index",
			);
		}
		const nameCursor = new BufferCursor(names.subarray(filenameOffset));
		const rawPath = nameCursor.readCString(names.length - filenameOffset);
		if (!rawPath) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Favorite BIN entry has an empty name",
			);
		}
		if (
			offset < dataOffset ||
			offset > source.size ||
			size > source.size - offset
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Favorite BIN entry points outside the archive: ${rawPath}`,
			);
		}
		entries.push({
			id: String(entryIndex),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: false,
			offset,
		});
	}

	if (inferTypes) {
		const archiveName = basename(sourcePath, extname(sourcePath)).toLowerCase();
		if (archiveName === "voice" || archiveName === "bgm") {
			for (const entry of entries) entry.metadata = { inferredType: "audio" };
		} else {
			await Promise.all(
				entries.map(async (entry) => {
					const inferred = await inferResource(
						source,
						entry.offset,
						entry.size,
					);
					if (!inferred) return;
					entry.path += `.${inferred.extension}`;
					entry.metadata = {
						inferredType: inferred.type,
						contentSignature: inferred.signature,
					};
				}),
			);
		}
	}
	return { entries, nameIndexSize };
}

class FavoriteBinArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = favoriteBinDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FavoriteBinEntry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: FavoriteBinDirectory,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = { nameIndexSize: directory.nameIndexSize };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		return this.#source.createReadStream(entry.offset, entry.size);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class FavoriteBinFormat implements ArchiveFormat {
	readonly descriptor = favoriteBinDescriptor;
	readonly detection = { priority: 0 };

	async detect(source: ByteSource): Promise<boolean> {
		try {
			await readDirectory(source, "", false);
			return true;
		} catch (error) {
			if (error instanceof GarbroError && error.code === "INVALID_ARCHIVE")
				return false;
			throw error;
		}
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new FavoriteBinArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source, sourcePath, true),
		);
	}
}
