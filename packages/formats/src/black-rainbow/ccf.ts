// Format reference: GARbro ArcFormats/BlackRainbow/ArcCCF.cs
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

const SIGNATURE = Buffer.from('CCf"', "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;

export const ccfDescriptor: FormatDescriptor = {
	id: "black-rainbow-ccf",
	name: "BlackRainbow audio archive",
	extensions: ["pak"],
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
			source: "ArcFormats/BlackRainbow/ArcCCF.cs",
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
	if (BigInt(INDEX_OFFSET + count * 4) >= source.size) return undefined;
	return count;
}

async function readCcf(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid BlackRainbow CCF layout");
	}
	const baseOffset = BigInt(INDEX_OFFSET + count * 4);
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * 4);
	const baseName = basename(sourcePath, extname(sourcePath));
	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = baseOffset + BigInt(index.readUInt32LE(id * 4));
		if (offset >= source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"BlackRainbow CCF entry points outside the archive",
			);
		}
		offsets.push(offset);
	}
	const entries: FixedEntry[] = offsets.map((offset, id) => {
		const nextOffset = offsets[id + 1] ?? source.size;
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"BlackRainbow CCF entry points outside the archive",
			);
		}
		return createFixedEntry({
			id,
			path: `${baseName}#${String(id).padStart(4, "0")}`,
			offset,
			size,
		});
	});
	return { entries, metadata: { entryCount: count } };
}

export const ccfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ccfDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readCcf,
});
