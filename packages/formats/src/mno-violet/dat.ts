// Format reference: GARbro ArcFormats/MnoViolet/ArcMnoViolet.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
/** GARbro probes these name field widths in order. */
const NAME_SIZES = [100, 68, 44] as const;
const RECORD_TAIL_SIZE = 8;
const SIZE_OFFSET = 0;
const OFFSET_OFFSET = 4;

export const mnvDescriptor: FormatDescriptor = {
	id: "mno-violet-dat",
	name: "M no Violet resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/MnoViolet/ArcMnoViolet.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `DatOpener.TryOpen`. The name field width is not stored, so GARbro tries 100, 68, and 44
 * bytes in turn: a candidate is accepted only when the first data offset equals the end of the
 * derived index and every record has a name, an offset behind the index, and a valid data range.
 *
 * GARbro derives entry types from payload signatures; the port keeps the stored names.
 */
async function readMnvIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "dat") return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	for (const nameSize of NAME_SIZES) {
		const indexSize = (nameSize + RECORD_TAIL_SIZE) * count;
		if (BigInt(INDEX_OFFSET + nameSize + 4) > source.size) continue;
		const firstOffset = BigInt(
			(
				await source.readAt(BigInt(INDEX_OFFSET + nameSize + OFFSET_OFFSET), 4)
			).readUInt32LE(0),
		);
		if (firstOffset !== BigInt(INDEX_OFFSET + indexSize)) continue;
		if (firstOffset >= source.size) continue;
		const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
		const entries: FixedEntry[] = [];
		let valid = true;
		for (let id = 0; id < count; id += 1) {
			const record = id * (nameSize + RECORD_TAIL_SIZE);
			const name = decodeCStringField(index, record, nameSize);
			if (name.trim().length === 0) {
				valid = false;
				break;
			}
			const size = BigInt(index.readUInt32LE(record + nameSize + SIZE_OFFSET));
			const offset = BigInt(
				index.readUInt32LE(record + nameSize + OFFSET_OFFSET),
			);
			// GARbro compares the offset against the index size alone.
			if (offset <= BigInt(indexSize)) {
				valid = false;
				break;
			}
			if (!checkPlacement(offset, size, source.size)) {
				valid = false;
				break;
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
		if (valid) return entries;
	}
	return undefined;
}

export const mnvFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mnvDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMnvIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMnvIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid M no Violet DAT layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
