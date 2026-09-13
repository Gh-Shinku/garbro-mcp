// Format reference: GARbro "ArcFormats/Kaguya/ImageAP.cs", class `Ap2Format` (KaGuYa image with an origin).
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
import { AP_MAX_DIMENSION } from "./ap-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'AP-2'`. */
const SIGNATURE = Buffer.from([0x41, 0x50, 0x2d, 0x32]);
/** The metadata read ends here; four bytes are then skipped before the pixels. */
const METADATA_SIZE = 0x14;
/** The pixels begin here, leaving a four byte gap the reference never reads. */
const DATA_OFFSET = 0x18;
const OFFSET_X_POSITION = 4;
const OFFSET_Y_POSITION = 8;
const WIDTH_POSITION = 0x0c;
const HEIGHT_POSITION = 0x10;
const BITS_PER_PIXEL = 32;
const BYTES_PER_PIXEL = 4;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface Ap2Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

/**
 * A four byte marker, a signed origin, two dimensions and an implied depth of thirty two. The reference reads
 * sixteen bytes from offset four and then seeks to 0x18, so the four bytes at 0x14 are **never read** — the
 * port skips them too and a test shows that whatever they hold makes no difference.
 */
async function readFields(source: ByteSource): Promise<Ap2Layout | undefined> {
	if (source.size < BigInt(METADATA_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, METADATA_SIZE));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const width = head.readUInt32LE(WIDTH_POSITION);
		const height = head.readUInt32LE(HEIGHT_POSITION);
		if (width > AP_MAX_DIMENSION || height > AP_MAX_DIMENSION) return undefined;
		if (width * height * BYTES_PER_PIXEL > MAX_PIXEL_BYTES) return undefined;
		return {
			width,
			height,
			offsetX: head.readInt32LE(OFFSET_X_POSITION),
			offsetY: head.readInt32LE(OFFSET_Y_POSITION),
		};
	} catch {
		return undefined;
	}
}

export const ap2ImageDescriptor: FormatDescriptor = {
	id: "kaguya-ap2-image",
	name: "KaGuYa script engine image with an origin",
	extensions: ["alp"],
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

export const ap2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ap2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AP-2 image");
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
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
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
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AP-2 image");
		const byteCount = layout.width * layout.height * BYTES_PER_PIXEL;
		let pixels: Buffer;
		try {
			pixels = Buffer.from(await source.readAt(BigInt(DATA_OFFSET), byteCount));
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KaGuYa AP-2 image");
		}
		// The reference compares the read against the buffer length and throws, so a short stream fails
		// rather than being zero-filled, and bytes after the pixels are never noticed.
		if (pixels.length !== byteCount)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KaGuYa AP-2 image");
		// `CreateFlipped` is a bitmap's own convention: the rows are stored top down and the height is
		// positive, so nothing is reversed.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
