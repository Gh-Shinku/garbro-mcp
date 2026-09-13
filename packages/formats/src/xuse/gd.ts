// Format reference: GARbro ArcFormats/Xuse/ArcGD.cs
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
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import { basename, extname } from "node:path";

const RECORD_SIZE = 8;
const MZ_SIGNATURE = 0x5a4d;

export const gdDescriptor: FormatDescriptor = {
	id: "xuse-gd",
	name: "Xuse resource archive",
	extensions: ["gd"],
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
			source: "ArcFormats/Xuse/ArcGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "gd") return undefined;
	if (source.size < 4n) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(0);
	if (!isSaneCount(count) || (count & 0xffff) === MZ_SIGNATURE)
		return undefined;
	const dll = await readCompanionFile(
		sourcePath,
		changeExtension(sourcePath, "dll"),
	);
	if (!dll || dll.length < 12) return undefined;
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	let lastOffset = 3n;
	let position = 4;
	while (position + RECORD_SIZE <= dll.length) {
		const offset = BigInt(dll.readUInt32LE(position));
		if (offset <= lastOffset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Xuse GD offsets are not monotonic",
			);
		}
		const size = BigInt(dll.readUInt32LE(position + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Xuse GD entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: `${baseName}#${String(entries.length).padStart(5, "0")}`,
				offset,
				size,
			}),
		);
		lastOffset = offset;
		position += RECORD_SIZE;
	}
	return entries.length > 0 ? entries : undefined;
}

export const gdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gdDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "gd") return false;
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse GD layout");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
