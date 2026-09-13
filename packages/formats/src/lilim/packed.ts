// Format reference: GARBro ArcFormats/Lilim/ArcAOS.cs, class `AosOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decompressHuffman } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ByteSource,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import type { FixedEntry } from "../shared/fixed-archive.js";

/** Packed entries declare their unpacked size and then store a Huffman stream. */
const PACKED_HEADER_SIZE = 4;

/**
 * GARbro `AosOpener.OpenEntry`, also used by the FGA and AOS version 2 layouts. A packed entry starts
 * with a 32-bit unpacked size followed by a Huffman stream. GARbro wraps the decoder in a `LimitStream`,
 * so the declared size bounds the output instead of being verified against it, and a stream that ends
 * early yields fewer bytes.
 */
export async function openPackedHuffmanEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const unpackedSize = (
		await source.readAt(entry.offset, PACKED_HEADER_SIZE)
	).readUInt32LE(0);
	const packedSize = entry.packedSize - BigInt(PACKED_HEADER_SIZE);
	if (
		packedSize < 0n ||
		entry.offset + BigInt(PACKED_HEADER_SIZE) + packedSize > source.size
	) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Packed entry exceeds the archive",
		);
	}
	const packed = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		bigintToBufferLength(packedSize, "Huffman entry"),
	);
	return Readable.from([
		decompressHuffman(
			packed,
			bigintToBufferLength(BigInt(unpackedSize), "Huffman output"),
		),
	]);
}
