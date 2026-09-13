// Format reference: GARbro ArcFormats/Triangle/ArcIAF.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const HEADER_SIZE = 0x19;
const MINIMUM_SIZE = 0x20;
const MAXIMUM_ENTRIES = 0x40000;

export const iafDescriptor: FormatDescriptor = {
	id: "triangle-iaf",
	name: "route2 engine multi-frame image",
	extensions: ["iaf"],
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
			source: "ArcFormats/Triangle/ArcIAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (sourceExtension(sourcePath) !== "iaf") return false;
	if (source.size < BigInt(MINIMUM_SIZE)) return false;
	const firstSize = BigInt((await source.readAt(1n, 4)).readUInt32LE(0));
	if (firstSize === 0n || firstSize >= source.size) return false;
	return firstSize + BigInt(HEADER_SIZE) < source.size;
}

async function readIaf(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid route2 IAF layout");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let offset = 0n;
	while (offset < source.size && entries.length < MAXIMUM_ENTRIES) {
		if (offset + BigInt(HEADER_SIZE) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "route2 IAF frame is truncated");
		}
		const packedSize = BigInt(
			(await source.readAt(offset + 1n, 4)).readUInt32LE(0),
		);
		if (
			packedSize === 0n ||
			offset + packedSize + BigInt(HEADER_SIZE) > source.size
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"route2 IAF frame size is invalid",
			);
		}
		const size = packedSize + BigInt(HEADER_SIZE);
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: `${baseName}#${String(entries.length).padStart(3, "0")}.IAF`,
				offset,
				size,
				metadata: { type: "image" },
			}),
		);
		offset += size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "route2 IAF archive is empty");
	}
	return { entries, metadata: { frameCount: entries.length } };
}

export const iafFormat: ArchiveFormat = defineFixedArchive({
	descriptor: iafDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readIaf,
});
