// Format reference: GARbro ArcFormats/Patisserie/ArcRAW.cs
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
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("RAW\x04", "latin1");
const END_OFFSET = 4;
const FIRST_FRAME_OFFSET = 8;
const FRAME_HEADER_SIZE = 0x14;
const WIDTH_OFFSET = 0x0c;
const HEIGHT_OFFSET = 0x10;
const BYTES_PER_PIXEL = 4;

export const patisserieRawDescriptor: FormatDescriptor = {
	id: "patisserie-raw",
	name: "Patisserie animation resource",
	extensions: ["raw"],
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
			source: "ArcFormats/Patisserie/ArcRAW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `RawOpener.TryOpen`: a header stores the offset of the last frame relative to 8, and every
 * frame is sized from its own dimensions as a 0x14-byte header plus 32-bit pixels. Entries are named
 * after their position.
 */
async function readRawFrames(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_FRAME_OFFSET)) return undefined;
	const header = await source.readAt(0n, FIRST_FRAME_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const declared = BigInt(header.readUInt32LE(END_OFFSET));
	if (declared > source.size - BigInt(FIRST_FRAME_OFFSET)) return undefined;
	const end = declared + BigInt(FIRST_FRAME_OFFSET);
	const entries: FixedEntry[] = [];
	let offset = BigInt(FIRST_FRAME_OFFSET);
	while (offset < end) {
		if (offset + BigInt(FRAME_HEADER_SIZE) > source.size) return undefined;
		const frameHeader = await source.readAt(offset, FRAME_HEADER_SIZE);
		const width = BigInt(frameHeader.readUInt32LE(WIDTH_OFFSET));
		const height = BigInt(frameHeader.readUInt32LE(HEIGHT_OFFSET));
		const size =
			BigInt(FRAME_HEADER_SIZE) + width * height * BigInt(BYTES_PER_PIXEL);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(String(entries.length).padStart(4, "0")),
				offset,
				size,
				metadata: {
					width: width.toString(),
					height: height.toString(),
					bpp: 32,
				},
			}),
		);
		offset += size;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const patisserieRawFormat: ArchiveFormat = defineFixedArchive({
	descriptor: patisserieRawDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readRawFrames(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readRawFrames(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Patisserie RAW layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
