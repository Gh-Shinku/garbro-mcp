// Format reference: GARbro ArcFormats/Triangle/ArcSUD.cs
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

const OGG_TAG = Buffer.from("OggS", "ascii");
const TAG_OFFSET = 4;
const HEADER_SIZE = 8;

export const sudDescriptor: FormatDescriptor = {
	id: "triangle-sud",
	name: "Triangle audio archive",
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
			source: "ArcFormats/Triangle/ArcSUD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(HEADER_SIZE)) return false;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(TAG_OFFSET, TAG_OFFSET + 4).equals(OGG_TAG))
		return false;
	const firstSize = BigInt(header.readUInt32LE(0));
	return firstSize > 0n && firstSize < source.size;
}

async function readSud(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	if (!(await parseHeader(source))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Triangle SUD layout");
	}
	const entries: FixedEntry[] = [];
	let offset = 0n;
	while (offset < source.size) {
		const size = BigInt((await source.readAt(offset, 4)).readUInt32LE(0));
		const dataOffset = offset + 4n;
		if (dataOffset + size > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Triangle SUD chunk points outside the archive",
			);
		}
		const tag = await source.readAt(dataOffset, Number(size > 4n ? 4n : size));
		if (tag.equals(OGG_TAG)) {
			if (!checkPlacement(dataOffset, size, source.size)) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Triangle SUD entry points outside the archive",
				);
			}
			entries.push(
				createFixedEntry({
					id: entries.length,
					path: `${String(entries.length).padStart(5, "0")}.ogg`,
					offset: dataOffset,
					size,
				}),
			);
		}
		offset = dataOffset + size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Triangle SUD archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const sudFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sudDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return parseHeader(source);
	},
	read: readSud,
});
