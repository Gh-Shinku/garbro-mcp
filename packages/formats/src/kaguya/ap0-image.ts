// Format reference: GARbro "ArcFormats/Kaguya/ImageAP.cs", class `Ap0Format` (KaGuYa grayscale image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { AP_MAX_DIMENSION } from "./ap-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'AP-0'`. */
const SIGNATURE = Buffer.from([0x41, 0x50, 0x2d, 0x30]);
const HEADER_SIZE = 12;
const WIDTH_POSITION = 4;
const HEIGHT_POSITION = 8;
/** The depth is not stored at all: this format is always eight bit grayscale. */
const BITS_PER_PIXEL = 8;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface Ap0Layout {
	width: number;
	height: number;
}

/** Twelve bytes, two dimensions and no depth field, so the markers occupy the first four bytes. */
async function readFields(source: ByteSource): Promise<Ap0Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const width = head.readUInt32LE(WIDTH_POSITION);
		const height = head.readUInt32LE(HEIGHT_POSITION);
		if (width > AP_MAX_DIMENSION || height > AP_MAX_DIMENSION) return undefined;
		if (width * height > MAX_PIXEL_BYTES) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const ap0ImageDescriptor: FormatDescriptor = {
	id: "kaguya-ap0-image",
	name: "KaGuYa script engine grayscale image",
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

export const ap0ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ap0ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AP-0 image");
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
			// The extraction is a bitmap, so it has a header and a palette the stored data does not.
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AP-0 image");
		const pixelCount = layout.width * layout.height;
		let stored: Buffer;
		try {
			stored = Buffer.from(
				await source.readAt(BigInt(HEADER_SIZE), pixelCount),
			);
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KaGuYa AP-0 image");
		}
		// The reference demands the whole buffer and throws `EndOfStreamException` otherwise, so a short
		// stream fails rather than filling the rest with zeroes; trailing bytes are not noticed at all.
		if (stored.length !== pixelCount)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KaGuYa AP-0 image");
		// `CreateFlipped` where the base format uses `Create`: the rows are stored **top down** here and the
		// bitmap records that as a positive height, so unlike `AP` nothing is reversed.
		return Readable.from([
			writeBmp8(layout.width, layout.height, stored, true),
		]);
	},
});
