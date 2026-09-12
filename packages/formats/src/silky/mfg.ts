// Format reference: GARbro ArcFormats/Silky/ArcMFG.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ALPF", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x14;
const MAXIMUM_COUNT = 0xfffff;

export const silkyMfgDescriptor: FormatDescriptor = {
	id: "silky-mfg",
	name: "Silky's engine resource archive",
	extensions: ["mfg", "mfm", "mfs"],
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
			source: "ArcFormats/Silky/ArcMFG.cs",
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
	if (count <= 0 || count > MAXIMUM_COUNT) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readSilkyMfg(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky's MFG signature");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Silky's MFG entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		const nextOffset =
			id + 1 < count
				? BigInt(index.readUInt32LE(recordOffset + RECORD_SIZE + NAME_SIZE))
				: source.size;
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Silky's MFG entry points outside the archive: ${name}`,
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

export const silkyMfgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: silkyMfgDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readSilkyMfg,
});
