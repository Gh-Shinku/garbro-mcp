// Format reference: GARBro Legacy/StudioEbisu/ArcEP1.cs, class `Ep1Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("EP1", "ascii");
const IMAGE_INDEX_START = 8;
const HEADER_SIZE = 0x30;
const NAME_SIZE = 0x20;
const WIDTH_OFFSET = 0x20;
const HEIGHT_OFFSET = 0x24;
const METHOD_OFFSET = 0x28;
const SIZE_OFFSET = 0x2c;
/** The reference always presents these records as 32-bit bitmaps. */
const BITS_PER_PIXEL = 32;

/**
 * GARBro `Ep1Opener.TryOpen`. The `EP1` signature is followed directly by a chain of image records
 * that runs to the end of the file: each record is a 0x30-byte header holding a 0x20-byte CP932 name,
 * the image width, height and compression method, and the payload size, with the payload right behind
 * it. The walk simply advances by the header plus the payload size, so a record that would end past the
 * file — or one whose name is empty — rejects the archive.
 *
 * Records are typed as images and carry the image geometry and compression method in their metadata.
 * The pixel decoding the reference performs in `OpenImage` (32-bit BGRA rows, LZSS for methods four
 * through seven) belongs to the image layer rather than to the archive layer.
 */
async function readEp1Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(IMAGE_INDEX_START + HEADER_SIZE)) return undefined;
	const signature = await source.readAt(0n, SIGNATURE.length);
	if (!signature.equals(SIGNATURE)) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(IMAGE_INDEX_START);
	while (indexOffset < source.size) {
		if (indexOffset + BigInt(HEADER_SIZE) > source.size) return undefined;
		const header = await source.readAt(indexOffset, HEADER_SIZE);
		const name = decodeCStringField(header, 0, NAME_SIZE);
		if (name.length === 0) return undefined;
		const payloadOffset = indexOffset + BigInt(HEADER_SIZE);
		const size = BigInt(header.readUInt32LE(SIZE_OFFSET));
		if (!checkPlacement(payloadOffset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset: payloadOffset,
				size,
				packedSize: size,
				metadata: {
					type: "image",
					width: header.readUInt32LE(WIDTH_OFFSET),
					height: header.readUInt32LE(HEIGHT_OFFSET),
					method: header.readInt32LE(METHOD_OFFSET),
					bpp: BITS_PER_PIXEL,
				},
			}),
		);
		indexOffset = payloadOffset + size;
	}
	return entries;
}

/** The reference decodes pixels in `OpenImage`; the archive layer emits the stored range. */
const ep1EntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.packedSize);

export const ebisuEp1Descriptor: FormatDescriptor = {
	id: "ebisu-ep1",
	name: "Studio Ebisu resource archive",
	extensions: ["ep1"],
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
			source: "Legacy/StudioEbisu/ArcEP1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ebisuEp1Format: ArchiveFormat = defineFixedArchive({
	descriptor: ebisuEp1Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readEp1Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readEp1Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid EP1 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: ep1EntryOpener,
});
