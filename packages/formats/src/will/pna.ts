// Format reference: GARBro ArcFormats/Will/ArcPNA.cs, class `PnaOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PNAP", "ascii");
const COUNT_OFFSET = 0x10;
const INDEX_START = 0x14;
const RECORD_SIZE = 0x28;
const X_OFFSET = 0x08;
const Y_OFFSET = 0x0c;
const WIDTH_OFFSET = 0x10;
const HEIGHT_OFFSET = 0x14;
const SIZE_OFFSET = 0x24;
const NAME_WIDTH = 3;
/** Every frame is stored as thirty-two bit colour. */
const BITS_PER_PIXEL = 32;

/**
 * GARBro `PnaOpener.TryOpen`. A `PNAP` header carries the frame count at 0x10 and a table of 0x28-byte
 * frame records from 0x14. Payloads follow the table in record order.
 *
 * A record with a zero size is skipped and does not advance the payload cursor, which is where the
 * reference's logic differs from a plain walk: skipped frames also leave a gap in the numbering, because
 * frame names use the record index rather than the entry count.
 *
 * Frames are named `<archive>#<index>` with a three-digit index and typed as images. Their placement and
 * the frame geometry — position, size and thirty-two bit colour — are recorded as metadata; decoding the
 * frames themselves belongs to the image layer and is out of scope.
 */
async function readPnaIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const tableEnd = BigInt(INDEX_START + count * RECORD_SIZE);
	if (tableEnd > source.size) return undefined;

	const baseName = basename(sourcePath ?? "").replace(/\.[^.]*$/, "");
	const index = await source.readAt(BigInt(INDEX_START), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	let payloadOffset = tableEnd;
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		if (size === 0n) continue;
		if (!checkPlacement(payloadOffset, size, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(NAME_WIDTH, "0")}`,
			),
			offset: payloadOffset,
			size,
			metadata: {
				type: "image",
				x: index.readInt32LE(record + X_OFFSET),
				y: index.readInt32LE(record + Y_OFFSET),
				width: index.readUInt32LE(record + WIDTH_OFFSET),
				height: index.readUInt32LE(record + HEIGHT_OFFSET),
				bpp: BITS_PER_PIXEL,
			},
		});
		entries.push(entry);
		payloadOffset += size;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** The reference archive has no opener of its own, so frames are handed out as stored. */
const pnaEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.packedSize);

export const willPnaDescriptor: FormatDescriptor = {
	id: "will-pna",
	name: "Pulltop multi-frame image format",
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
			source: "ArcFormats/Will/ArcPNA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const willPnaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: willPnaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPnaIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPnaIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PNA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pnaEntryOpener,
});
