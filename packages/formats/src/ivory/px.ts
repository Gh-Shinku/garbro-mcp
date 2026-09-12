// Format reference: GARbro ArcFormats/Ivory/ArcPX.cs
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
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const SIGNATURE = Buffer.from("fPX ", "ascii");
const TRACK_TAG = Buffer.from("cTRK", "ascii");
const HEADER_SIZE = 8;
const TRACK_HEADER_SIZE = 0x0c;

export const ivoryPxDescriptor: FormatDescriptor = {
	id: "ivory-px",
	name: "Ivory audio archive",
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
			source: "ArcFormats/Ivory/ArcPX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(HEADER_SIZE + TRACK_HEADER_SIZE)) return false;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
	if (BigInt(header.readUInt32LE(4)) !== source.size) return false;
	const track = await source.readAt(BigInt(HEADER_SIZE), TRACK_HEADER_SIZE);
	if (!track.subarray(0, TRACK_TAG.length).equals(TRACK_TAG)) return false;
	const size = BigInt(track.readUInt32LE(4));
	return size >= BigInt(TRACK_HEADER_SIZE) && size <= source.size - 8n;
}

async function readIvoryPx(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Ivory PX layout");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let offset = BigInt(HEADER_SIZE);
	while (offset < source.size) {
		if (offset + BigInt(TRACK_HEADER_SIZE) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Ivory PX header is truncated");
		}
		const track = await source.readAt(offset, TRACK_HEADER_SIZE);
		if (!track.subarray(0, TRACK_TAG.length).equals(TRACK_TAG)) break;
		const size = BigInt(track.readUInt32LE(4));
		if (size === 0n) {
			throw new GarbroError("INVALID_ARCHIVE", "Ivory PX track has zero size");
		}
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Ivory PX track points outside the archive",
			);
		}
		const number = track.readInt32LE(8);
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: `${baseName}#${String(number).padStart(4, "0")}.trk`,
				offset,
				size,
			}),
		);
		offset += size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Ivory PX archive is empty");
	}
	return { entries, metadata: { trackCount: entries.length } };
}

export const ivoryPxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ivoryPxDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	detect: parseHeader,
	read: readIvoryPx,
});
