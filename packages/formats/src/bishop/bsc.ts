// Format reference: GARbro ArcFormats/Bishop/ArcBSC.cs
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

const SIGNATURE = Buffer.from("BSS-Composition\0", "binary");
const COUNT_OFFSET = 0x11;
const INDEX_OFFSET = 0x20;
const FRAME_HEADER_SIZE = 0x40;
const FRAME_SIZE_OFFSET = 0x36;

export const bishopBscDescriptor: FormatDescriptor = {
	id: "bishop-bsc",
	name: "Bishop composite image archive",
	extensions: ["bsc", "bsg"],
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
			source: "ArcFormats/Bishop/ArcBSC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header[COUNT_OFFSET] ?? 0;
	return count > 0 ? count : undefined;
}

async function readBishopBsc(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Bishop BSC signature");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let offset = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (offset + BigInt(FRAME_HEADER_SIZE) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Bishop BSC frame is truncated");
		}
		const size =
			BigInt(FRAME_HEADER_SIZE) +
			BigInt(
				(
					await source.readAt(offset + BigInt(FRAME_SIZE_OFFSET), 4)
				).readUInt32LE(0),
			);
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Bishop BSC frame points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(3, "0")}.bsg`,
				offset,
				size,
			}),
		);
		offset += size;
	}
	return { entries, metadata: { frameCount: count } };
}

export const bishopBscFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bishopBscDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readBishopBsc,
});
