// Format reference: GARbro "Legacy/Asura/ImageMTG.cs", class `MtgFormat`. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The header carries the two dimensions and the size of the pixel block. */
const HEADER_SIZE = 0x10;
/** The pixels begin directly behind the header and the alpha plane directly behind the pixels. */
const DATA_OFFSET = 0x10;
const EXTENSION = "mtg";
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface MtgLayout {
	width: number;
	height: number;
	/** The size of the stored pixel block, which the alpha plane follows whether or not it is padded. */
	dataLength: number;
	hasAlpha: boolean;
}

async function readFields(source: ByteSource): Promise<MtgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const dataLength = header.readInt32LE(8);
		// The size is signed, and it may not claim more than the file holds.
		if (dataLength <= 0 || BigInt(dataLength) > source.size) return undefined;
		const alpha = header.readInt32LE(0x0c);
		if (alpha !== 0 && alpha !== 1) return undefined;
		return {
			width: header.readUInt32LE(0),
			height: header.readUInt32LE(4),
			dataLength,
			hasAlpha: alpha !== 0,
		};
	} catch {
		return undefined;
	}
}

/** The format is found by its extension: there is no signature, and a file without this name is not its own. */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<MtgLayout | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	return readFields(source);
}

export const mtgImageDescriptor: FormatDescriptor = {
	id: "asura-mtg-image",
	name: "Asura engine image",
	extensions: [EXTENSION],
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
			source: "Legacy/Asura/ImageMTG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mtgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mtgImageDescriptor,
	// No signature at all: the extension is what tells this format's files apart.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Asura image");
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
					// The reference reports twenty four bits whether or not an alpha plane follows.
					bitsPerPixel: 24,
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
				bitsPerPixel: 24,
				hasAlpha: layout.hasAlpha,
				dataLength: layout.dataLength,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Asura image");
		const { width, height, dataLength, hasAlpha } = layout;
		const planeSize = width * height;
		const colourBytes = planeSize * 3;
		if (planeSize * 4 > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "Asura image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (DATA_OFFSET + dataLength > file.length || dataLength < colourBytes) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Asura image");
		}
		const pixels = file.subarray(DATA_OFFSET, DATA_OFFSET + dataLength);
		if (!hasAlpha) {
			return Readable.from([writeBmp24(width, height, pixels, false)]);
		}
		// The alpha plane follows the pixel block's own length, not the pixels it holds.
		const alphaOffset = DATA_OFFSET + dataLength;
		if (alphaOffset + planeSize > file.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Asura image");
		}
		const alpha = file.subarray(alphaOffset, alphaOffset + planeSize);
		const output: Buffer = Buffer.alloc(planeSize * 4, 0x00);
		for (let index = 0; index < planeSize; index += 1) {
			output[index * 4] = pixels[index * 3] ?? 0;
			output[index * 4 + 1] = pixels[index * 3 + 1] ?? 0;
			output[index * 4 + 2] = pixels[index * 3 + 2] ?? 0;
			output[index * 4 + 3] = alpha[index] ?? 0;
		}
		return Readable.from([writeBmp32(width, height, output, false)]);
	},
});
