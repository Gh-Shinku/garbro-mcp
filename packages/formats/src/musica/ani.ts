// Format reference: GARBro ArcFormats/Musica/ArcANI.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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

const VERSION_MARKER = 0x100;
const COUNT_OFFSET = 2;
const RESERVED_OFFSET = 4;
const INDEX_OFFSET = 8;
/** Frame header: the two 16-bit dimensions, the depth, and four extra bytes. */
const FRAME_HEADER_SIZE = 10;
const BITS_OFFSET = 6;
const BITS_PER_BYTE = 8;

export const aniDescriptor: FormatDescriptor = {
	id: "musica-ani",
	name: "Musica engine animation resource",
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
			source: "ArcFormats/Musica/ArcANI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `AniOpener.TryOpen`. The header starts with the version word 0x100, a 16-bit frame count,
 * and a reserved word that must be zero. Frames follow from offset 8 as a NUL-terminated name and a
 * ten-byte header holding the width, the height, the bit depth, and four unused bytes; the frame size
 * is `width * height * depth / 8 + 10`, which places the next frame directly behind it.
 *
 * Entries are named `<archive>#<frame name>` and the stored bytes, header included, are extracted
 * raw.
 */
async function readAniIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readUInt16LE(0) !== VERSION_MARKER) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (header.readUInt32LE(RESERVED_OFFSET) !== 0) return undefined;

	const body = await source.readAt(
		BigInt(INDEX_OFFSET),
		Number(source.size - BigInt(INDEX_OFFSET)),
	);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		const terminator = body.indexOf(0, position);
		if (terminator === -1) return undefined;
		const name = decodeCp932(body.subarray(position, terminator));
		if (name.trim().length === 0) return undefined;
		const offset = BigInt(INDEX_OFFSET + terminator + 1);
		if (
			BigInt(terminator + 1 + FRAME_HEADER_SIZE) >
			BigInt(body.length) + BigInt(INDEX_OFFSET)
		)
			return undefined;
		const frameHeader = await source.readAt(offset, FRAME_HEADER_SIZE);
		const width = frameHeader.readUInt16LE(0);
		const height = frameHeader.readUInt16LE(2);
		const bits = frameHeader.readUInt16LE(BITS_OFFSET);
		const size = BigInt(
			Math.floor((width * height * bits) / BITS_PER_BYTE) + FRAME_HEADER_SIZE,
		);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${name}`),
			offset,
			size,
		});
		entry.metadata = { width, height, bpp: bits };
		entries.push(entry);
		position = Number(offset + size) - INDEX_OFFSET;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const aniFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aniDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAniIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAniIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Musica ANI layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
