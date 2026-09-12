// Format reference: GARbro ArcFormats/Favorite/ArcFVP.cs
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
import { Readable } from "node:stream";
import { decompressAcpLzw } from "./acp-lzw.js";

const ACPX_SIGNATURE = Buffer.from("ACPXPK01", "ascii");
const ACP_ALTERNATE_SIGNATURE = Buffer.from("ACP_PK.1", "ascii");
const ACP_ENTRY_SIGNATURE = Buffer.from([0x61, 0x63, 0x70, 0x00]);
const HEADER_SIZE = 0x0c;
const RECORD_SIZE = 0x28;
const NAME_SIZE = 0x20;
const MAX_ENTRY_COUNT = 0xfffff;

interface AcpxEntry extends ArchiveEntry {
	offset: bigint;
}

export const acpxDescriptor: FormatDescriptor = {
	id: "favorite-acpx",
	name: "Favorite View Point ACPXPK archive",
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
			source: "ArcFormats/Favorite/ArcFVP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function hasSignature(header: Buffer): boolean {
	return (
		header.subarray(0, 8).equals(ACPX_SIGNATURE) ||
		header.subarray(0, 8).equals(ACP_ALTERNATE_SIGNATURE)
	);
}

async function readEntries(source: ByteSource): Promise<AcpxEntry[]> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "ACPXPK header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!hasSignature(header)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid ACPXPK signature");
	}
	const count = header.readInt32LE(8);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "ACPXPK entry count is invalid");
	}
	const indexSize = count * RECORD_SIZE;
	if (
		!Number.isSafeInteger(indexSize) ||
		BigInt(HEADER_SIZE + indexSize) > source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "ACPXPK index is truncated");
	}
	const index = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: AcpxEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const rawPath = index.readCString(NAME_SIZE);
		const offset = BigInt(index.readU32LE());
		const packedSize = BigInt(index.readU32LE());
		if (!rawPath) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ACPXPK entry has an empty name",
			);
		}
		if (offset > source.size || packedSize > source.size - offset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`ACPXPK entry points outside the archive: ${rawPath}`,
			);
		}
		let size = packedSize;
		let compressed = false;
		if (packedSize > 8n) {
			const entryHeader = await source.readAt(offset, 8);
			if (entryHeader.subarray(0, 4).equals(ACP_ENTRY_SIGNATURE)) {
				const unpackedSize = entryHeader.readInt32BE(4);
				if (unpackedSize < 0) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						`ACPXPK entry has an invalid output size: ${rawPath}`,
					);
				}
				size = BigInt(unpackedSize);
				compressed = true;
			}
		}
		entries.push({
			id: String(id),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize,
			compressed,
			encrypted: false,
			offset,
		});
	}
	return entries;
}

class AcpxArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = acpxDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = {};
	readonly entries: readonly AcpxEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: AcpxEntry[]) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		if (!entry.compressed) {
			return this.#source.createReadStream(entry.offset, entry.packedSize);
		}
		const packed = await this.#source.readAt(
			entry.offset + 8n,
			bigintToBufferLength(entry.packedSize - 8n, "ACP LZW entry"),
		);
		const output = decompressAcpLzw(
			packed,
			bigintToBufferLength(entry.size, "ACP LZW output"),
		);
		return Readable.from([output]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class AcpxFormat implements ArchiveFormat {
	readonly descriptor = acpxDescriptor;
	readonly detection = {
		signatures: [{ bytes: ACPX_SIGNATURE }, { bytes: ACP_ALTERNATE_SIGNATURE }],
	};

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(8);
		return (
			hasSignature(header) &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT &&
			BigInt(HEADER_SIZE + count * RECORD_SIZE) <= source.size
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new AcpxArchiveHandle(source, sourcePath, await readEntries(source));
	}
}
