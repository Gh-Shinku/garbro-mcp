// Format reference: GARbro ArcFormats/Amaterasu/ArcAMI.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	BufferCursor,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import type { Readable } from "node:stream";

const AMI_SIGNATURE = Buffer.from([0x41, 0x4d, 0x49, 0x00]);
const SCR_SIGNATURE = Buffer.from([0x53, 0x43, 0x52, 0x00]);
const GRP_SIGNATURE = Buffer.from([0x47, 0x52, 0x50, 0x00]);
const HEADER_SIZE = 16;
const RECORD_SIZE = 16;
const MAX_ENTRY_COUNT = 0xfffff;

interface AmiEntry extends ArchiveEntry {
	offset: bigint;
}

export const amiDescriptor: FormatDescriptor = {
	id: "ami",
	name: "Amaterasu Translations AMI archive",
	extensions: ["ami", "amr"],
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
			source: "ArcFormats/Amaterasu/ArcAMI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function formatId(id: number): string {
	return id.toString(16).padStart(8, "0");
}

async function readEntries(source: ByteSource): Promise<AmiEntry[]> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "AMI header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 4).equals(AMI_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AMI signature");
	}
	const count = header.readInt32LE(4);
	const baseOffset = BigInt(header.readUInt32LE(8));
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "AMI entry count is invalid");
	}
	const indexSize = count * RECORD_SIZE;
	const indexEnd = BigInt(HEADER_SIZE + indexSize);
	if (
		!Number.isSafeInteger(indexSize) ||
		indexEnd > baseOffset ||
		baseOffset >= source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "AMI index placement is invalid");
	}
	const cursor = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: AmiEntry[] = [];
	for (let index = 0; index < count; index += 1) {
		const numericId = cursor.readU32LE();
		const offset = BigInt(cursor.readU32LE());
		const size = BigInt(cursor.readU32LE());
		const storedPackedSize = BigInt(cursor.readU32LE());
		const compressed = storedPackedSize !== 0n;
		const packedSize = compressed ? storedPackedSize : size;
		if (
			offset < baseOffset ||
			offset > source.size ||
			packedSize > source.size - offset
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`AMI entry points outside the archive: ${formatId(numericId)}`,
			);
		}
		let extension = "dat";
		if (compressed) {
			extension = "grp";
		} else if (packedSize >= 4n) {
			const signature = await source.readAt(offset, 4);
			if (signature.equals(SCR_SIGNATURE)) extension = "scr";
			else if (signature.equals(GRP_SIGNATURE)) extension = "grp";
		}
		const id = formatId(numericId);
		entries.push({
			id,
			path: `${id}.${extension}`,
			size,
			packedSize,
			compressed,
			encrypted: false,
			offset,
			metadata: { numericId },
		});
	}
	return entries;
}

class AmiArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = amiDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = {};
	readonly entries: readonly AmiEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: AmiEntry[]) {
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
		const input = this.#source.createReadStream(entry.offset, entry.packedSize);
		return entry.compressed ? createZlibInflateStream(input) : input;
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class AmiFormat implements ArchiveFormat {
	readonly descriptor = amiDescriptor;
	readonly detection = { signatures: [{ bytes: AMI_SIGNATURE }] };

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(4);
		const baseOffset = BigInt(header.readUInt32LE(8));
		return (
			header.subarray(0, 4).equals(AMI_SIGNATURE) &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT &&
			BigInt(HEADER_SIZE + count * RECORD_SIZE) <= baseOffset &&
			baseOffset < source.size
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new AmiArchiveHandle(source, sourcePath, await readEntries(source));
	}
}
