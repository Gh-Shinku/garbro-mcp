// Format reference: GARbro Legacy/RSystem/ArcRAD.cs
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
	isSaneCount,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const INDEX_OFFSET = 4;

export const radDescriptor: FormatDescriptor = {
	id: "r-system-rad",
	name: "RSystem engine multi-frame image",
	extensions: ["rad"],
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
			source: "Legacy/RSystem/ArcRAD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<number | undefined> {
	if (sourceExtension(sourcePath) !== "rad") return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * 4) > source.size) return undefined;
	return count;
}

async function readRad(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source, sourcePath);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid RSystem RAD layout");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * 4);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * 4));
		const nextOffset =
			id + 1 < count ? BigInt(index.readUInt32LE((id + 1) * 4)) : source.size;
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"RSystem RAD frame points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(3, "0")}`,
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { frameCount: count } };
}

export const radFormat: ArchiveFormat = defineFixedArchive({
	descriptor: radDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readRad,
});
