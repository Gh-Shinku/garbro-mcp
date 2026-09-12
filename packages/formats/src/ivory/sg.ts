// Format reference: GARbro ArcFormats/Ivory/ArcSG.cs
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

const SIGNATURE = Buffer.from("fSGX", "ascii");
const CHUNK_TAG = Buffer.from("cOBJ", "ascii");
const IMAGE_TAG = Buffer.from("fSG ", "ascii");
const FIRST_CHUNK_OFFSET = 8;
const CHUNK_HEADER_SIZE = 0x18;
const IMAGE_SIZE_OFFSET = 0x14;

export const ivorySgDescriptor: FormatDescriptor = {
	id: "ivory-sg",
	name: "Ivory multi-frame image",
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
			source: "ArcFormats/Ivory/ArcSG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function hasSignature(
	source: ByteSource,
	offset: bigint,
	tag: Buffer,
): Promise<boolean> {
	if (offset + BigInt(tag.length) > source.size) return false;
	return (await source.readAt(offset, tag.length)).equals(tag);
}

async function isSg(source: ByteSource): Promise<boolean> {
	if (!(await hasSignature(source, 0n, SIGNATURE))) return false;
	if (!(await hasSignature(source, BigInt(FIRST_CHUNK_OFFSET), CHUNK_TAG)))
		return false;
	const size = (
		await source.readAt(BigInt(FIRST_CHUNK_OFFSET) + 4n, 4)
	).readUInt32LE(0);
	return size >= CHUNK_HEADER_SIZE && BigInt(size) <= source.size;
}

async function readSg(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await isSg(source))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Ivory SG layout");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let offset = BigInt(FIRST_CHUNK_OFFSET);
	while (
		offset < source.size &&
		(await hasSignature(source, offset, CHUNK_TAG))
	) {
		const header = await source.readAt(offset + 4n, CHUNK_HEADER_SIZE - 4);
		const chunkSize = BigInt(header.readUInt32LE(0));
		if (chunkSize === 0n || chunkSize < CHUNK_HEADER_SIZE) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Ivory SG chunk size is invalid",
			);
		}
		if (await hasSignature(source, offset + 0x10n, IMAGE_TAG)) {
			const imageOffset = offset + 0x10n;
			const size = BigInt(
				(
					await source.readAt(offset + BigInt(IMAGE_SIZE_OFFSET), 4)
				).readUInt32LE(0),
			);
			if (!checkPlacement(imageOffset, size, source.size)) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Ivory SG image points outside the archive",
				);
			}
			entries.push(
				createFixedEntry({
					id: entries.length,
					path: `${baseName}#${entries.length}`,
					offset: imageOffset,
					size,
				}),
			);
		}
		if (offset + chunkSize > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Ivory SG chunk points outside the archive",
			);
		}
		offset += chunkSize;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Ivory SG archive is empty");
	}
	return { entries, metadata: { frameCount: entries.length } };
}

export const ivorySgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ivorySgDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return isSg(source);
	},
	read: readSg,
});
