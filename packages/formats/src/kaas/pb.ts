// Format reference: GARbro ArcFormats/Kaas/ArcPB.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename } from "node:path";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 8;
const MAXIMUM_COUNT = 0xfff;

export const kaasPbDescriptor: FormatDescriptor = {
	id: "kaas-pb",
	name: "KAAS engine audio archive",
	extensions: ["pb"],
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
			source: "ArcFormats/Kaas/ArcPB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface PbHeader {
	count: number;
	dataOffset: number;
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<PbHeader | undefined> {
	if (sourceExtension(sourcePath) !== "pb") return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const count = header.readInt32LE(0);
	if (count <= 0 || count > MAXIMUM_COUNT) return undefined;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	if (BigInt(dataOffset) > source.size) return undefined;
	return { count, dataOffset };
}

async function readPb(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source, sourcePath);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid KAAS PB layout");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const isVoice = basename(sourcePath).toLowerCase() === "voice.pb";
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		if (
			offset < BigInt(dataOffset) ||
			!checkPlacement(offset, size, source.size)
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"KAAS PB entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${String(id).padStart(4, "0")}${isVoice ? ".pb" : ""}`,
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const kaasPbFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaasPbDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readPb,
});
