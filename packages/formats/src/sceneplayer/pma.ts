// Format reference: GARBro ArcFormats/ScenePlayer/ArcPMA.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	DecodedArchiveHandle,
	ZLIB_FIRST_BYTE,
	readPmxStream,
} from "./decoded-archive.js";

const EXTENSION = "pma";
const COUNT_SIZE = 4;
/** Each frame is introduced by one skipped byte, a `BM` marker, and the bitmap size. */
const FRAME_PREFIX_SIZE = 1;
const MARKER_SIZE = 2;
const SIZE_SIZE = 4;
const BMP_MARKER = 0x4d42;
const FRAME_SUFFIX = ".bmp";

export const pmaDescriptor: FormatDescriptor = {
	id: "sceneplayer-pma",
	name: "ScenePlayer animation resource",
	extensions: ["pma"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/ScenePlayer/ArcPMA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PmaOpener.TryOpen`. The container is XORed with 0x21 and inflated; the decoded stream
 * starts with a 32-bit frame count and then a chain of bitmaps: one skipped byte, the `BM` marker,
 * the bitmap size, and the pixel data. Every entry covers one bitmap and is named
 * `<archive>#<n padded to 4>.bmp`.
 */
async function readPmaFrames(
	decoded: Buffer,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (decoded.length < COUNT_SIZE) return undefined;
	const count = decoded.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let position = COUNT_SIZE;
	for (let id = 0; id < count; id += 1) {
		position += FRAME_PREFIX_SIZE;
		if (position + MARKER_SIZE + SIZE_SIZE > decoded.length) return undefined;
		if (decoded.readUInt16LE(position) !== BMP_MARKER) return undefined;
		const size = BigInt(decoded.readUInt32LE(position + MARKER_SIZE));
		const offset = BigInt(position);
		if (!checkPlacement(offset, size, BigInt(decoded.length))) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(4, "0")}${FRAME_SUFFIX}`,
				),
				offset,
				size,
			}),
		);
		position = Number(offset + size);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const pmaFormat: ArchiveFormat = {
	descriptor: pmaDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([ZLIB_FIRST_BYTE]) }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		if (source.size < 1n) return false;
		if ((await source.readAt(0n, 1))[0] !== ZLIB_FIRST_BYTE) return false;
		const decoded = await readPmxStream(source);
		if (!decoded) return false;
		return (await readPmaFrames(decoded, sourcePath)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string) {
		const decoded = await readPmxStream(source);
		if (!decoded)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ScenePlayer PMA stream",
			);
		const entries = await readPmaFrames(decoded, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ScenePlayer PMA layout",
			);
		return new DecodedArchiveHandle(
			source,
			sourcePath,
			pmaDescriptor,
			entries,
			decoded,
		);
	},
};
