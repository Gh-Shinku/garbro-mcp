// Format reference: GARbro ArcFormats/Banana/ArcPK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	decodeCp932,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

const INDEX_OFFSET = 4;
const MAXIMUM_NAME_LENGTH = 0x100;

export const bananaPkDescriptor: FormatDescriptor = {
	id: "banana-pk",
	name: "BANANA Shu-Shu resource archive",
	extensions: ["pk", "dat"],
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
			source: "ArcFormats/Banana/ArcPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isPacked(entry: FixedEntry): boolean {
	return entry.metadata?.packed === true;
}

const bananaEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!isPacked(entry))
		return source.createReadStream(entry.offset, entry.size);
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	return Readable.from([inflateLzssAll(compressed)]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	// GARbro requires the compressed-name index to be smaller than the file.
	if (BigInt(count * 10) >= source.size) return undefined;
	return count;
}

async function readBananaPk(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid BANANA PK layout");
	}
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position >= source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "BANANA PK index is truncated");
		}
		const nameLength = (await source.readAt(position, 1))[0] ?? 0;
		position += 1n;
		if (nameLength === 0 || nameLength > MAXIMUM_NAME_LENGTH) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"BANANA PK entry name length is invalid",
			);
		}
		if (position + BigInt(nameLength) + 8n > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "BANANA PK index is truncated");
		}
		const nameBytes = await source.readAt(position, nameLength);
		position += BigInt(nameLength);
		let key = (nameLength + 1) & 0xff;
		for (let index = 0; index < nameLength; index += 1) {
			const value = ((nameBytes[index] ?? 0) - key) & 0xff;
			if (value < 0x20 || value >= 0xfd) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"BANANA PK entry name is not printable",
				);
			}
			nameBytes[index] = value;
			key = (key - 1) & 0xff;
		}
		const name = decodeCp932(nameBytes);
		const record = await source.readAt(position, 8);
		position += 8n;
		const offset = BigInt(record.readUInt32BE(0));
		const size = BigInt(record.readUInt32BE(4));
		if (offset < position || !checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`BANANA PK entry points outside the archive: ${name}`,
			);
		}
		const packed = name.toLowerCase().endsWith(".scr");
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				compressed: packed,
				metadata: { packed },
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const bananaPkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bananaPkDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			await readBananaPk(source);
			return true;
		} catch {
			return false;
		}
	},
	read: readBananaPk,
	openEntry: bananaEntryOpener,
});
