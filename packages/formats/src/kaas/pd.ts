// Format reference: GARbro "ArcFormats/Kaas/ArcKAAS.cs", class `PdOpener` and its index decryptors.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const INDEX_DESCRIPTOR_SIZE = 16;
const INDEX_HEADER_SIZE = 2;
const RECORD_SIZE = 8;
const COUNT_MASK = 0xfff;
/** The index of the old scheme is protected by a per byte subtraction. */
function decryptOldIndex(data: Uint8Array, key: number): void {
	for (let index = 0; index !== data.length; index += 1) {
		const k = index + 14;
		const r = (9 - Math.imul(Math.imul(k & 7, k + 5), key * 0x77)) | 0;
		data[index] = ((data[index] ?? 0) - (r & 0xff)) & 0xff;
	}
}

/** The index of the newer scheme mixes the byte position with the file key. */
function decryptDiscoveryIndex(data: Uint8Array, key: number): void {
	for (let index = 0; index !== data.length; index += 1) {
		const k = index + 14;
		const r =
			((Math.imul(k, 0x6b) % Math.trunc(k / 2 + 1)) +
				Math.imul(Math.imul(key * 0x3b, k + 11), k % (k + 17))) |
			0;
		data[index] = ((data[index] ?? 0) - (r & 0xff)) & 0xff;
	}
}

interface PdEntry {
	name: string;
	offset: bigint;
	size: number;
}

/** `PdOpener.ReadIndex`: validates every record of a decrypted index. */
function readDecryptedIndex(
	index: Buffer,
	baseName: string,
	dataOffset: bigint,
	maxOffset: bigint,
): PdEntry[] | undefined {
	const entries: PdEntry[] = [];
	for (let id = 0; id * RECORD_SIZE < index.length; id += 1) {
		const base = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(base));
		const size = index.readUInt32LE(base + 4);
		if (offset < dataOffset || offset >= maxOffset) return undefined;
		if (size === 0) continue;
		if (!checkPlacement(offset, BigInt(size), maxOffset)) return undefined;
		entries.push({
			name: `${baseName}#${String(id).padStart(4, "0")}`,
			offset,
			size,
		});
	}
	return entries.length === 0 ? undefined : entries;
}

async function readPdEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<PdEntry[] | undefined> {
	if (source.size <= BigInt(INDEX_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, INDEX_HEADER_SIZE);
	const indexOffset = header.readUInt8(0);
	const key = header.readUInt8(1);
	if (indexOffset <= INDEX_HEADER_SIZE || BigInt(indexOffset) >= source.size)
		return undefined;
	const countField = await source.readAt(
		BigInt(indexOffset),
		INDEX_HEADER_SIZE,
	);
	const count = countField.readUInt16LE(0) & COUNT_MASK;
	if (count === 0) return undefined;
	const start = BigInt(indexOffset + INDEX_DESCRIPTOR_SIZE);
	const indexSize = count * RECORD_SIZE;
	if (start + BigInt(indexSize) > source.size) return undefined;
	const stored = Buffer.from(await source.readAt(start, indexSize));
	const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
	const dot = fileName.lastIndexOf(".");
	const baseName = (dot > 0 ? fileName.slice(0, dot) : fileName) || "image";
	const dataOffset = start + BigInt(indexSize);
	// Both index schemes are tried in the order the reference lists them.
	for (const decrypt of [decryptDiscoveryIndex, decryptOldIndex]) {
		const index = Buffer.from(stored);
		decrypt(index, key);
		const entries = readDecryptedIndex(
			index,
			baseName,
			dataOffset,
			source.size,
		);
		if (entries) return entries;
	}
	return undefined;
}

export const kaasPdDescriptor: FormatDescriptor = {
	id: "kaas-pd",
	name: "KAAS engine PD resource archive",
	extensions: ["pd"],
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
			source: "ArcFormats/Kaas/ArcKAAS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kaasPdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaasPdDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPdEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPdEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KAAS PD index");
		const fixed: FixedEntry[] = entries.map((entry, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
				metadata: { type: "image" },
			}),
		);
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
