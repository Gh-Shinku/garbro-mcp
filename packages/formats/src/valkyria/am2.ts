// Format reference: GARbro ArcFormats/Valkyria/ArcAM2.cs
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

const HEADER_SIZE = 12;
const RECORD_SIZE = 0x0c;

export const valkyriaAm2Descriptor: FormatDescriptor = {
	id: "valkyria-am2",
	name: "Valkyria multi-frame image",
	extensions: ["am2"],
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
			source: "ArcFormats/Valkyria/ArcAM2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface Am2Header {
	count: number;
	baseOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<Am2Header | undefined> {
	if (sourceExtension(sourcePath) !== "am2") return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const baseOffset = BigInt(header.readUInt32LE(0)) + 12n;
	const count = header.readInt32LE(4);
	if (baseOffset >= source.size || !isSaneCount(count)) return undefined;
	if (BigInt(HEADER_SIZE + count * RECORD_SIZE) > source.size) return undefined;
	return { count, baseOffset };
}

async function readAm2(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source, sourcePath);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Valkyria AM2 layout");
	}
	const { count, baseOffset } = header;
	const indexSize = count * RECORD_SIZE;
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const name = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const offset = baseOffset + BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Valkyria AM2 entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${name}#${String(id).padStart(4, "0")}.MG2`,
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count, baseOffset } };
}

export const valkyriaAm2Format: ArchiveFormat = defineFixedArchive({
	descriptor: valkyriaAm2Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readAm2,
});
