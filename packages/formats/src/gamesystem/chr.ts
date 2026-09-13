// Format reference: GARbro ArcFormats/GameSystem/ArcCHR.cs, class `ChrOpener`, and the metadata reader
// from ArcFormats/GameSystem/ImageCHR.cs, class `ChrFormat`.
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const CHR_HEADER_SIZE = 0x18;
const CHR_SIZE_FIELD = 0;
const CHR_RGB_SIZE_FIELD = 4;
const CHR_WIDTH_FIELD = 8;
const CHR_HEIGHT_FIELD = 0xc;
const CHR_OFFSET_X_FIELD = 0x10;
const CHR_OFFSET_Y_FIELD = 0x14;
const CHR_MINIMUM_RGB_SIZE = 0x20;
const CHR_MAX_DIMENSION = 0x8000;
/** The overlay header follows the indexed RGB plane directly. */
const OVERLAY_SIZE_SIZE = 4;
const OVERLAY_HEADER_SIZE = 8;
const OVERLAY_COUNT_FIELD = 4;
const FRAME_DIGITS = 2;

interface ChrEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

/**
 * `ChrOpener.TryOpen`: the file is a character image whose header describes an indexed RGB plane
 * followed by an overlay. Both halves are exposed as separate entries.
 */
async function readEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<ChrEntry[] | undefined> {
	if (!sourcePath.toLowerCase().endsWith(".chr")) return undefined;
	if (source.size < BigInt(CHR_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, CHR_HEADER_SIZE);
	if (BigInt(header.readUInt32LE(CHR_SIZE_FIELD)) !== source.size)
		return undefined;
	const rgbSize = header.readInt32LE(CHR_RGB_SIZE_FIELD);
	if (rgbSize <= CHR_MINIMUM_RGB_SIZE || BigInt(rgbSize) > source.size)
		return undefined;
	const width = header.readUInt32LE(CHR_WIDTH_FIELD);
	const height = header.readUInt32LE(CHR_HEIGHT_FIELD);
	const offsetX = header.readInt32LE(CHR_OFFSET_X_FIELD);
	const offsetY = header.readInt32LE(CHR_OFFSET_Y_FIELD);
	if (
		width === 0 ||
		width > CHR_MAX_DIMENSION ||
		height === 0 ||
		height > CHR_MAX_DIMENSION ||
		offsetX < 0 ||
		offsetX + width > CHR_MAX_DIMENSION ||
		offsetY < 0 ||
		offsetY + height > CHR_MAX_DIMENSION
	)
		return undefined;
	if (
		BigInt(rgbSize) + BigInt(OVERLAY_SIZE_SIZE + OVERLAY_HEADER_SIZE) >
		source.size
	)
		return undefined;
	const overlay = await source.readAt(
		BigInt(rgbSize),
		OVERLAY_SIZE_SIZE + OVERLAY_HEADER_SIZE,
	);
	const overlaySize = overlay.readUInt32LE(0);
	if (overlaySize === 0) return undefined;
	const count = overlay.readInt32LE(OVERLAY_SIZE_SIZE + OVERLAY_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const baseName = (sourcePath.split(/[\\/]/).pop() ?? "").replace(
		/\.[^.]*$/,
		"",
	);
	const entries: ChrEntry[] = [
		{
			name: `${baseName}#${String(0).padStart(FRAME_DIGITS, "0")}`,
			offset: 0n,
			size: BigInt(rgbSize),
		},
		{
			name: `${baseName}#${String(1).padStart(FRAME_DIGITS, "0")}`,
			offset: BigInt(rgbSize + OVERLAY_SIZE_SIZE),
			size: BigInt(overlaySize),
		},
	];
	for (const entry of entries) {
		if (!checkPlacement(entry.offset, entry.size, source.size))
			return undefined;
	}
	return entries;
}

export const gameSystemChrDescriptor: FormatDescriptor = {
	id: "gamesystem-chr",
	name: "Game System character frames",
	extensions: ["chr"],
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
			source: "ArcFormats/GameSystem/ArcCHR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameSystemChrFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameSystemChrDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Game System CHR layout",
			);
		return {
			entries: entries.map((entry, id) =>
				createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.size,
					metadata: { type: "image" },
				}),
			),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
