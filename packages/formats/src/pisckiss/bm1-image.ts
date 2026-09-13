// Format reference: GARbro "Legacy/Pisckiss/Image1.cs", class `Bm1Format` (Pisckiss encrypted bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeHeader } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** There is no signature; the header is five bytes and the first one is only tested for two bits. */
const HEADER_SIZE = 5;
/** Both of these have to be clear in the first byte, which is the closest thing to a marker here. */
const FORBIDDEN_BITS = 0x42;
const BITS_PER_PIXEL = 24;
const BYTES_PER_PIXEL = 3;
const BMP_HEADER_SIZE = 54;

interface Bm1Layout {
	width: number;
	height: number;
}

/**
 * The dimensions are packed as **nibbles** across the four bytes after the first, and the two of them
 * interleave: each byte holds the next nibble of the width in one half and the next nibble of the height in the
 * other, with the low half carrying the odd nibbles of the width and the high half the even ones. Each value is
 * assembled least significant nibble first, so the byte at offset one supplies the bottom four bits of both.
 *
 * The first byte is rejected if **either** of bits 0x40 and 0x02 is set, which is all this format checks beyond
 * the dimensions; other bits are ignored.
 */
function unpackDimension(header: Buffer, evenHalves: boolean): number {
	let value = 0;
	let shift = 0;
	for (let index = 0; index < 4; index += 1) {
		const byte = header[index + 1] ?? 0;
		// Even rounds take the low half of the width and the high half of the height; odd rounds swap over.
		const high = (index & 1) === 0 ? evenHalves : !evenHalves;
		const nibble = high ? byte >> 4 : byte & 0x0f;
		value |= nibble << shift;
		shift += 4;
	}
	return value >>> 0;
}

async function readFields(source: ByteSource): Promise<Bm1Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (((head[0] ?? 0) & FORBIDDEN_BITS) !== 0) return undefined;
		const width = unpackDimension(head, false);
		const height = unpackDimension(head, true);
		if (width === 0 || height === 0) return undefined;
		// The length has to account for the file **exactly**, and the reference computes it in a thirty two bit
		// integer, so a large pair of dimensions wraps and cannot match a real file's length.
		const stride = (width * BYTES_PER_PIXEL + 3) & ~3;
		const length = (HEADER_SIZE + stride * height) >>> 0;
		if (BigInt(length) !== source.size) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const bm1ImageDescriptor: FormatDescriptor = {
	id: "pisckiss-bm1-image",
	name: "Pisckiss encrypted bitmap",
	extensions: ["1"],
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
			source: "Legacy/Pisckiss/Image1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bm1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bm1ImageDescriptor,
	// No signature: the packed header and the exact length are what identify the format.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pisckiss bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
				} as Record<string, unknown>,
			}),
			// The extraction is a bitmap, so it has a header the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pisckiss bitmap");
		// The exact length check means the pixel block is exactly as long as the stride demands.
		const stride = (layout.width * BYTES_PER_PIXEL + 3) & ~3;
		const pixels = Buffer.from(
			await source.readAt(BigInt(HEADER_SIZE), stride * layout.height),
		);
		// `CreateFlipped` is a bitmap's own convention: the rows are stored bottom up under a positive height,
		// so nothing is reversed. The stored stride already is a bitmap's, so the rows are carried across
		// exactly — padding included — rather than repacked through a tighter stride that would drop it.
		const bitmap = Buffer.concat([
			writeHeader(
				layout.width,
				layout.height,
				BITS_PER_PIXEL,
				BMP_HEADER_SIZE,
				stride * layout.height,
				0,
				true,
			),
			pixels,
		]);
		return Readable.from([bitmap]);
	},
});
