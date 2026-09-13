// Format reference: GARbro "Legacy/ADVGSys/ImageBMP.cs", class `AdvgFormat` (an LZSS compressed bitmap
// behind a four byte prefix whose fifth byte carries a marker nibble). GARbro commit
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

/** The reference reads ten bytes to check the marker, of which only a nibble and `BM` matter. */
const PROBE_SIZE = 0xa;
/** The LZSS stream starts here, so the marker nibble sits on the byte just before it. */
const STREAM_OFFSET = 4;
/** The marker nibble lives in the low half of the byte before the stream. */
const MARKER_NIBBLE = 0xf;
/** Guards against a hostile stream asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

interface AdvgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The length the bitmap's own header declares. */
	fileSize: number;
}

/** `OpenBitmapStream` seeks to offset four and turns the rest of the file into an LZSS stream. */
async function readBitmap(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size <= BigInt(PROBE_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, PROBE_SIZE));
		if (((head[STREAM_OFFSET] ?? 0) & 0x0f) !== MARKER_NIBBLE) return undefined;
		if (head.toString("latin1", STREAM_OFFSET + 1, STREAM_OFFSET + 3) !== "BM")
			return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		return Buffer.from(inflateLzssAll(stored, { maxOutputLength: MAX_OUTPUT }));
	} catch {
		return undefined;
	}
}

async function readLayout(source: ByteSource): Promise<AdvgLayout | undefined> {
	const bmp = await readBitmap(source);
	if (!bmp) return undefined;
	const meta = readBmpMetaData(bmp);
	if (!meta) return undefined;
	return {
		width: meta.width,
		height: meta.height,
		bitsPerPixel: meta.bitsPerPixel,
		fileSize: meta.fileSize,
	};
}

export const advgImageDescriptor: FormatDescriptor = {
	id: "advgsys-bmp-image",
	name: "Compressed bitmap format",
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
			source: "Legacy/ADVGSys/ImageBMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const advgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advgImageDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ADVGSys bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(STREAM_OFFSET),
				size: source.size - BigInt(STREAM_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and the bitmap is trimmed to its declared length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ADVGSys bitmap");
		const bmp = await readBitmap(source);
		if (!bmp)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ADVGSys bitmap");
		// A bitmap may declare less than the stream holds; the reference reads it by its own length.
		return Readable.from([bmp.subarray(0, layout.fileSize)]);
	},
});
