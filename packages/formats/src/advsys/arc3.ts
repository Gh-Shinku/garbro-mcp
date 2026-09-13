// Format reference: GARbro ArcFormats/AdvSys/ArcAdvSys3.cs
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
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "dat";
const FILE_PREFIX = "arc";
const SIZE_OFFSET = 0;
const NAME_LENGTH_OFFSET = 8;
const NAME_OFFSET = 10;
const MAX_NAME_LENGTH = 0x100;
/** Payloads that carry a `GWD` marker at +4 are renamed to the matching extension. */
const GWD_MARKER = Buffer.from("GWD", "ascii");
const GWD_MARKER_OFFSET = 4;

export const advSys3Descriptor: FormatDescriptor = {
	id: "advsys3-arc",
	name: "AdvSys3 engine resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/AdvSys/ArcAdvSys3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `ArcOpener.TryOpen`. The archive is a chain of records: a 32-bit size, four reserved bytes,
 * a 16-bit name length, and the name, followed by the payload. A zero size ends the walk. The format
 * only applies to `.dat` files whose name starts with `arc`.
 *
 * GARbro derives entry types from payload signatures; the port keeps the stored names and only
 * applies the hardcoded `GWD` rename.
 */
async function readAdvSys3Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (!basename(sourcePath).toLowerCase().startsWith(FILE_PREFIX))
		return undefined;
	const entries: FixedEntry[] = [];
	let current = 0n;
	while (current < source.size) {
		// GARbro reads the header through the file view, so a truncated final record reads as zeros
		// and ends the walk.
		if (current + BigInt(NAME_OFFSET) > source.size) break;
		const header = await source.readAt(current, NAME_OFFSET);
		const size = BigInt(header.readUInt32LE(SIZE_OFFSET));
		if (size === 0n) break;
		const nameLength = header.readUInt16LE(NAME_LENGTH_OFFSET);
		if (nameLength === 0 || nameLength > MAX_NAME_LENGTH) return undefined;
		const nameField = await source.readAt(
			current + BigInt(NAME_OFFSET),
			nameLength,
		);
		const name = decodeCStringField(nameField, 0, nameLength);
		if (name.length === 0) return undefined;
		const offset = current + BigInt(NAME_OFFSET + nameLength);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const marker =
			offset + BigInt(GWD_MARKER_OFFSET + GWD_MARKER.length) <= source.size
				? await source.readAt(
						offset + BigInt(GWD_MARKER_OFFSET),
						GWD_MARKER.length,
					)
				: undefined;
		const normalized = normalizeEntryPath(name);
		const path =
			marker?.equals(GWD_MARKER) === true
				? `${normalized.path.replace(/\.[^./\\]*$/, "")}.gwd`
				: normalized.path;
		entries.push(createFixedEntry({ id: entries.length, path, offset, size }));
		current = offset + size;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const advSys3Format: ArchiveFormat = defineFixedArchive({
	descriptor: advSys3Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAdvSys3Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAdvSys3Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AdvSys3 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
