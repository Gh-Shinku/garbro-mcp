// Format reference: GARbro ArcFormats/KiriKiri/ArcXP3.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream, inflateZlibBuffer } from "@garbro-mcp/codecs";
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
import { Readable } from "node:stream";

const XP3_SIGNATURE = Buffer.from([
	0x58, 0x50, 0x33, 0x0d, 0x0a, 0x20, 0x0a, 0x1a, 0x8b, 0x67, 0x01,
]);
const INDEX_METHOD_MASK = 0x07;
const INDEX_CONTINUE = 0x80;
const METHOD_RAW = 0;
const METHOD_ZLIB = 1;
const FILE_PROTECTED = 0x80000000;

interface Xp3Segment {
	compressed: boolean;
	offset: bigint;
	size: bigint;
	packedSize: bigint;
}

interface Xp3Entry extends ArchiveEntry {
	segments: Xp3Segment[];
}

export const xp3Descriptor: FormatDescriptor = {
	id: "xp3",
	name: "KiriKiri XP3 archive",
	extensions: ["xp3"],
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
			source: "ArcFormats/KiriKiri/ArcXP3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function parseSectionLength(cursor: BufferCursor, context: string): number {
	const length = bigintToBufferLength(cursor.readU64LE(), `${context} size`);
	if (length > cursor.remaining) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`${context} exceeds its containing chunk`,
		);
	}
	return length;
}

function parseXp3FileChunk(
	buffer: Buffer,
	sourceSize: bigint,
	id: string,
): Xp3Entry {
	const cursor = new BufferCursor(buffer);
	let rawPath: string | undefined;
	let originalSize: bigint | undefined;
	let packedSize: bigint | undefined;
	let flags: number | undefined;
	let checksum: string | undefined;
	let segments: Xp3Segment[] | undefined;

	while (cursor.remaining > 0) {
		if (cursor.remaining < 12) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Truncated XP3 file section header",
			);
		}
		const tag = cursor.readTag();
		const length = parseSectionLength(cursor, `XP3 ${tag} section`);
		const end = cursor.position + length;

		if (tag === "info") {
			if (length < 22)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"XP3 info section is too short",
				);
			flags = cursor.readU32LE();
			originalSize = cursor.readU64LE();
			packedSize = cursor.readU64LE();
			const nameLength = cursor.readU16LE();
			if (nameLength * 2 > end - cursor.position) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"XP3 filename exceeds the info section",
				);
			}
			rawPath = cursor.readUtf16Le(nameLength);
		} else if (tag === "segm") {
			if (length === 0 || length % 28 !== 0) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"XP3 segment table has an invalid length",
				);
			}
			segments = [];
			while (cursor.position < end) {
				const segmentFlags = cursor.readU32LE();
				const method = segmentFlags & INDEX_METHOD_MASK;
				if (method !== METHOD_RAW && method !== METHOD_ZLIB) {
					throw new GarbroError(
						"UNSUPPORTED_FEATURE",
						`Unsupported XP3 segment encoding: ${method}`,
					);
				}
				const offset = cursor.readU64LE();
				const size = cursor.readU64LE();
				const segmentPackedSize = cursor.readU64LE();
				if (offset > sourceSize || segmentPackedSize > sourceSize - offset) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"XP3 segment points outside the archive",
					);
				}
				segments.push({
					compressed: method === METHOD_ZLIB,
					offset,
					size,
					packedSize: segmentPackedSize,
				});
			}
		} else if (tag === "adlr" && length === 4) {
			checksum = cursor.readU32LE().toString(16).padStart(8, "0");
		}

		cursor.seek(end);
	}

	if (
		rawPath === undefined ||
		originalSize === undefined ||
		packedSize === undefined ||
		flags === undefined
	) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"XP3 File chunk is missing its info section",
		);
	}
	if (!segments || segments.length === 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"XP3 File chunk is missing its segment table",
		);
	}

	const segmentSize = segments.reduce((sum, segment) => sum + segment.size, 0n);
	const segmentPackedSize = segments.reduce(
		(sum, segment) => sum + segment.packedSize,
		0n,
	);
	if (segmentSize !== originalSize || segmentPackedSize !== packedSize) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`XP3 segment sizes do not match info for ${rawPath}`,
		);
	}

	const normalizedPath = rawPath.replaceAll("\\", "/");
	return {
		id,
		path: normalizedPath,
		...(normalizedPath === rawPath ? {} : { rawPath }),
		size: originalSize,
		packedSize,
		compressed: segments.some((segment) => segment.compressed),
		encrypted: (flags & FILE_PROTECTED) !== 0,
		...(checksum === undefined
			? {}
			: { checksum: { algorithm: "adler32" as const, value: checksum } }),
		metadata: {
			flags: `0x${flags.toString(16).padStart(8, "0")}`,
			segmentCount: segments.length,
		},
		segments,
	};
}

