// Format reference: GARbro ArcFormats/Seraphim/ArcCP3.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CP3X", "ascii");
const COUNT_OFFSET = 8;
const FIRST_FRAME_OFFSET = 0x2c;
const FRAME_HEADER_SIZE = 0x10;
const BYTES_PER_PIXEL = 4;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 12;

export const cp3Descriptor: FormatDescriptor = {
	id: "seraphim-cp3",
	name: "Seraphim engine multi-frame image",
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
			source: "ArcFormats/Seraphim/ArcCP3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `Cp3Opener.TryOpen`. Frames follow the header at 0x2c and are sized from their own
 * dimensions: a 0x10-byte header plus 32-bit pixels. Frames without pixels are skipped, but their
 * header still advances the walk.
 */
async function readCp3Frames(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let offset = BigInt(FIRST_FRAME_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (offset + BigInt(HEIGHT_OFFSET + 4) > source.size) return undefined;
		const frameHeader = await source.readAt(
			offset,
			Math.min(FRAME_HEADER_SIZE, Number(source.size - offset)),
		);
		const width = BigInt(frameHeader.readUInt32LE(WIDTH_OFFSET));
		const height = BigInt(frameHeader.readUInt32LE(HEIGHT_OFFSET));
		const size =
			width * height * BigInt(BYTES_PER_PIXEL) + BigInt(FRAME_HEADER_SIZE);
		if (size !== BigInt(FRAME_HEADER_SIZE)) {
			if (!checkPlacement(offset, size, source.size)) return undefined;
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}`),
					offset,
					size,
					metadata: {
						width: width.toString(),
						height: height.toString(),
						bpp: 32,
					},
				}),
			);
		}
		offset += size;
	}
	return entries;
}

export const cp3Format: ArchiveFormat = defineFixedArchive({
	descriptor: cp3Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCp3Frames(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCp3Frames(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Seraphim CP3 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
