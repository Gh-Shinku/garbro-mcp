// Format reference: GARBro Legacy/WestGate/ArcUCA.cs, class `UcaOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { defineFixedArchive } from "../shared/fixed-archive.js";
import { readWestGateIndex } from "./index-reader.js";

const EXTENSIONS = ["uca", "arc"];
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 0x10;

export const ucaDescriptor: FormatDescriptor = {
	id: "westgate-uca",
	name: "West Gate graphics archive",
	extensions: EXTENSIONS,
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
			source: "Legacy/WestGate/ArcUCA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `UcaOpener.TryOpen`. The first word must be zero and the entry count follows it at 4; the
 * index then begins at 0x10 and is read through the shared WestGate reader, which the UWF audio
 * archive uses as well.
 *
 * The format carries no signature, and the reference registers it for the `uca` and `arc` extensions,
 * so the zero word plus the shared index validation are the detection. GARbro decodes the payloads as
 * images, which is a concern outside the archive layer; the port extracts them verbatim.
 */
async function readUcaIndex(source: ByteSource) {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readUInt32LE(0) !== 0) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	return readWestGateIndex(source, {
		indexOffset: INDEX_OFFSET,
		count,
		entryType: "image",
	});
}

export const ucaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ucaDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readUcaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readUcaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid West Gate UCA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
