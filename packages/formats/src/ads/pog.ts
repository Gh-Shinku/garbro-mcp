// Format reference: GARbro ArcFormats/Ads/ArcPOG.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("POG\0", "binary");
const NAMES_OFFSET_OFFSET = 4;
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x10;
const MAXIMUM_NAME_LENGTH = 0x400;

export const pogDescriptor: FormatDescriptor = {
	id: "ads-pog",
	name: "ads engine audio archive",
	extensions: [],
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
			source: "ArcFormats/Ads/ArcPOG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface PogHeader {
	count: number;
	namesOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<PogHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const namesOffset = BigInt(header.readUInt32LE(NAMES_OFFSET_OFFSET));
	if (namesOffset <= BigInt(INDEX_OFFSET) || namesOffset >= source.size)
		return undefined;
	if (BigInt(INDEX_OFFSET + (count + 1) * 4) > source.size) return undefined;
	return { count, namesOffset };
}

async function readPog(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid ads POG layout");
	}
	const { count, namesOffset } = header;
	const offsets = await source.readAt(BigInt(INDEX_OFFSET), (count + 1) * 4);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(offsets.readUInt32LE(id * 4));
		const nextOffset = BigInt(offsets.readUInt32LE((id + 1) * 4));
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ads POG entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${String(id).padStart(4, "0")}`,
				offset,
				size,
			}),
		);
	}
	// The name section is a sequence of (length, index, CP932 name) records.
	let position = namesOffset + 4n;
	while (position + 8n <= source.size && entries.length > 0) {
		const record = await source.readAt(position, 8);
		const length = record.readInt32LE(0);
		const index = record.readInt32LE(4);
		position += 8n;
		if (length < 4 || length > MAXIMUM_NAME_LENGTH) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ads POG name length is invalid",
			);
		}
		if (position + BigInt(length - 4) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "ads POG names are truncated");
		}
		const field = await source.readAt(position, length - 4);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		position += BigInt(terminator === -1 ? length - 4 : terminator + 1);
		if (index < 0 || index >= entries.length) {
			throw new GarbroError("INVALID_ARCHIVE", "ads POG name index is invalid");
		}
		if (name.length === 0) continue;
		const entry = entries[index];
		if (!entry) continue;
		const normalized = normalizeEntryPath(name);
		entry.path = normalized.path;
		if (normalized.rawPath !== undefined) entry.rawPath = normalized.rawPath;
		entry.metadata = { type: "audio" };
	}
	return { entries, metadata: { entryCount: count } };
}

export const pogFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pogDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readPog,
});
