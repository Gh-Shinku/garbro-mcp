// Format reference: GARbro "Legacy/HillField/ImageIMA.cs", class `ImaFormat`. GARbro commit
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

const HEADER_SIZE = 0x10;
/** The three colour channels begin here, in one planar block of three bytes a pixel. */
const RGB_OFFSET = 0x10;
/** The alpha plane follows the colour block, which is measured from the header's own eight byte prefix. */
const ALPHA_ORIGIN = 8;
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface ImaLayout {
	width: number;
	height: number;
	/** The size of the colour block, which is at least three bytes a pixel. */
	rgbSize: number;
	/** Where the alpha plane begins: the colour block's declared size plus the prefix. */
	alphaOffset: number;
}

async function readLayout(source: ByteSource): Promise<ImaLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.readInt32LE(0) !== 0) return undefined;
		const rgbSize = header.readUInt32LE(4);
		const width = header.readUInt32LE(8);
		const height = header.readUInt32LE(12);
		// The reference multiplies two unsigned words, so an enormous image wraps on its way to zero.
		const planeSize = (width * height) >>> 0;
		const bitmapSize = (planeSize * 3) >>> 0;
		const room = Number(source.size) - rgbSize - 8;
		if (planeSize === 0 || bitmapSize > rgbSize || room < planeSize) {
			return undefined;
		}
		return { width, height, rgbSize, alphaOffset: ALPHA_ORIGIN + rgbSize };
	} catch {
		return undefined;
	}
}

export const imaImageDescriptor: FormatDescriptor = {
	id: "hillfield-ima-image",
	name: "Hill Field script system image",
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
			source: "Legacy/HillField/ImageIMA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const imaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: imaImageDescriptor,
	// No signature: the header's zero word and the two size relations are the whole probe.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hill Field image");
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
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hill Field image");
		const planeSize = (layout.width * layout.height) >>> 0;
		if (planeSize * 4 > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "Hill Field image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The probe only proves the alpha plane fits, so a file whose colour block runs off the end fails
		// here, exactly as the reference's own read does.
		if (RGB_OFFSET + planeSize * 3 > file.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Hill Field image");
		}
		if (layout.alphaOffset + planeSize > file.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Hill Field image");
		}
		const rgb = file.subarray(RGB_OFFSET, RGB_OFFSET + planeSize * 3);
		const alpha = file.subarray(
			layout.alphaOffset,
			layout.alphaOffset + planeSize,
		);
		const pixels: Buffer = Buffer.alloc(planeSize * 4, 0x00);
		for (let index = 0; index < planeSize; index += 1) {
			pixels[index * 4] = rgb[index * 3] ?? 0;
			pixels[index * 4 + 1] = rgb[index * 3 + 1] ?? 0;
			pixels[index * 4 + 2] = rgb[index * 3 + 2] ?? 0;
			// The alpha plane is stored inverted.
			pixels[index * 4 + 3] = 0xff - (alpha[index] ?? 0);
		}
		return Readable.from([
			// The reference hands the image over flipped, so the bitmap carries a positive height.
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
