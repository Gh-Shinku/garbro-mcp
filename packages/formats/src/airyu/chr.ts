// Format reference: GARbro Legacy/Airyu/ArcCHR.cs
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
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "chr";
/** Candidate raw image sizes; the file must divide evenly by exactly one of them. */
const IMAGE_SIZES = [0x96000, 0x4b000, 0x19000] as const;

export const airyuChrDescriptor: FormatDescriptor = {
	id: "airyu-chr",
	name: "Airyu resource archive",
	extensions: ["chr"],
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
			source: "Legacy/Airyu/ArcCHR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `ChrOpener.TryOpen`. The archive has no index at all: the file is a sequence of raw images
 * whose size is one of three known values, and the entry count is the file size divided by the
 * matching value.
 */
async function readChrIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	let imageSize: bigint | undefined;
	let count = 0;
	for (const candidate of IMAGE_SIZES) {
		const candidateCount = Number(source.size / BigInt(candidate));
		if (
			isSaneCount(candidateCount) &&
			BigInt(candidateCount) * BigInt(candidate) === source.size
		) {
			imageSize = BigInt(candidate);
			count = candidateCount;
			break;
		}
	}
	if (imageSize === undefined || count === 0) return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(String(id).padStart(5, "0")),
				offset: BigInt(id) * imageSize,
				size: imageSize,
			}),
		);
	}
	return entries;
}

export const airyuChrFormat: ArchiveFormat = defineFixedArchive({
	descriptor: airyuChrDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readChrIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readChrIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Airyu CHR layout");
		return entries
			? {
					entries,
					metadata: {
						entryCount: entries.length,
						imageSize: entries[0]?.size.toString() ?? "0",
					},
				}
			: { entries: [], metadata: {} };
	},
});
