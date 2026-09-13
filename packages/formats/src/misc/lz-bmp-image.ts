// Format reference: GARbro "ArcFormats/ImageLZ.cs", class `Bm_Format` (an `SZDD` compressed bitmap; the
// signature is the Microsoft COMPRESS.EXE marker). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
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

/** `SZDD`. */
const SIGNATURE = Buffer.from([0x53, 0x5a, 0x44, 0x44]);
/** The whole fourteen byte `SZDD` header is skipped; the reference never reads any of its fields. */
const STREAM_OFFSET = 0x0e;
/**
 * The reference overrides three of the LZSS defaults: the frame is the usual size, but it is pre-filled with
 * spaces and its write position starts sixteen bytes before the end rather than at `0xFEE`.
 */
const FRAME_SIZE = 0x1000;
const FRAME_FILL = 0x20;
const FRAME_INIT_POSITION = 0x1000 - 0x10;
/** A bound on the decompressed size, which the reference does not impose. */
const MAX_OUTPUT = 0x10000000;

interface LzBmpLayout {
	bmp: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `ReadMetaData` positions the stream past the `SZDD` header and decompresses into a bitmap reader. None of
 * the header's own fields — the mode, the missing character and the declared size — are used, so a test
 * overwrites all ten of them and expects the image to decode anyway.
 */
async function readLayout(
	source: ByteSource,
): Promise<LzBmpLayout | undefined> {
	if (source.size < BigInt(STREAM_OFFSET)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, 4));
		if (!header.equals(SIGNATURE)) return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const inflated = Buffer.from(
			inflateLzssAll(stored, {
				frameSize: FRAME_SIZE,
				frameFill: FRAME_FILL,
				frameInitPosition: FRAME_INIT_POSITION,
				maxOutputLength: MAX_OUTPUT,
			}),
		);
		const meta = readBmpMetaData(inflated);
		if (!meta) return undefined;
		// The reference would build an empty image; nothing can be drawn from one.
		if (meta.width === 0 || meta.height === 0) return undefined;
		return {
			bmp: inflated.subarray(0, meta.fileSize),
			width: meta.width,
			height: meta.height,
			bitsPerPixel: meta.bitsPerPixel,
		};
	} catch {
		return undefined;
	}
}

export const lzBmpImageDescriptor: FormatDescriptor = {
	id: "misc-lz-bmp-image",
	name: "LZ-compressed bitmap",
	extensions: ["bm_", "gpp", "meh", "gr_"],
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
			source: "ArcFormats/ImageLZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lzBmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lzBmpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LZ compressed bitmap");
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
				compression: "szdd-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				frameFill: FRAME_FILL,
				frameInitPosition: FRAME_INIT_POSITION,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LZ compressed bitmap");
		return Readable.from([layout.bmp]);
	},
});
