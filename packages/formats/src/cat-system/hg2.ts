// Format reference: GARbro ArcFormats/CatSystem/ArcHG2.cs
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
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("HG-2", "ascii");
const MARKER_OFFSET = 8;
const MARKER = 0x25;
const FIRST_SECTION_OFFSET = 0x0c;
const SECTION_SIZE_OFFSET = 0x40;

export const hg2Descriptor: FormatDescriptor = {
	id: "cat-system-hg2",
	name: "CatSystem2 engine multi-image",
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
			source: "ArcFormats/CatSystem/ArcHG2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `Hg2Opener.TryOpen`. Sections start at 0x0c and each one stores its own size at +0x40; a
 * zero size marks the last section, which then runs to the end of the file.
 */
async function readHg2Sections(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_SECTION_OFFSET)) return undefined;
	const header = await source.readAt(0n, FIRST_SECTION_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (header.readInt32LE(MARKER_OFFSET) !== MARKER) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let offset = BigInt(FIRST_SECTION_OFFSET);
	while (offset < source.size) {
		const sectionSize =
			offset + BigInt(SECTION_SIZE_OFFSET + 4) <= source.size
				? BigInt(
						(
							await source.readAt(offset + BigInt(SECTION_SIZE_OFFSET), 4)
						).readUInt32LE(0),
					)
				: 0n;
		const size = sectionSize === 0n ? source.size - offset : sectionSize;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					`${baseName}#${String(entries.length).padStart(4, "0")}`,
				),
				offset,
				size,
			}),
		);
		if (sectionSize === 0n) break;
		offset += sectionSize;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const hg2Format: ArchiveFormat = defineFixedArchive({
	descriptor: hg2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readHg2Sections(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readHg2Sections(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid CatSystem2 HG2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
