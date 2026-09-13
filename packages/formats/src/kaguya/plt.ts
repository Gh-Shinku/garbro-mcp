// Format reference: GARBro ArcFormats/Kaguya/ArcPLT.cs, classes `Pl00Opener` and `AnmOpenerBase`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature spells `PL00`. */
const SIGNATURE = Buffer.from("PL00", "ascii");
const EXTENSION = "plt";
const COUNT_OFFSET = 4;
/** Frames start after the count and the base information block. */
const FIRST_FRAME_OFFSET = 0x16;
/** A frame is a 0x14-byte header followed by its image data. */
const FRAME_HEADER_SIZE = 0x14;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
const DEPTH_OFFSET = 0x10;
const FRAME_DIGITS = 2;

export const kaguyaPltDescriptor: FormatDescriptor = {
	id: "kaguya-plt",
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
			source: "ArcFormats/Kaguya/ArcPLT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Kaguya/ArcANM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `Pl00Opener.GetFramesList` together with `AnmOpenerBase.TryOpen`. The frame count sits at 4 and the
 * first frame at 0x16. A frame is a 0x14-byte header followed by its pixels, and the header's depth, width
 * and height at 8, 0x0C and 0x10 give the image size as their product, which is the only way to know where
 * the next frame begins — the sizes are derived, not stored.
 *
 * Frames carry no names of their own: the base class builds them from the archive name and a two-digit
 * index, and classifies every frame as an image. The port records the depth, width and height of each frame
 * as metadata, validates that the derived layout stays inside the file, and extracts frames verbatim, since
 * turning them into bitmaps is an image concern. The sibling `PL10` variant in the same GARbro file is not
 * part of this port.
 */
async function readPltIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_FRAME_OFFSET)) return undefined;
	const header = await source.readAt(0n, FIRST_FRAME_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");

	const entries: FixedEntry[] = [];
	let cursor = BigInt(FIRST_FRAME_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (cursor + BigInt(FRAME_HEADER_SIZE) > source.size) return undefined;
		const frame = await source.readAt(cursor, FRAME_HEADER_SIZE);
		const width = frame.readUInt32LE(WIDTH_OFFSET);
		const height = frame.readUInt32LE(HEIGHT_OFFSET);
		const depth = frame.readUInt32LE(DEPTH_OFFSET);
		const imageSize = BigInt(depth) * BigInt(width) * BigInt(height);
		const size = BigInt(FRAME_HEADER_SIZE) + imageSize;
		if (cursor + size > source.size) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(FRAME_DIGITS, "0")}`,
				),
				offset: cursor,
				size,
				metadata: {
					inferredType: "image",
					frameIndex: id,
					width,
					height,
					depth,
					imageSize: imageSize.toString(),
				},
			}),
		);
		cursor += size;
	}
	return entries;
}

export const kaguyaPltFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaguyaPltDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPltIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPltIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kaguya PLT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
