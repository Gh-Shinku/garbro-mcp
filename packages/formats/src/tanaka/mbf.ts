// Format reference: GARbro ArcFormats/Tanaka/ArcMBF.cs
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURES = [
	Buffer.from("MBF0", "ascii"),
	Buffer.from("MBF1", "ascii"),
] as const;
const COUNT_OFFSET = 4;
const DATA_OFFSET_OFFSET = 8;
const FLAG_OFFSET = 0x0c;
const INDEX_OFFSET = 0x20;
/** Contained payload headers: "BC" stores a 32-bit size at +2, "$SEQ" at +4. */
const BC_MARKER = Buffer.from("BC", "ascii");
const SEQ_MARKER = Buffer.from("$SEQ", "ascii");
const BC_SIZE_OFFSET = 2;
const SEQ_SIZE_OFFSET = 4;

export const mbfDescriptor: FormatDescriptor = {
	id: "will-mbf",
	name: "Tanaka Tatsuhiro engine image archive",
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
			source: "ArcFormats/Tanaka/ArcMBF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `MbfOpener.TryOpen`. Names come from a length-prefixed index, while every size is read from
 * the payload header the archive keeps in front of the data. A flag bit marks an extra index record
 * that is skipped together with one count.
 */
async function readMbfIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 2)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET + 2);
	if (!SIGNATURES.some((signature) => header.subarray(0, 4).equals(signature)))
		return undefined;
	let count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	let dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_OFFSET));
	let indexOffset = INDEX_OFFSET;
	if ((header[FLAG_OFFSET] ?? 0) & 1 && count > 1) {
		indexOffset += header.readUInt16LE(INDEX_OFFSET);
		count -= 1;
	}
	if (BigInt(indexOffset) > source.size) return undefined;
	const names: string[] = [];
	for (let id = 0; id < count; id += 1) {
		if (BigInt(indexOffset + 2) > source.size) return undefined;
		const nameLength = (
			await source.readAt(BigInt(indexOffset), 2)
		).readUInt16LE(0);
		if (nameLength < 3) return undefined;
		if (BigInt(indexOffset + nameLength) > source.size) return undefined;
		const record = await source.readAt(BigInt(indexOffset), nameLength);
		const name = decodeCStringField(record, 2, nameLength - 2);
		if (name.length === 0) return undefined;
		names.push(name);
		indexOffset += nameLength;
	}

	const entries: FixedEntry[] = [];
	for (const [id, name] of names.entries()) {
		if (dataOffset >= source.size) return undefined;
		const marker = await source.readAt(dataOffset, SEQ_MARKER.length);
		let size: bigint;
		if (marker.subarray(0, BC_MARKER.length).equals(BC_MARKER)) {
			size = BigInt(
				(
					await source.readAt(dataOffset + BigInt(BC_SIZE_OFFSET), 4)
				).readUInt32LE(0),
			);
		} else if (marker.equals(SEQ_MARKER)) {
			size = BigInt(
				(
					await source.readAt(dataOffset + BigInt(SEQ_SIZE_OFFSET), 4)
				).readUInt32LE(0),
			);
		} else {
			return undefined;
		}
		if (!checkPlacement(dataOffset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: dataOffset,
				size,
			}),
		);
		dataOffset += size;
	}
	return entries;
}

export const mbfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mbfDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMbfIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readMbfIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka MBF layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
