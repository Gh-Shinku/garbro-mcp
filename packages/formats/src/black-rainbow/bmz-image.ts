// Format reference: GARbro "ArcFormats/BlackRainbow/ImageBMZ.cs", class `BmzFormat` (a bitmap inside a zlib
// stream, behind an eight byte header). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `ZLC3`. */
const SIGNATURE = Buffer.from([0x5a, 0x4c, 0x43, 0x33]);
const HEADER_SIZE = 8;
const UNPACKED_SIZE_OFFSET = 4;
/** A bound on the decompressed size, which the reference does not impose. */
const MAX_OUTPUT = 0x10000000;

interface BmzLayout {
	bmp: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The size word in the header. The reference reads it and never uses it. */
	declaredSize: number;
}

/**
 * `ReadMetaData` reads eight bytes and then inflates the stream that follows, so the size word at offset four
 * is never consulted — it is an artifact of the writer, which stores the length of the bitmap it compressed.
 * `Read` seeks the same eight bytes and repeats the work.
 */
async function readLayout(source: ByteSource): Promise<BmzLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		const bmp = Buffer.from(await inflateZlibBufferCapped(stored, MAX_OUTPUT));
		const meta = readBmpMetaData(bmp);
		if (!meta) return undefined;
		// The reference would build an empty image; nothing can be drawn from one.
		if (meta.width === 0 || meta.height === 0) return undefined;
		return {
			bmp: bmp.subarray(0, meta.fileSize),
			width: meta.width,
			height: meta.height,
			bitsPerPixel: meta.bitsPerPixel,
			declaredSize: header.readUInt32LE(UNPACKED_SIZE_OFFSET),
		};
	} catch {
		return undefined;
	}
}

export const bmzImageDescriptor: FormatDescriptor = {
	id: "black-rainbow-bmz-image",
	name: "Black Rainbow compressed bitmap format",
	extensions: ["bmz"],
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
			source: "ArcFormats/BlackRainbow/ImageBMZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bmzImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bmzImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Black Rainbow BMZ image",
			);
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
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is part of the payload.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "zlib",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				declaredSize: layout.declaredSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Black Rainbow BMZ image",
			);
		return Readable.from([layout.bmp]);
	},
});
