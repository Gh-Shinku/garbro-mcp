// Format reference: GARbro ArcFormats/Leaf/ArcPX.cs
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
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const LEAF_TAG = Buffer.from("Leaf", "ascii");
const HEADER_SIZE = 0x20;
const OFFSET_FIELD = 0x10;
const TAG_FIELD = 0x14;

export const leafPxDescriptor: FormatDescriptor = {
	id: "leaf-px",
	name: "Leaf multi-frame image",
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
			source: "ArcFormats/Leaf/ArcPX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface PxHeader {
	count: number;
	baseOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<PxHeader | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.readUInt16LE(OFFSET_FIELD) !== 0x80) return undefined;
	if (!header.subarray(TAG_FIELD, TAG_FIELD + LEAF_TAG.length).equals(LEAF_TAG))
		return undefined;
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = BigInt(count) * 4n + BigInt(HEADER_SIZE);
	if (baseOffset > source.size) return undefined;
	return { count, baseOffset };
}

async function readLeafPx(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf PX layout");
	}
	const { count, baseOffset } = header;
	const index = await source.readAt(BigInt(HEADER_SIZE), count * 4);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = baseOffset + BigInt(index.readUInt32LE(id * 4));
		const nextOffset =
			id + 1 < count
				? baseOffset + BigInt(index.readUInt32LE((id + 1) * 4))
				: source.size;
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Leaf PX frame points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(4, "0")}`,
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { frameCount: count } };
}

export const leafPxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafPxDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readLeafPx,
});
