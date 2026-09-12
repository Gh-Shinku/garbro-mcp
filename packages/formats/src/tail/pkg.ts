// Format reference: GARbro ArcFormats/Tail/ArcPKG.cs
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

const SIGNATURE = Buffer.from("PKG ", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 8;

export const tailPkgDescriptor: FormatDescriptor = {
	id: "tail-pkg",
	name: "Archive's resource container",
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
			source: "ArcFormats/Tail/ArcPKG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readTailPkg(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Archive's PKG signature");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Archive's PKG entry points outside the archive",
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
	return { entries, metadata: { entryCount: count } };
}

export const tailPkgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tailPkgDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readTailPkg,
});
