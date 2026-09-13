// Format reference: GARBro ArcFormats/Favorite/ArcHZC.cs and ArcFormats/Favorite/ImageHZC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
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

const SIGNATURE = Buffer.from("hzc1", "ascii");
const UNPACKED_SIZE_OFFSET = 4;
const HEADER_SIZE_OFFSET = 8;
const METADATA_OFFSET = 0xc;
/** GARbro's image reader validates this marker inside the metadata header. */
const METADATA_MARKER = Buffer.from("NVSG", "ascii");
const METADATA_MARKER_OFFSET = 0xc;
const FRAME_COUNT_OFFSET = 0x20;
/** Offsets of the image fields the archive layer exposes as metadata. */
const TYPE_OFFSET = 0x12;
const WIDTH_OFFSET = 0x14;
const HEIGHT_OFFSET = 0x16;
const OFFSET_X = 0x18;
const OFFSET_Y = 0x1a;
/** The image header GARbro always parses. */
const IMAGE_HEADER_SIZE = 0x2c;
/** Frame names are padded to three digits. */
const FRAME_DIGITS = 3;

export const hzcMultiDescriptor: FormatDescriptor = {
	id: "fvp-hzc-multi",
	name: "Favorite View Point multi-frame image",
	extensions: ["hzc"],
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
			source: "ArcFormats/Favorite/ArcHZC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Favorite/ImageHZC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface HzcMultiInfo {
	unpackedSize: number;
	headerSize: number;
	frameCount: number;
	frameSize: number;
	type: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

/**
 * GARBro `HzcOpener.TryOpen` together with `HzcFormat.ReadMetaData`. The metadata header carries the
 * unpacked size at 4 and its own size at 8, and the image reader rejects the file unless `NVSG` sits
 * at 0xC, so the port validates the same marker. The frame count at 0x20 defaults to one when it is
 * zero, and dividing the unpacked size by it yields one frame per directory entry.
 */
async function readHzcMulti(
	source: ByteSource,
): Promise<HzcMultiInfo | undefined> {
	if (source.size < BigInt(IMAGE_HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, IMAGE_HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!header
			.subarray(
				METADATA_MARKER_OFFSET,
				METADATA_MARKER_OFFSET + METADATA_MARKER.length,
			)
			.equals(METADATA_MARKER)
	)
		return undefined;
	const unpackedSize = header.readInt32LE(UNPACKED_SIZE_OFFSET);
	const headerSize = header.readInt32LE(HEADER_SIZE_OFFSET);
	// The image reader parses its header from a stream of exactly this length.
	if (headerSize < IMAGE_HEADER_SIZE - METADATA_OFFSET) return undefined;
	if (BigInt(METADATA_OFFSET + headerSize) > source.size) return undefined;
	let frameCount = header.readInt32LE(FRAME_COUNT_OFFSET);
	if (frameCount === 0) frameCount = 1;
	if (!isSaneCount(frameCount)) return undefined;
	const frameSize = Math.trunc(unpackedSize / frameCount);
	// GARbro would loop forever on a zero-sized frame, so the port refuses it.
	if (frameSize <= 0) return undefined;
	const type = header.readUInt16LE(TYPE_OFFSET);
	return {
		unpackedSize,
		headerSize,
		frameCount,
		frameSize,
		type,
		width: header.readUInt16LE(WIDTH_OFFSET),
		height: header.readUInt16LE(HEIGHT_OFFSET),
		offsetX: header.readInt16LE(OFFSET_X),
		offsetY: header.readInt16LE(OFFSET_Y),
	};
}

/** Builds the frame directory once the archive name is known. */
function buildFrames(info: HzcMultiInfo, sourcePath: string): FixedEntry[] {
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < info.frameCount; id += 1) {
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(FRAME_DIGITS, "0")}`,
			),
			offset: BigInt(info.frameSize * id),
			size: BigInt(info.frameSize),
		});
		entry.metadata = {
			frameIndex: id,
			// GARbro derives the depth from the image type field.
			bpp: info.type === 0 ? 24 : info.type > 2 ? 8 : 32,
			width: info.width,
			height: info.height,
			offsetX: info.offsetX,
			offsetY: info.offsetY,
			unpackedSize: info.unpackedSize,
		};
		entries.push(entry);
	}
	return entries;
}

/**
 * GARBro `HzcOpener.OpenEntry`. The payload behind the metadata header is a zlib stream holding
 * `frame_count` frames of equal size; the reference inflates one frame at a time and returns the frame
 * the entry points at. The port streams the same way and stops as soon as that frame is complete.
 */
async function openHzcMultiEntry(
	source: ByteSource,
	entry: FixedEntry,
	_sourcePath: string,
	info: HzcMultiInfo,
): Promise<Readable> {
	const frameIndex =
		typeof entry.metadata?.frameIndex === "number"
			? entry.metadata.frameIndex
			: Number(entry.offset) / info.frameSize;
	const frameSize = info.frameSize;
	const payloadOffset = BigInt(METADATA_OFFSET + info.headerSize);
	const input = createZlibInflateStream(
		source.createReadStream(payloadOffset, source.size - payloadOffset),
	);
	return Readable.from(
		(async function* () {
			let buffered = Buffer.alloc(0);
			let frames = 0;
			for await (const chunk of input) {
				buffered = Buffer.concat([buffered, chunk as Buffer]);
				while (buffered.length >= frameSize) {
					const frame = buffered.subarray(0, frameSize);
					buffered = buffered.subarray(frameSize);
					if (frames === frameIndex) {
						yield Buffer.from(frame);
						return;
					}
					frames += 1;
				}
			}
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Compressed image ended before the requested frame",
			);
		})(),
	);
}

export const hzcMultiFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hzcMultiDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readHzcMulti(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const info = await readHzcMulti(source);
		if (!info)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid HZC1 image layout");
		return {
			entries: buildFrames(info, sourcePath),
			metadata: {
				entryCount: info.frameCount,
				unpackedSize: info.unpackedSize,
				headerSize: info.headerSize,
				width: info.width,
				height: info.height,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		const info = await readHzcMulti(source);
		if (!info) throw new GarbroError("INVALID_ARCHIVE", "Invalid HZC1 image");
		// The compressed payload must exist behind the metadata header.
		if (BigInt(METADATA_OFFSET + info.headerSize) >= source.size)
			throw new GarbroError("INVALID_ARCHIVE", "Missing compressed image data");
		return openHzcMultiEntry(source, entry, sourcePath, info);
	},
});
