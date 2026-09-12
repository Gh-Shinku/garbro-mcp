// Format reference: GARbro ArcFormats/Selene/ArcKCAP.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferCursor,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Transform, type Readable } from "node:stream";
import { createKcapKeyTable } from "./kcap-key.js";

const KCAP_SIGNATURE = Buffer.from("KCAP", "ascii");
const HEADER_SIZE = 8;
const RECORD_SIZE = 0x54;
const NAME_SIZE = 0x40;
const MAX_ENTRY_COUNT = 0xfffff;

interface KcapEntry extends ArchiveEntry {
	offset: bigint;
}

interface KcapDirectory {
	entries: KcapEntry[];
	hasEncryptedEntries: boolean;
}

export const kcapDescriptor: FormatDescriptor = {
	id: "kcap",
	name: "Selene KCAP resource archive",
	extensions: ["pack"],
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
			source: "ArcFormats/Selene/ArcKCAP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readDirectory(source: ByteSource): Promise<KcapDirectory> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "KCAP header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 4).equals(KCAP_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid KCAP signature");
	}
	const count = header.readInt32LE(4);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "KCAP entry count is invalid");
	}
	const indexSize = count * RECORD_SIZE;
	if (
		!Number.isSafeInteger(indexSize) ||
		BigInt(HEADER_SIZE + indexSize) > source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "KCAP index is truncated");
	}
	const index = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: KcapEntry[] = [];
	let hasEncryptedEntries = false;
	for (let id = 0; id < count; id += 1) {
		const rawPath = index.readCString(NAME_SIZE);
		index.skip(8);
		const offset = BigInt(index.readU32LE());
		const size = BigInt(index.readU32LE());
		const encrypted = index.readU32LE() !== 0;
		if (!rawPath) {
			throw new GarbroError("INVALID_ARCHIVE", "KCAP entry has an empty name");
		}
		if (offset > source.size || size > source.size - offset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`KCAP entry points outside the archive: ${rawPath}`,
			);
		}
		hasEncryptedEntries ||= encrypted;
		entries.push({
			id: String(id),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted,
			offset,
		});
	}
	return { entries, hasEncryptedEntries };
}

function createDecryptStream(keyTable: Buffer): Transform {
	let keyOffset = 0;
	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			const output = Buffer.allocUnsafe(chunk.length);
			for (let index = 0; index < chunk.length; index += 1) {
				output[index] =
					(chunk[index] ?? 0) ^ (keyTable[(keyOffset + index) & 0xffff] ?? 0);
			}
			keyOffset = (keyOffset + chunk.length) & 0xffff;
			callback(null, output);
		},
	});
}

class KcapArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = kcapDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly KcapEntry[];
	readonly #source: ByteSource;
	readonly #keyTable: Buffer | undefined;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: KcapDirectory,
		passphrase: string,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.#keyTable = directory.hasEncryptedEntries
			? createKcapKeyTable(passphrase)
			: undefined;
		this.metadata = {
			hasEncryptedEntries: directory.hasEncryptedEntries,
			usesDefaultPassphrase: passphrase.length < 8,
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
		const input = this.#source.createReadStream(entry.offset, entry.size);
		if (!entry.encrypted) return input;
		if (!this.#keyTable) {
			throw new GarbroError("INVALID_ARCHIVE", "KCAP key table is unavailable");
		}
		return input.pipe(createDecryptStream(this.#keyTable));
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class KcapFormat implements ArchiveFormat {
	readonly descriptor = kcapDescriptor;
	readonly detection = { signatures: [{ bytes: KCAP_SIGNATURE }] };
	readonly #passphrase: string;

	constructor(passphrase = "") {
		this.#passphrase = passphrase;
	}

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(4);
		return (
			header.subarray(0, 4).equals(KCAP_SIGNATURE) &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT &&
			BigInt(HEADER_SIZE + count * RECORD_SIZE) <= source.size
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new KcapArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source),
			this.#passphrase,
		);
	}
}
