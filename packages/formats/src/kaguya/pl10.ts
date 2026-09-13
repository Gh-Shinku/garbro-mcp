// Format reference: GARBro ArcFormats/Kaguya/ArcPLT.cs (`Pl10Opener`, `Pl10Entry`) with the entry handling
// of `An21Opener` in ArcFormats/Kaguya/ArcAN21.cs.
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

/** The signature spells `PL10`. */
const SIGNATURE = Buffer.from("PL10", "ascii");
const EXTENSION = "plt";
const COUNT_OFFSET = 4;
/** The first frame's information block begins here. */
const FIRST_FRAME_OFFSET = 0x16;
const FRAME_HEADER_SIZE = 0x14;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
const DEPTH_OFFSET = 0x10;
/** Packed frames carry a step byte and a packed size ahead of their pixels. */
const PACKED_HEADER_SIZE = 5;
const FRAME_DIGITS = 2;
/** The run length escapes through the high bit of its first byte. */
const RUN_EXTENSION_FLAG = 0x80;
const RUN_EXTENSION_BASE = 128;

export const kaguyaPl10Descriptor: FormatDescriptor = {
	id: "kaguya-pl10",
	name: "KaGuYa script engine animation resource, version 10",
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
			source: "ArcFormats/Kaguya/ArcPLT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Kaguya/ArcAN21.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `An21Opener.DecompressRLE`. The output is filled on a stride of `rle_step` bytes: each of the first
 * `rle_step` positions takes one literal, and every later position takes a byte and then, when that byte
 * repeats the previous one, a run length. A run length whose high bit is set continues in the next byte with
 * the low seven bits as its high part and an extra 128, and after any run one more literal is read when space
 * remains, which seeds the next comparison.
 *
 * The reference reads without checking bounds, so a truncated stream would overrun; the port stops instead.
 */
export function decompressKaguyaRle(
	input: Buffer,
	unpackedSize: number,
	rleStep: number,
): Buffer {
	const output = Buffer.alloc(unpackedSize);
	if (rleStep <= 0) return output;
	let source = 0;
	for (let lane = 0; lane < rleStep && lane < output.length; lane += 1) {
		if (source >= input.length) break;
		let previous = input[source++] ?? 0;
		output[lane] = previous;
		let destination = lane + rleStep;
		while (destination < output.length) {
			if (source >= input.length) return output;
			let value = input[source++] ?? 0;
			output[destination] = value;
			destination += rleStep;
			if (value === previous) {
				if (source >= input.length) return output;
				let count = input[source++] ?? 0;
				if ((count & RUN_EXTENSION_FLAG) !== 0) {
					if (source >= input.length) return output;
					count =
						(input[source++] ?? 0) + ((count & 0x7f) << 8) + RUN_EXTENSION_BASE;
				}
				while (count > 0 && destination < output.length) {
					output[destination] = value;
					destination += rleStep;
					count -= 1;
				}
				if (destination < output.length) {
					if (source >= input.length) return output;
					value = input[source++] ?? 0;
					output[destination] = value;
					destination += rleStep;
				}
			}
			previous = value;
		}
	}
	return output;
}

interface Pl10Frame {
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
	rleStep: number;
	packed: boolean;
}

/**
 * GARBro `Pl10Opener.TryOpen` together with `Pl10Opener.GetFramesList`. The frame count sits at 4 and the
 * first frame's information block at 0x16, holding its offsets, width, height and a depth word that the
 * reference multiplies by eight to get the bits per pixel. The first frame is stored raw behind that
 * 0x14-byte block, and every later frame carries a step byte and a packed size in front of RLE-compressed
 * pixels whose output length is that same image size.
 *
 * The reference reads the step byte without validating it, yet the unpacker cannot work with a zero step, so
 * the port rejects such a frame. Frames are named `<archive>#<index padded to 2>` from the frame index, and
 * the port records the step, the packed span and the image size as metadata. The `An21Opener` base class
 * also accumulates each frame onto the previous one, but that happens in the image path beyond `OpenEntry`,
 * so it is out of scope here along with decoding to bitmaps.
 */
async function readPl10Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE))
		return undefined;
	const header = await source.readAt(
		0n,
		FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE,
	);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const width = header.readUInt32LE(FIRST_FRAME_OFFSET + WIDTH_OFFSET);
	const height = header.readUInt32LE(FIRST_FRAME_OFFSET + HEIGHT_OFFSET);
	const depth = header.readUInt32LE(FIRST_FRAME_OFFSET + DEPTH_OFFSET);
	const imageSize = BigInt(depth) * BigInt(width) * BigInt(height);

	const frames: Pl10Frame[] = [];
	let cursor = BigInt(FIRST_FRAME_OFFSET);
	// The first frame is a raw image behind its information block.
	const firstOffset = cursor + BigInt(FRAME_HEADER_SIZE);
	if (firstOffset + imageSize > source.size) return undefined;
	frames.push({
		offset: firstOffset,
		size: imageSize,
		unpackedSize: imageSize,
		rleStep: 0,
		packed: false,
	});
	cursor = firstOffset + imageSize;
	for (let id = 1; id < count; id += 1) {
		if (cursor + BigInt(PACKED_HEADER_SIZE) > source.size) return undefined;
		const frameHeader = await source.readAt(cursor, PACKED_HEADER_SIZE);
		const rleStep = frameHeader.readUInt8(0);
		if (rleStep === 0) return undefined;
		const packedSize = BigInt(frameHeader.readUInt32LE(1));
		const offset = cursor + BigInt(PACKED_HEADER_SIZE);
		if (offset + packedSize > source.size) return undefined;
		frames.push({
			offset,
			size: packedSize,
			unpackedSize: imageSize,
			rleStep,
			packed: true,
		});
		cursor = offset + packedSize;
	}

	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	return frames.map((frame, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(FRAME_DIGITS, "0")}`,
			),
			offset: frame.offset,
			size: frame.packed ? frame.unpackedSize : frame.size,
			packedSize: frame.size,
			compressed: frame.packed,
			metadata: {
				inferredType: "image",
				frameIndex: id,
				width,
				height,
				depth,
				rleStep: frame.rleStep,
				packedSize: frame.size.toString(),
			},
		}),
	);
}

/** GARbro `An21Opener.OpenEntry`: packed frames are RLE expanded, the first one is copied verbatim. */
async function openPl10Entry(
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

export const kaguyaPl10Format: ArchiveFormat = defineFixedArchive({
	descriptor: kaguyaPl10Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPl10Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPl10Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kaguya PL10 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openPl10Entry,
});
