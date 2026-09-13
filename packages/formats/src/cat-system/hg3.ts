// Format reference: GARbro ArcFormats/CatSystem/ArcHG3.cs
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

const SIGNATURE = Buffer.from("HG-3", "ascii");
const FIRST_SECTION_OFFSET = 0x0c;
const SECTION_HEADER_SIZE = 8;
const STDINFO_MARKER = Buffer.from("stdinfo", "ascii");
const IMG_MARKER = Buffer.from("img", "ascii");
const STDINFO_SIZE_OFFSET = 0x10;

export const hg3Descriptor: FormatDescriptor = {
	id: "cat-system-hg3",
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
			source: "ArcFormats/CatSystem/ArcHG3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `Hg3Opener.TryOpen`. Sections start at 0x0c and are walked while their `stdinfo` marker
 * matches; a section contributes an entry only when an `img` chunk follows the `stdinfo` block, and
 * the entry covers the section without its eight-byte header.
 */
async function readHg3Sections(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_SECTION_OFFSET)) return undefined;
	const header = await source.readAt(0n, FIRST_SECTION_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let offset = BigInt(FIRST_SECTION_OFFSET);
	// GARbro numbers sections, not entries, so skipped sections still consume a name index.
	let sectionIndex = 0;
	while (offset + BigInt(SECTION_HEADER_SIZE + 0x0c) < source.size) {
		const sectionHeader = await source.readAt(
			offset,
			SECTION_HEADER_SIZE + 0x0c,
		);
		if (
			!sectionHeader
				.subarray(
					SECTION_HEADER_SIZE,
					SECTION_HEADER_SIZE + STDINFO_MARKER.length,
				)
				.equals(STDINFO_MARKER)
		)
			break;
		const declared = BigInt(sectionHeader.readUInt32LE(0));
		const sectionSize = declared === 0n ? source.size - offset : declared;
		const stdinfoSize = BigInt(sectionHeader.readUInt32LE(STDINFO_SIZE_OFFSET));
		const imgOffset = offset + BigInt(SECTION_HEADER_SIZE) + stdinfoSize;
		if (imgOffset + BigInt(IMG_MARKER.length) <= source.size) {
			const marker = await source.readAt(imgOffset, IMG_MARKER.length);
			if (marker.equals(IMG_MARKER)) {
				const entryOffset = offset + BigInt(SECTION_HEADER_SIZE);
				const size = sectionSize - BigInt(SECTION_HEADER_SIZE);
				if (size < 0n || !checkPlacement(entryOffset, size, source.size))
					return undefined;
				entries.push(
					createFixedEntry({
						id: entries.length,
						...normalizeEntryPath(
							`${baseName}#${String(sectionIndex).padStart(4, "0")}`,
						),
						offset: entryOffset,
						size,
					}),
				);
			}
		}
		offset += sectionSize;
		sectionIndex += 1;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const hg3Format: ArchiveFormat = defineFixedArchive({
	descriptor: hg3Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readHg3Sections(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readHg3Sections(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid CatSystem2 HG3 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
