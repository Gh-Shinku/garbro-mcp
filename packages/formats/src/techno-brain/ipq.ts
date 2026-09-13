// Format reference: GARBro ArcFormats/TechnoBrain/ArcIPQ.cs (header reader in ImageIPF.cs)
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const RIFF_SIGNATURE = Buffer.from("RIFF", "ascii");
const FMT_MARKER = Buffer.from("fmt ", "ascii");
const PAL_MARKER = Buffer.from("pal ", "ascii");
const ANIM_MARKER = Buffer.from("anim", "ascii");
const FORMAT_STRING_OFFSET = 8;
const FORMAT_STRING_SIZE = 8;
const FMT_OFFSET = 0x0c;
const FMT_SIZE_OFFSET = 0x10;
const HAS_PALETTE_OFFSET = 0x18;
const HEADER_SIZE = 0x14;
const MIN_FMT_SIZE = 0x24;
const MIN_PAL_SIZE = 0x24;
const EXPECTED_FORMAT = "IPQ fmt ";
const RECORD_SIZE = 4;

export const ipqDescriptor: FormatDescriptor = {
	id: "techno-brain-ipq",
	name: "TechnoBrain's animation resource",
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
			source: "ArcFormats/TechnoBrain/ArcIPQ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/TechnoBrain/ImageIPF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `IpfFormat.ReadIpfHeader`. A `RIFF` container stores the `fmt ` marker at 0xC and its chunk
 * size at 0x10; the chunk must be at least 0x24 bytes. The chunk's format string at +8 selects the
 * format, and its palette flag at +0x18 decides whether a `pal ` chunk follows the header. The data
 * offset is whatever position the walk reaches.
 */
async function readIpfHeader(
	source: ByteSource,
): Promise<{ formatString: string; dataOffset: bigint } | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, RIFF_SIGNATURE.length).equals(RIFF_SIGNATURE))
		return undefined;
	if (
		!header
			.subarray(FMT_OFFSET, FMT_OFFSET + FMT_MARKER.length)
			.equals(FMT_MARKER)
	)
		return undefined;
	const fmtSize = header.readInt32LE(FMT_SIZE_OFFSET);
	if (fmtSize < MIN_FMT_SIZE) return undefined;
	if (BigInt(HEADER_SIZE + fmtSize) > source.size) return undefined;
	const chunk = await source.readAt(0n, HEADER_SIZE + fmtSize);
	const formatString = decodeCp932(
		chunk.subarray(
			FORMAT_STRING_OFFSET,
			FORMAT_STRING_OFFSET + FORMAT_STRING_SIZE,
		),
	).replace(/\0.*$/s, "");
	let position = BigInt(HEADER_SIZE + fmtSize);
	if (chunk.readInt32LE(HAS_PALETTE_OFFSET) !== 0) {
		if (position + 8n > source.size) return undefined;
		const palHeader = await source.readAt(position, 8);
		if (!palHeader.subarray(0, 4).equals(PAL_MARKER)) return undefined;
		const palSize = palHeader.readInt32LE(4);
		if (palSize < MIN_PAL_SIZE) return undefined;
		position += BigInt(palSize);
		if (position > source.size) return undefined;
	}
	return { formatString, dataOffset: position };
}

/**
 * GARBro `IpqOpener.TryOpen`. Behind the IPF header the `anim` marker introduces a 32-bit index size
 * and a record count, followed by one 32-bit offset per frame. Frames are named `<archive>#<n padded
 * to 3>` and GARbro derives sizes backwards from the end of the file, so the last frame runs to EOF.
 */
async function readIpqIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const header = await readIpfHeader(source);
	if (!header || header.formatString !== EXPECTED_FORMAT) return undefined;
	const dataOffset = header.dataOffset;
	if (dataOffset + 12n > source.size) return undefined;
	const anim = await source.readAt(dataOffset, 12);
	if (!anim.subarray(0, ANIM_MARKER.length).equals(ANIM_MARKER))
		return undefined;
	const count = anim.readInt32LE(8);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const tableOffset = dataOffset + 12n;
	if (tableOffset + BigInt(indexSize) > source.size) return undefined;
	const table = await source.readAt(tableOffset, indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * RECORD_SIZE));
		if (offset > source.size) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}#${String(id).padStart(3, "0")}`),
				offset,
				size: 0n,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	let next = source.size;
	for (let id = entries.length - 1; id >= 0; id -= 1) {
		const entry = entries[id];
		if (!entry) continue;
		const size = next - entry.offset;
		if (size < 0n || !checkPlacement(entry.offset, size, source.size))
			return undefined;
		entry.size = size;
		entry.packedSize = size;
		next = entry.offset;
	}
	return entries;
}

export const ipqFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ipqDescriptor,
	detection: { signatures: [{ bytes: RIFF_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readIpqIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIpqIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid TechnoBrain IPQ layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
