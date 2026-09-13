// Format reference: GARBro ArcFormats/Silky/ArcAi6Win.cs (`Ai6Opener.OpenEntry`) and
// ArcFormats/LzssStream.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import { bigintToBufferLength, type ByteSource } from "@garbro-mcp/core";
import { Readable } from "node:stream";
import type { FixedEntry } from "../shared/fixed-archive.js";

/**
 * GARbro `Ai6Opener.OpenEntry`, shared by the AI6WIN and Azurite layouts. Entries whose stored size
 * differs from their unpacked size are plain LZSS streams decoded with GARbro's `LzssStream` defaults,
 * which are also the defaults of `@garbro-mcp/codecs`; everything else is stored verbatim.
 */
export async function openAi6Entry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "LZSS entry"),
	);
	return Readable.from([inflateLzssAll(stored)]);
}
