// Format reference: GARbro ArcFormats/FrontWing/ArcFG.cs
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("FWGI", "ascii");
const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x1ac;
const RECORD_MARKER = 1;
const OFFSET_X_OFFSET = 8;
const OFFSET_Y_OFFSET = 0x0c;
const WIDTH_OFFSET = 0x18;
const HEIGHT_OFFSET = 0x1c;
const NAME_OFFSET = 0x20;
const NAME_SIZE = 0x104;
const DATA_OFFSET_OFFSET = 0x124;
const SIZE_OFFSET = 0x128;
/** GARbro skips a four-byte prefix in front of each layer's bitmap. */
const DATA_PREFIX = 4;

export const fgDescriptor: FormatDescriptor = {
	id: "frontwing-fg",
	name: "FrontWing multi-layer image",
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
			source: "ArcFormats/FrontWing/ArcFG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `FgOpener.TryOpen`. Records start at 4 and run while their leading 32-bit marker is one.
 * Each 0x1ac-byte record carries layer placement, size, a 0x104-byte name field, and the offset and
 * size of the bitmap layer that follows.
 */
async function readFgIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 4)) return undefined;
	const signature = await source.readAt(0n, INDEX_OFFSET);
	if (!signature.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(INDEX_OFFSET);
	while (indexOffset + BigInt(RECORD_SIZE) <= source.size) {
		const record = await source.readAt(indexOffset, RECORD_SIZE);
		if (record.readInt32LE(0) !== RECORD_MARKER) break;
		const name = basename(
			decodeCStringField(record, NAME_OFFSET, NAME_SIZE).replaceAll("\\", "/"),
		);
		const offset =
			BigInt(record.readUInt32LE(DATA_OFFSET_OFFSET)) + BigInt(DATA_PREFIX);
		const size = BigInt(record.readUInt32LE(SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
				metadata: {
					offsetX: record.readInt32LE(OFFSET_X_OFFSET),
					offsetY: record.readInt32LE(OFFSET_Y_OFFSET),
					width: record.readUInt32LE(WIDTH_OFFSET),
					height: record.readUInt32LE(HEIGHT_OFFSET),
					bpp: 32,
				},
			}),
		);
		indexOffset += BigInt(RECORD_SIZE);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const fgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fgDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFgIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readFgIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FrontWing FG layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
