// Format reference: GARbro ArcFormats/Artemis/ArcMJA.cs
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

const SIGNATURE = Buffer.from("MJA0", "ascii");
const COUNT_OFFSET = 4;
const DATA_OFFSET = 8;

/**
 * GARbro resolves entry extensions through the full resource catalog. This port only maps
 * signatures that belong to resources the toolkit already understands.
 */
const SIGNATURE_EXTENSIONS: readonly {
	signature: Buffer;
	extension: string;
}[] = [
	{ signature: Buffer.from("OggS", "ascii"), extension: "ogg" },
	{ signature: Buffer.from("RIFF", "ascii"), extension: "wav" },
	{ signature: Buffer.from([0x89, 0x50, 0x4e, 0x47]), extension: "png" },
	{ signature: Buffer.from("BM", "ascii"), extension: "bmp" },
];

function inferExtension(signature: Buffer): string | undefined {
	return SIGNATURE_EXTENSIONS.find((candidate) =>
		signature
			.subarray(0, candidate.signature.length)
			.equals(candidate.signature),
	)?.extension;
}

export const mjaDescriptor: FormatDescriptor = {
	id: "artemis-mja",
	name: "Artemis engine animation",
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
			source: "ArcFormats/Artemis/ArcMJA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(DATA_OFFSET)) return undefined;
	const header = await source.readAt(0n, DATA_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	return isSaneCount(count) ? count : undefined;
}

async function readMja(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Artemis MJA signature");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let offset = BigInt(DATA_OFFSET);
	while (offset < source.size) {
		if (offset + 4n > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Artemis MJA header is truncated",
			);
		}
		const size = BigInt((await source.readAt(offset, 4)).readUInt32LE(0));
		offset += 4n;
		if (size === 0n) {
			// GARbro would spin on a zero-sized record; treat it as a malformed archive.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Artemis MJA entry has zero size",
			);
		}
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Artemis MJA entry points outside the archive",
			);
		}
		const preview = await source.readAt(offset, Number(size > 4n ? 4n : size));
		const extension = inferExtension(preview);
		const name = `${baseName}#${String(entries.length).padStart(4, "0")}`;
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: extension ? `${name}.${extension}` : name,
				offset,
				size,
			}),
		);
		offset += size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Artemis MJA archive is empty");
	}
	return { entries, metadata: { entryCount: count } };
}

export const mjaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mjaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readMja,
});
