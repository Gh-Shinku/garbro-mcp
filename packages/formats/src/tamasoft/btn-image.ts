// Format reference: GARbro "ArcFormats/TamaSoft/ImageBTN.cs", class `BtnFormat` (a button image that carries a
// whole SUR file at a computed offset). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { unpackSurLzss } from "./sur-lzss.js";
import { readSurLayout } from "./sur-image.js";

/** `EBTN`. */
const SIGNATURE = Buffer.from([0x45, 0x42, 0x54, 0x4e]);
const COUNT_OFFSET = 4;
/** The button table starts after this much header, four bytes an entry. */
const TABLE_OFFSET = 0x30;
const TABLE_ENTRY_SIZE = 4;
const BYTES_PER_PIXEL = 4;
/** Relative to the embedded SUR file, not to this one. */
const SUR_PIXEL_OFFSET = 0x20;

/**
 * `ReadMetaData` seeks to offset four, reads a count, computes `0x30 + count * 4` and re-parses the header from
 * there as if the region were a SUR file. The table itself and everything else before the embedded file are
 * never read, and the count is signed, so a negative one would seek before the file.
 */
function surOffsetOf(count: number): number {
	return TABLE_OFFSET + count * TABLE_ENTRY_SIZE;
}

export const btnImageDescriptor: FormatDescriptor = {
	id: "tamasoft-btn-image",
	name: "TamaSoft ADV system button image",
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
			source: "ArcFormats/TamaSoft/ImageBTN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const btnImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: btnImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readBtnLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readBtnLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TamaSoft BTN image");
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
					bitsPerPixel: 32,
					surOffset: layout.offset,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "sur-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				surOffset: layout.offset,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readBtnLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TamaSoft BTN image");
		const streamOffset = layout.offset + SUR_PIXEL_OFFSET;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(streamOffset),
				Number(source.size) - streamOffset,
			),
		);
		const needed = layout.width * layout.height * BYTES_PER_PIXEL;
		let pixels: Buffer;
		try {
			pixels = unpackSurLzss(stored, needed);
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated TamaSoft BTN image");
		}
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});

interface BtnLayout {
	width: number;
	height: number;
	/** Where the embedded SUR file starts. */
	offset: number;
}

async function readBtnLayout(
	source: ByteSource,
): Promise<BtnLayout | undefined> {
	if (source.size < BigInt(TABLE_OFFSET)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, TABLE_OFFSET));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const count = header.readInt32LE(COUNT_OFFSET);
		const offset = surOffsetOf(count);
		// The reference seeks to the computed offset and parses a SUR header there, which throws for an offset
		// outside the stream or a region too short to hold sixteen bytes.
		if (offset < TABLE_OFFSET || offset > Number(source.size)) return undefined;
		const sur = await readSurLayout(source, offset);
		if (!sur) return undefined;
		return { width: sur.width, height: sur.height, offset };
	} catch {
		return undefined;
	}
}
