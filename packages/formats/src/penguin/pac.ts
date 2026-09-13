// Format reference: GARBro Legacy/PenguinWorks/ArcPAC.cs, class `PacOpener`. The `ike` payload
// decoder it shares with the U-Me Soft resource archives lives in `IkeReader` in
// Legacy/UMeSoft/ArcBIN.cs.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { decodeIkeSize, unpackIke } from "../ume-soft/ike.js";

const EXTENSION = "pac";
const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const RECORD_SIZE = 0xc;
const NAME_WIDTH = 4;
/** Known archives name their records after the archive itself plus a fixed extension. */
const CONTENT_EXTENSIONS: Record<string, string> = {
	TAK: "BIN",
	VIS: "BMP",
	EFT: "WAV",
	BGM: "STR",
};
/** Packed payloads carry an `ike` marker two bytes in and a thirteen-byte header. */
const IKE_MARKER_OFFSET = 2;
const IKE_HEADER_SIZE = 13;
const IKE_SIZE_OFFSET = 10;

/**
 * GARBro `PacOpener.TryOpen`. The archive needs a `.pac` extension, a record count at offset zero and
 * twelve-byte records at offset four: a numeric identifier, the payload offset and the stored size.
 *
 * Record names are built from the archive's own name, upper-cased and without its extension, plus a
 * four-digit identifier. Archives whose base name is one of the engine's known kinds — `TAK`, `VIS`,
 * `EFT` and `BGM` — append the matching `.bin`, `.bmp`, `.wav` or `.str` extension.
 *
 * The reference decides at extraction time whether a payload is packed by probing for the `ike`
 * marker; the port does it while parsing so the listing and extraction agree, and requires the stored
 * extent to be large enough to hold the thirteen-byte header before treating it as packed.
 */
async function readPenguinIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath ?? "") !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;

	const baseName = basename(sourcePath ?? "")
		.replace(/\.[^.]*$/, "")
		.toUpperCase();
	const contentExtension = CONTENT_EXTENSIONS[baseName];

	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = `${baseName}${String(index.readUInt32LE(record)).padStart(
			NAME_WIDTH,
			"0",
		)}${contentExtension === undefined ? "" : `.${contentExtension}`}`;
		const offset = BigInt(index.readUInt32LE(record + 4));
		const storedSize = BigInt(index.readUInt32LE(record + 8));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		if (
			storedSize > BigInt(IKE_HEADER_SIZE) &&
			(await source.readAt(offset + BigInt(IKE_MARKER_OFFSET), 3)).toString(
				"latin1",
			) === "ike"
		) {
			if (offset + BigInt(IKE_SIZE_OFFSET) + 3n > source.size) return undefined;
			const sizeBytes = await source.readAt(
				offset + BigInt(IKE_SIZE_OFFSET),
				3,
			);
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(name),
					offset: offset + BigInt(IKE_HEADER_SIZE),
					size: BigInt(
						decodeIkeSize(
							sizeBytes[0] ?? 0,
							sizeBytes[1] ?? 0,
							sizeBytes[2] ?? 0,
						),
					),
					packedSize: storedSize - BigInt(IKE_HEADER_SIZE),
					compressed: true,
				}),
			);
			continue;
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
	}
	return entries;
}

/** GARbro `PacOpener.OpenEntry`: `ike` payloads are decoded, everything else is emitted verbatim. */
const pacEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([unpackIke(stored, Number(entry.size))]);
};

export const penguinPacDescriptor: FormatDescriptor = {
	id: "penguin-pac",
	name: "Penguin Works resource archive",
	extensions: [EXTENSION],
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
			source: "Legacy/PenguinWorks/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const penguinPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: penguinPacDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readPenguinIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPenguinIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Penguin PAC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pacEntryOpener,
});
