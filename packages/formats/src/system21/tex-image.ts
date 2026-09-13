// Format reference: GARbro "Legacy/System21/ImageTEX.cs", class `TexFormat` (an SZDD packed DirectDraw
// surface). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss, inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `SZDD`. */
const SIGNATURE = Buffer.from("SZDD", "ascii");
/** The SZDD header, which the reference seeks past before opening the codec. */
const STREAM_OFFSET = 0x0e;
/**
 * `LzssStream` with a frame of 0x1000 bytes pre-filled with 0x20 and a write position of 0x1000 - 0x10 — the
 * same non-default settings the `BM_` port needs, since the fill escapes through matches that reach into
 * untouched parts of the ring buffer.
 */
const LZSS_SETTINGS = {
	frameSize: 0x1000,
	frameFill: 0x20,
	frameInitPosition: 0x1000 - 0x10,
};
/** Four bytes before the DirectDraw surface itself. */
const DDS_PREFIX = 4;
const DDS_MARKER = "DDS ";
/** The reference reads exactly this much of the decompressed stream to probe it. */
const HEADER_WINDOW = 0x84;
/** A DirectDraw surface header is a hundred and twenty four bytes plus the four byte magic. */
const DDS_HEADER_SIZE = 128;
const HEIGHT_OFFSET = 16;
const WIDTH_OFFSET = 20;
const FOURCC_OFFSET = 84;
const BIT_COUNT_OFFSET = 88;
const MAX_DIMENSION = 0x10000;
const MAX_PIXELS = 256 * 1024 * 1024;
/** Block compressed surfaces report no bit count, so the four character code stands in for it. */
const FOURCC_DEPTHS: Record<string, number> = {
	DXT1: 4,
	DXT2: 8,
	DXT3: 8,
	DXT4: 8,
	DXT5: 8,
	ATI1: 4,
	ATI2: 8,
	BC4U: 4,
	BC5U: 8,
};

interface TexLayout {
	width: number;
	height: number;
	bitsPerPixel?: number;
	fourCC: string;
}

/**
 * `ReadMetaData` opens the codec, reads a hundred and thirty two decompressed bytes, requires that they fail
 * unless they arrived complete, and looks for `DDS ` at offset four — so the surface itself starts four bytes
 * into the decompressed stream. The DirectDraw header is then read from there, which is where the dimensions
 * and the pixel format come from.
 */
async function readLayout(source: ByteSource): Promise<TexLayout | undefined> {
	if (source.size <= BigInt(STREAM_OFFSET)) return undefined;
	try {
		// The format re-checks the tag itself rather than trusting the registry gate, since the `BM_` port
		// claims the same signature for the same codec over a different payload.
		const tag = Buffer.from(await source.readAt(0n, SIGNATURE.length));
		if (!tag.equals(SIGNATURE)) return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const head = inflateLzss(stored, {
			...LZSS_SETTINGS,
			outputLength: HEADER_WINDOW,
		});
		// The reference declines when it cannot read the whole window.
		if (head.length < HEADER_WINDOW) return undefined;
		if (
			head.subarray(DDS_PREFIX, DDS_PREFIX + 4).toString("latin1") !==
			DDS_MARKER
		)
			return undefined;
		const height = head.readUInt32LE(HEIGHT_OFFSET);
		const width = head.readUInt32LE(WIDTH_OFFSET);
		if (width === 0 || height === 0) return undefined;
		if (width > MAX_DIMENSION || height > MAX_DIMENSION) return undefined;
		if (width * height > MAX_PIXELS) return undefined;
		const fourCC = head
			.subarray(FOURCC_OFFSET, FOURCC_OFFSET + 4)
			.toString("latin1");
		const bitCount = head.readUInt32LE(BIT_COUNT_OFFSET);
		const layout: TexLayout = { width, height, fourCC };
		const depth = FOURCC_DEPTHS[fourCC] ?? bitCount;
		if (depth > 0) layout.bitsPerPixel = depth;
		return layout;
	} catch {
		return undefined;
	}
}

export const texImageDescriptor: FormatDescriptor = {
	id: "system21-tex-image",
	name: "System21 compressed texture",
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
			source: "Legacy/System21/ImageTEX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const texImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: texImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid System21 TEX texture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "dds"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					fourCC: layout.fourCC,
					...(layout.bitsPerPixel === undefined
						? {}
						: { bitsPerPixel: layout.bitsPerPixel }),
				} as Record<string, unknown>,
			}),
			// The extraction is decompressed, so its length is not the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "dds",
				compression: "szdd",
				width: layout.width,
				height: layout.height,
				fourCC: layout.fourCC,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid System21 TEX texture");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		// The reference reads the whole surface through the codec, so the port decompresses to the end of the
		// stream rather than to any declared size.
		const surface = inflateLzssAll(stored, LZSS_SETTINGS);
		if (surface.length < DDS_PREFIX + DDS_HEADER_SIZE)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Truncated System21 TEX texture",
			);
		// This project has no DirectDraw surface decoder, so the surface is passed through as it stands, the
		// way the Malie MGF reader passes its PNG through; the four byte prefix is the only thing removed.
		return Readable.from([surface.subarray(DDS_PREFIX)]);
	},
});
