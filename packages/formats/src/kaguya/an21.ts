// Format reference: GARBro ArcFormats/Kaguya/ArcAN21.cs, class `An21Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { decompressKaguyaRle } from "./pl10.js";

/** The signature spells `AN21`. */
const SIGNATURE = Buffer.from("AN21", "ascii");
const EXTENSION = "anm";
const TABLE_COUNT_OFFSET = 4;
const FIRST_TABLE_OFFSET = 8;
/** Table records are a type byte; type one is followed by eight bytes and types two to five by four. */
const TABLE_TYPE_ONE_SIZE = 8;
const TABLE_TYPE_MULTI_SIZE = 4;
const TABLE_TYPE_LIMIT = 5;
/** Behind the tables comes a marker and then a name table counted by a word. */
const MARKER = Buffer.from("[PIC]10", "ascii");
const NAME_TABLE_ENTRY_SIZE = 8;
const NAME_TABLE_COUNT_SIZE = 2;
/** The frame block starts behind the marker, which is followed by a count and a gap. */
const FRAME_COUNT_GAP = 0x12;
const FRAME_HEADER_SIZE = 0x14;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
const CHANNELS_OFFSET = 0x10;
const PACKED_HEADER_SIZE = 5;
const FRAME_DIGITS = 2;

export const kaguyaAn21Descriptor: FormatDescriptor = {
	id: "kaguya-an21",
	name: "KaGuYa script engine animation resource",
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
			source: "ArcFormats/Kaguya/ArcAN21.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `An21Opener.TryOpen`. The word at 4 counts a table whose records start at 8: a type byte of zero
 * contributes nothing, one skips eight bytes, two to five skip four, and any other value rejects the archive.
 * Behind the table sits a marker spelling `[PIC]10` after a counted, eight-byte-stride name table, so the
 * whole preamble has to be walked to find where the frames begin.
 *
 * The marker is followed by a frame count and then a gap of 0x12 bytes, after which an information block
 * gives the offsets, the width, the height and a channel word the reference multiplies by eight for the bits
 * per pixel. The first frame follows that 0x14-byte block as a raw image of channels × width × height bytes.
 * Every later frame carries a step byte and a packed size ahead of RLE pixels whose *declared* output length
 * is channels × (offsetX + width) × (offsetY + height) rather than the image size, which is how the reference
 * accounts for neighbouring frame data; the port mirrors that formula and records the image size separately.
 *
 * A step byte of zero rejects the archive, as in the reference, and packed frames are expanded with the same
 * interleaved RLE that the sibling `PL10` format uses, whose decoder is shared here.
 */
async function readAn21Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_TABLE_OFFSET)) return undefined;
	const head = await source.readAt(0n, FIRST_TABLE_OFFSET);
	if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const tableCount = head.readUInt16LE(TABLE_COUNT_OFFSET);
	if (!isSaneCount(tableCount)) return undefined;

	let cursor = BigInt(FIRST_TABLE_OFFSET);
	for (let id = 0; id < tableCount; id += 1) {
		if (cursor + 1n > source.size) return undefined;
		const type = (await source.readAt(cursor, 1)).readUInt8(0);
		cursor += 1n;
		if (type === 0) continue;
		if (type === 1) {
			cursor += BigInt(TABLE_TYPE_ONE_SIZE);
			continue;
		}
		if (type >= 2 && type <= TABLE_TYPE_LIMIT) {
			cursor += BigInt(TABLE_TYPE_MULTI_SIZE);
			continue;
		}
		return undefined;
	}
	if (cursor + BigInt(NAME_TABLE_COUNT_SIZE) > source.size) return undefined;
	const nameTableCount = (
		await source.readAt(cursor, NAME_TABLE_COUNT_SIZE)
	).readUInt16LE(0);
	cursor += BigInt(
		NAME_TABLE_COUNT_SIZE + nameTableCount * NAME_TABLE_ENTRY_SIZE,
	);
	if (cursor + BigInt(MARKER.length) > source.size) return undefined;
	const marker = await source.readAt(cursor, MARKER.length);
	if (!marker.equals(MARKER)) return undefined;
	cursor += BigInt(MARKER.length);
	if (cursor + 2n > source.size) return undefined;
	const frameCount = (await source.readAt(cursor, 2)).readInt16LE(0);
	if (!isSaneCount(frameCount)) return undefined;
	cursor += BigInt(FRAME_COUNT_GAP);
	if (cursor + BigInt(FRAME_HEADER_SIZE) > source.size) return undefined;
	const info = await source.readAt(cursor, FRAME_HEADER_SIZE);
	const offsetX = info.readInt32LE(0);
	const offsetY = info.readInt32LE(4);
	const width = info.readUInt32LE(WIDTH_OFFSET);
	const height = info.readUInt32LE(HEIGHT_OFFSET);
	const channels = info.readInt32LE(CHANNELS_OFFSET);
	if (channels <= 0) return undefined;
	cursor += BigInt(FRAME_HEADER_SIZE);

	const imageSize = BigInt(channels) * BigInt(width) * BigInt(height);
	const declaredSize =
		BigInt(channels) * BigInt(offsetX + width) * BigInt(offsetY + height);

	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	const firstName = `${baseName}#${String(0).padStart(FRAME_DIGITS, "0")}`;
	if (cursor + imageSize > source.size) return undefined;
	entries.push(
		createFixedEntry({
			id: 0,
			...normalizeEntryPath(firstName),
			offset: cursor,
			size: imageSize,
			metadata: {
				inferredType: "image",
				frameIndex: 0,
				width,
				height,
				channels,
			},
		}),
	);
	cursor += imageSize;
	for (let id = 1; id < frameCount; id += 1) {
		if (cursor + BigInt(PACKED_HEADER_SIZE) > source.size) return undefined;
		const frameHeader = await source.readAt(cursor, PACKED_HEADER_SIZE);
		const rleStep = frameHeader.readUInt8(0);
		if (rleStep === 0) return undefined;
		const packedSize = BigInt(frameHeader.readUInt32LE(1));
		const offset = cursor + BigInt(PACKED_HEADER_SIZE);
		if (offset + packedSize > source.size) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(FRAME_DIGITS, "0")}`,
				),
				offset,
				size: declaredSize,
				packedSize,
				compressed: true,
				metadata: {
					inferredType: "image",
					frameIndex: id,
					width,
					height,
					channels,
					rleStep,
					imageSize: imageSize.toString(),
					packedSize: packedSize.toString(),
				},
			}),
		);
		cursor = offset + packedSize;
	}
	return entries;
}

/** GARBro `An21Opener.OpenEntry`: packed frames are RLE expanded, the first one is copied verbatim. */
async function openAn21Entry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	const rleStep =
		typeof entry.metadata?.rleStep === "number" ? entry.metadata.rleStep : 0;
	if (rleStep <= 0) return Readable.from([stored]);
	return Readable.from([
		decompressKaguyaRle(stored, Number(entry.size), rleStep),
	]);
}

export const kaguyaAn21Format: ArchiveFormat = defineFixedArchive({
	descriptor: kaguyaAn21Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAn21Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAn21Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kaguya AN21 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAn21Entry,
});
