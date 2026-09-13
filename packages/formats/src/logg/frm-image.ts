// Format reference: GARbro "Legacy/Logg/ImageFRM.cs", class `FrmFormat` (a palettised eight bit image
// with an explicit row stride). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference's signature word is `0x4D5246`, i.e. `FRM` followed by a zero byte. */
const SIGNATURE = Buffer.from([0x46, 0x52, 0x4d, 0x00]);
const HEADER_SIZE = 0x10;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
const STRIDE_OFFSET = 0x0c;
/** `ReadPalette` consumes four bytes per colour for all 256 entries. */
const PALETTE_SIZE = 0x400;
const PIXEL_OFFSET = HEADER_SIZE + PALETTE_SIZE;

interface FrmLayout {
	width: number;
	height: number;
	stride: number;
}

export const frmImageDescriptor: FormatDescriptor = {
	id: "logg-frm-image",
	name: "Logg image format",
	extensions: ["frm"],
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
			source: "Legacy/Logg/ImageFRM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const frmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: frmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Logg FRM image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// A bitmap header and palette are written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				stride: layout.stride,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Logg FRM image");
		// The reader consumes `stride * height` bytes and throws when the file is shorter.
		const needed = PIXEL_OFFSET + layout.stride * layout.height;
		if (BigInt(needed) > source.size)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Logg FRM image");
		const stored = Buffer.from(await source.readAt(0n, needed));
		const palette = Buffer.from(stored.subarray(HEADER_SIZE, PIXEL_OFFSET));
		// Rows carry `stride` bytes each and only the first `width` of them are pixels, so the padding
		// is dropped while the image is compacted into bitmap rows.
		const pixels = Buffer.alloc(layout.width * layout.height);
		for (let row = 0; row < layout.height; row += 1) {
			stored.copy(
				pixels,
				row * layout.width,
				PIXEL_OFFSET + row * layout.stride,
				PIXEL_OFFSET + row * layout.stride + layout.width,
			);
		}
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette),
		]);
	},
});

/** The header fields `ReadMetaData` reads; it validates nothing, so the checks below are deviations. */
async function readLayout(source: ByteSource): Promise<FrmLayout | undefined> {
	if (source.size <= BigInt(PIXEL_OFFSET)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		const stride = header.readInt32LE(STRIDE_OFFSET);
		if (width === 0 || height === 0) return undefined;
		if (stride < 0 || stride < width) return undefined;
		return { width, height, stride };
	} catch {
		return undefined;
	}
}
