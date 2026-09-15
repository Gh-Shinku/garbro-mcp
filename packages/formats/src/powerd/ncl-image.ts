// Format reference: GARbro "Legacy/Powerd/ImageNCL.cs", class `NclFormat` (Powerd image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpImage,
	toBgra32,
	writeBmp32,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `CELL`, the word the reference registers the format under. */
export const POWERD_NCL_SIGNATURE: Buffer = Buffer.from("CELL", "latin1");
const HEADER_SIZE = 0x20;
/** The word at the fourth byte that every picture of this engine carries. */
const MARKER_FIELD = 4;
const MARKER = 0x010100;
const WIDTH_FIELD = 0x18;
const HEIGHT_FIELD = 0x1c;
/** Where the bitmap behind the header begins, and what its own header says it is long. */
const DATA_OFFSET = 0x24;
const BITMAP_SIZE_FIELD = 2;
const MAXIMUM_BITMAP_BYTES = 256 * 1024 * 1024;

interface PowerdNclLayout {
	width: number;
	height: number;
}

async function readNclLayout(
	source: ByteSource,
): Promise<PowerdNclLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, 4).equals(POWERD_NCL_SIGNATURE)) return undefined;
	if (header.readUInt32LE(MARKER_FIELD) !== MARKER) return undefined;
	return {
		width: header.readUInt32LE(WIDTH_FIELD),
		height: header.readUInt32LE(HEIGHT_FIELD),
	};
}

/**
 * The picture behind the header, with the second bitmap behind it, when there is one, laid over the first as
 * its alpha channel. Both of them are bitmaps of this project's own making, and the one that carries the alpha
 * has to be an eight bit grey one.
 */
async function renderNclImage(source: ByteSource): Promise<Buffer> {
	const layout = await readNclLayout(source);
	if (!layout) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Powerd NCL image");
	}
	const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
	if (stored.length <= DATA_OFFSET) {
		throw new GarbroError("INVALID_ARCHIVE", "Powerd NCL image has no bitmap");
	}
	const base = readBmpImage(stored.subarray(DATA_OFFSET));
	if (!base) {
		throw new GarbroError("INVALID_ARCHIVE", "Powerd NCL image has no bitmap");
	}
	// The reference measures the first bitmap with its own reader and steps over it by that length.
	const bitmapSize = stored.readUInt32LE(DATA_OFFSET + BITMAP_SIZE_FIELD);
	const alphaOffset = DATA_OFFSET + bitmapSize;
	if (bitmapSize < DATA_OFFSET || alphaOffset >= stored.length) {
		return writeBmpImage(base);
	}
	const alpha = readBmpImage(stored.subarray(alphaOffset));
	if (!alpha) {
		// The reference hands back the picture it read when what follows is not a bitmap.
		return writeBmpImage(base);
	}
	if (8 !== alpha.bitsPerPixel) {
		// The framework the reference uses converts any bitmap to the grey it wants; this port only knows the
		// eight bit one an engine of this vintage stores.
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`Unsupported Powerd NCL alpha of ${alpha.bitsPerPixel} bits`,
		);
	}
	const pixels = toBgra32(base);
	if (!pixels) {
		throw new GarbroError("INVALID_ARCHIVE", "Powerd NCL image has no bitmap");
	}
	const count = base.width * base.height;
	if (count * 4 > MAXIMUM_BITMAP_BYTES || alpha.pixels.length < count) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Powerd NCL image alpha covers too few pixels",
		);
	}
	for (let i = 0; i < count; i += 1) {
		pixels[i * 4 + 3] = alpha.pixels[i] ?? 0;
	}
	return writeBmp32(base.width, base.height, pixels, false);
}

export const powerdNclImageDescriptor: FormatDescriptor = {
	id: "powerd-ncl-image",
	name: "Powerd image",
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
			source: "Legacy/Powerd/ImageNCL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const powerdNclImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: powerdNclImageDescriptor,
	detection: { signatures: [{ bytes: POWERD_NCL_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readNclLayout(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readNclLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Powerd NCL image");
		}
		// The reference registers no extension, so the name of the entry is what the picture is: a bitmap.
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
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
							bitsPerPixel: 24,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		return Readable.from([await renderNclImage(source)]);
	},
});