function parseIndex(
	buffer: Buffer,
	sourceSize: bigint,
	firstId: number,
): Xp3Entry[] {
	const cursor = new BufferCursor(buffer);
	const entries: Xp3Entry[] = [];
	while (cursor.remaining > 0) {
		if (cursor.remaining < 12) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Truncated XP3 index chunk header",
			);
		}
		const tag = cursor.readTag();
		const length = parseSectionLength(cursor, `XP3 ${tag} chunk`);
		const end = cursor.position + length;
		if (tag === "File") {
			const chunk = cursor.readBytes(length);
			entries.push(
				parseXp3FileChunk(chunk, sourceSize, String(firstId + entries.length)),
			);
		}
		cursor.seek(end);
	}
	return entries;
}

async function readU64At(source: ByteSource, offset: bigint): Promise<bigint> {
	return (await source.readAt(offset, 8)).readBigUInt64LE(0);
}

async function readIndices(
	source: ByteSource,
): Promise<{ entries: Xp3Entry[]; blockCount: number }> {
	let indexOffset = await readU64At(source, 11n);
	const visited = new Set<string>();
	const entries: Xp3Entry[] = [];
	let blockCount = 0;

	while (true) {
		const key = indexOffset.toString();
		if (visited.has(key))
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"XP3 index chain contains a cycle",
			);
		visited.add(key);
		if (indexOffset >= source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"XP3 index offset is outside the archive",
			);
		}

		const flag = (await source.readAt(indexOffset, 1))[0] ?? 0;
		const method = flag & INDEX_METHOD_MASK;
		const continued = (flag & INDEX_CONTINUE) !== 0;
		let storedSize: bigint;
		let dataOffset: bigint;
		let indexData: Buffer;

		if (method === METHOD_RAW) {
			storedSize = await readU64At(source, indexOffset + 1n);
			dataOffset = indexOffset + 9n;
			if (dataOffset > source.size || storedSize > source.size - dataOffset) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Raw XP3 index exceeds the archive",
				);
			}
			indexData = await source.readAt(
				dataOffset,
				bigintToBufferLength(storedSize, "XP3 index"),
			);
		} else if (method === METHOD_ZLIB) {
			storedSize = await readU64At(source, indexOffset + 1n);
			const unpackedSize = await readU64At(source, indexOffset + 9n);
			dataOffset = indexOffset + 17n;
			if (dataOffset > source.size || storedSize > source.size - dataOffset) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Compressed XP3 index exceeds the archive",
				);
			}
			const packed = await source.readAt(
				dataOffset,
				bigintToBufferLength(storedSize, "packed XP3 index"),
			);
			try {
				indexData = await inflateZlibBuffer(
					packed,
					bigintToBufferLength(unpackedSize, "unpacked XP3 index"),
				);
			} catch (error) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Could not decompress the XP3 index",
					{
						cause: error,
					},
				);
			}
		} else {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported XP3 index encoding: ${method}`,
			);
		}

		entries.push(...parseIndex(indexData, source.size, entries.length));
		blockCount += 1;
		if (!continued) break;
		const nextPointerOffset = dataOffset + storedSize;
		if (
			nextPointerOffset > source.size ||
			source.size - nextPointerOffset < 8n
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"XP3 continued index is missing its next pointer",
			);
		}
		indexOffset = await readU64At(source, nextPointerOffset);
	}

	if (entries.length === 0)
		throw new GarbroError("INVALID_ARCHIVE", "XP3 archive contains no entries");
	return { entries, blockCount };
}

class Xp3ArchiveHandle implements ArchiveHandle {
	readonly format = xp3Descriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly Xp3Entry[];
	readonly sourcePath: string;
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: Xp3Entry[],
		blockCount: number,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.metadata = { indexBlockCount: blockCount, embeddedExecutable: false };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		if (entry.encrypted) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Encrypted XP3 entries are not supported: ${entry.path}`,
			);
		}
		const source = this.#source;
		return Readable.from(
			(async function* () {
				for (const segment of entry.segments) {
					const raw = source.createReadStream(
						segment.offset,
						segment.packedSize,
					);
					const stream = segment.compressed
						? createZlibInflateStream(raw)
						: raw;
					let bytesRead = 0n;
					for await (const chunk of stream) {
						const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
						bytesRead += BigInt(buffer.length);
						yield buffer;
					}
					if (bytesRead !== segment.size) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							`XP3 segment size mismatch for ${entry.path}`,
						);
					}
				}
			})(),
		);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class Xp3Format implements ArchiveFormat {
	readonly descriptor = xp3Descriptor;
	readonly detection = {
		signatures: [{ bytes: XP3_SIGNATURE }],
	};

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 19n) return false;
		return (await source.readAt(0n, XP3_SIGNATURE.length)).equals(
			XP3_SIGNATURE,
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		if (!(await this.detect(source))) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid or unsupported XP3 signature",
			);
		}
		const { entries, blockCount } = await readIndices(source);
		return new Xp3ArchiveHandle(source, sourcePath, entries, blockCount);
	}
}
