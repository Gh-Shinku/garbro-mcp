// Format reference: GARbro "ArcFormats/Kaguya/ImageAP.cs", class `ApFormat` (KaGuYa script engine image), and
// the `ReadBitmapData` helper its subclasses reuse.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The header is `AP`, two dimensions and a depth; the subclasses extend it. */
export const AP_HEADER_SIZE = 12;
export const AP_MARKER = Buffer.from([0x41, 0x50]);
export const AP_MAX_DIMENSION = 0x8000;
/** Whatever the stored depth says, the pixels are four bytes each. */
export const AP_BYTES_PER_PIXEL = 4;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

export interface ApLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Some subclasses carry an origin; the base format reads neither field. */
	offsetX?: number;
	offsetY?: number;
}

/**
 * Reads a header of `AP` and twenty four or thirty two bit pixels. The base format validates nothing beyond
 * the marker, a dimension ceiling and the two depths, so a zero dimension is accepted — and the `24` case is a
 * label rather than a description, since the pixels are four bytes wide either way.
 */
export async function readApFields(
	source: ByteSource,
	marker: Buffer = AP_MARKER,
	headerSize: number = AP_HEADER_SIZE,
): Promise<ApLayout | undefined> {
	if (source.size < BigInt(headerSize)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, headerSize));
		if (!head.subarray(0, marker.length).equals(marker)) return undefined;
		const width = head.readUInt32LE(2);
		const height = head.readUInt32LE(6);
		const bitsPerPixel = head.readInt16LE(10);
		if (
			width > AP_MAX_DIMENSION ||
			height > AP_MAX_DIMENSION ||
			(bitsPerPixel !== 32 && bitsPerPixel !== 24)
		)
			return undefined;
		if (width * height * AP_BYTES_PER_PIXEL > MAX_PIXEL_BYTES) return undefined;
		return { width, height, bitsPerPixel };
	} catch {
		return undefined;
	}
}

/**
 * `ReadBitmapData`: the file's rows run bottom up and the buffer is built top down, so the first row read
 * lands in the buffer's last row. Each row has to arrive whole — the reference throws when a read returns
 * short — which makes a truncated image an extraction failure rather than a partly filled one.
 */
export async function readApBitmap(
	source: ByteSource,
	layout: ApLayout,
	dataOffset: number,
): Promise<Buffer> {
	const stride = layout.width * AP_BYTES_PER_PIXEL;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	// The row counter is the *destination* row; the stream itself is read straight through, so the file's
	// first row is the bitmap's bottom row.
	let position = dataOffset;
	for (let row = layout.height - 1; row >= 0; row -= 1) {
		const data = Buffer.from(await source.readAt(BigInt(position), stride));
		if (data.length !== stride)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KaGuYa image");
		data.copy(pixels, row * stride);
		position += stride;
	}
	return pixels;
}

export const apImageDescriptor: FormatDescriptor = {
	id: "kaguya-ap-image",
	name: "KaGuYa script engine image",
	extensions: ["bg_", "cg_", "cgw", "sp_", "aps", "alp", "prs"],
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
			source: "ArcFormats/Kaguya/ImageAP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const apImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: apImageDescriptor,
	// No signature: the marker is checked by the probe itself.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readApFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readApFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa image");
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
			// The extraction is a bitmap, so it has a header the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readApFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa image");
		const pixels = await readApBitmap(source, layout, AP_HEADER_SIZE);
		// `ImageData.Create` is top down, which a bitmap records as a negative height.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
