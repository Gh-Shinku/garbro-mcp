// Format reference: GARbro ArcFormats/BlackRainbow/ArcDAT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 8;
const BASE_OFFSET_OFFSET = 0x0c;
const INDEX_OFFSET = 0x10;
const NAME_SIZE = 0x24;
const SKIPPED_OFFSET = 0xffffffff;
const BMD_MARKER = Buffer.from("_BMD", "ascii");

export const blackRainbowDatDescriptor: FormatDescriptor = {
	id: "black-rainbow-dat",
	name: "BlackRainbow resource archive",
	extensions: ["dat", "pak"],
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
			source: "ArcFormats/BlackRainbow/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `DatOpener.TryOpen`. The index holds relative offsets that GARbro filters, converts, and
 * sorts before reading each entry's name from the data itself. Entries without a stored name get a
 * generated `<n>_<archive>#<n>` name, extended with `.bmd` when the payload starts with `_BMD`.
 */
async function readBlackRainbowDat(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = BigInt(header.readUInt32LE(BASE_OFFSET_OFFSET));
	const indexSize = count * 4;
	if (baseOffset >= source.size) return undefined;
	if (baseOffset < BigInt(INDEX_OFFSET + indexSize)) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		const stored = index.readUInt32LE(id * 4);
		if (stored === SKIPPED_OFFSET) continue;
		offsets.push(BigInt((baseOffset + BigInt(stored)) & 0xffffffffn));
	}
	offsets.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (const [id, dataOffset] of offsets.entries()) {
		if (dataOffset + BigInt(NAME_SIZE) > source.size) return undefined;
		const nameField = await source.readAt(dataOffset, NAME_SIZE);
		let name = decodeCStringField(nameField, 0, NAME_SIZE);
		if (name.length === 0) {
			const padded = String(id).padStart(2, "0");
			name = `${padded}_${baseName}#${padded}`;
			if (dataOffset + BigInt(NAME_SIZE + BMD_MARKER.length) <= source.size) {
				const marker = await source.readAt(
					dataOffset + BigInt(NAME_SIZE),
					BMD_MARKER.length,
				);
				if (marker.equals(BMD_MARKER)) name += ".bmd";
			}
		}
		const offset = dataOffset + BigInt(NAME_SIZE);
		const next = offsets[id + 1] ?? source.size;
		const size = next - offset;
		if (size < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	return entries;
}

export const blackRainbowDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blackRainbowDatDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readBlackRainbowDat(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readBlackRainbowDat(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid BlackRainbow DAT layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
