// Format reference: GARbro ArcFormats/Palette/ArcPAK2.cs
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

const SIGNATURE = Buffer.from([0x05, 0x50, 0x41, 0x43, 0x4b, 0x32]);
const COUNT_OFFSET = 6;
const INDEX_OFFSET = 0x0a;
const MAXIMUM_NAME_SIZE = 0x40;

export const pak2Descriptor: FormatDescriptor = {
	id: "palette-pak2",
	name: "Palette resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/Palette/ArcPAK2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	return isSaneCount(count) ? count : undefined;
}

async function readPak2(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Palette PACK2 signature");
	}
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position >= source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Palette PACK2 index is truncated",
			);
		}
		const nameLength = (await source.readAt(position, 1))[0] ?? 0;
		position += 1n;
		if (nameLength === 0 || nameLength > MAXIMUM_NAME_SIZE) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Palette PACK2 entry name length is invalid",
			);
		}
		if (position + BigInt(nameLength) + 8n > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Palette PACK2 index is truncated",
			);
		}
		const nameBytes = await source.readAt(position, nameLength);
		position += BigInt(nameLength);
		for (let index = 0; index < nameBytes.length; index += 1) {
			nameBytes[index] = (nameBytes[index] ?? 0) ^ 0xff;
		}
		const name = decodeCp932(nameBytes);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Palette PACK2 entry has an empty name",
			);
		}
		const record = await source.readAt(position, 8);
		position += 8n;
		const offset = BigInt(record.readUInt32LE(0));
		const size = BigInt(record.readUInt32LE(4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Palette PACK2 entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const pak2Format: ArchiveFormat = defineFixedArchive({
	descriptor: pak2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readPak2,
});
