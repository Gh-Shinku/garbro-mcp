// Format reference: GARbro ArcFormats/Yatagarasu/ArcPKG.cs (with ByteStringEncryptedStream from ArcFormats/SimpleEncryption.cs)
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const EXTENSION = "pkg";
const KEY_OFFSETS = [0x84, 0x10c];
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x80;
const RECORD_SIZE = NAME_SIZE + 8;
const KEY_SIZE = 4;

export const pkgDescriptor: FormatDescriptor = {
	id: "yatagarasu-pkg",
	name: "Yatagarasu resource archive",
	extensions: ["pkg"],
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
			source: "ArcFormats/Yatagarasu/ArcPKG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/SimpleEncryption.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `ByteStringEncryptedStream`: a repeating-key XOR. The key index is the stream position, so
 * the file-level reads use `position % 4` while every payload restarts at zero.
 */
function xorWithKey(data: Buffer, key: Buffer, startIndex = 0): void {
	for (let position = 0; position < data.length; position += 1) {
		data[position] =
			(data[position] ?? 0) ^ (key[(startIndex + position) % key.length] ?? 0);
	}
}

async function readU32(source: ByteSource, offset: number): Promise<number> {
	const bytes = await source.readAt(BigInt(offset), KEY_SIZE);
	return bytes.readUInt32LE(0);
}

interface PkgIndex {
	keyValue: number;
	key: Buffer;
	entries: FixedEntry[];
}

/**
 * GARbro `PkgOpener.TryOpen`. The last four bytes of the first two 0x80-byte name fields hold the
 * same repeating key; the count at 4 and the whole index are XOR-encrypted with it.
 */
async function readPkgIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<PkgIndex | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	const [first, second] = KEY_OFFSETS as [number, number];
	if (source.size < BigInt(second + KEY_SIZE)) return undefined;
	const keyValue = await readU32(source, first);
	if (keyValue !== (await readU32(source, second))) return undefined;
	const key = Buffer.alloc(KEY_SIZE);
	key.writeUInt32LE(keyValue, 0);
	const count = (await readU32(source, COUNT_OFFSET)) ^ keyValue;
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	xorWithKey(index, key);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE));
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
			}),
		);
	}
	return { keyValue, key, entries };
}

const pkgEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	const keyValue = entry.metadata?.key;
	if (typeof keyValue === "number" && keyValue !== 0) {
		const key = Buffer.alloc(KEY_SIZE);
		key.writeUInt32LE(keyValue, 0);
		xorWithKey(payload, key, 0);
	}
	return Readable.from([payload]);
};

export const pkgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pkgDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPkgIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readPkgIndex(source, sourcePath);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Yatagarasu PKG layout");
		const entries = index.entries.map((entry) => ({
			...entry,
			metadata: { key: index.keyValue },
		}));
		return {
			entries,
			metadata: { entryCount: entries.length, key: index.keyValue },
		};
	},
	openEntry: pkgEntryOpener,
});
