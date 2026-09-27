// Format reference: GARBro Legacy/StudioEbisu/ArcEP1.cs, class `Ep1Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
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

/** `LzssStream` of the reference: only the position of the ring stands of a count of its own. */
const LZSS_FRAME_INIT_POSITION = 0xff0;

/** `Ep1BitmapDecoder`: the places of a picture of this engine stand of four places of a colour to a pixel, of the
 * counts of the record of the entry, behind the head of the entry, of the walk the method of the record names. */
const ep1EntryOpener: FixedEntryOpener = async (source, entry) => {
	const metadata = entry.metadata as
		| { width?: number; height?: number; method?: number }
		| undefined;
	const width = Number(metadata?.width ?? 0);
	const height = Number(metadata?.height ?? 0);
	const method = Number(metadata?.method ?? 0);
	if (width <= 0 || height <= 0) {
		return source.createReadStream(entry.offset, entry.packedSize);
	}
	const pixels = width * height * 4;
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	// The reference reads the whole picture through the codec for the methods of four to seven, and the places
	// of the file as they are for every other method.
	const places =
		method >= 4 && method <= 7
			? inflateLzssAll(stored, { frameInitPosition: LZSS_FRAME_INIT_POSITION })
			: stored;
	const picture = Buffer.alloc(pixels, 0x00);
	places.copy(picture, 0, 0, Math.min(places.length, pixels));
	// `ImageData.Create` keeps the stored order top down, which a bitmap records with a height of its own sign.
	return Readable.from([writeBmp32(width, height, picture)]);
};

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
