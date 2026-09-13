// Format reference: GARbro "Legacy/Nabe/ImageYPF.cs", class `YpfFormat` (Studio Nabe Bugyou image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const HEADER_SIZE = 0x10;
const DATA_OFFSET = 0x10;
const EXTENSION = "ypf";
/** The header's first byte names the depth: one is twenty four bits, three is thirty two. */
const BGR_DEPTH = 1;
const BGRA_DEPTH = 3;
/** The reference refuses a dimension of zero or above this. */
const MAX_DIMENSION = 0x8000;

interface YpfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

async function readFields(source: ByteSource): Promise<YpfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const depth = header[0] ?? 0;
		if (depth !== BGR_DEPTH && depth !== BGRA_DEPTH) return undefined;
		const width = header.readUInt32LE(4);
		const height = header.readUInt32LE(8);
		if (width === 0 || width > MAX_DIMENSION) return undefined;
		if (height === 0 || height > MAX_DIMENSION) return undefined;
		return {
			width,
			height,
			bitsPerPixel: depth === BGR_DEPTH ? 24 : 32,
		};
	} catch {
		return undefined;
	}
}

/** The probe gates the whole format on the file's own extension; the reading itself does not. */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<YpfLayout | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	return readFields(source);
}

export const ypfImageDescriptor: FormatDescriptor = {
	id: "nabe-ypf-image",
	name: "Studio Nabe Bugyou image",
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
			source: "Legacy/Nabe/ImageYPF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ypfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ypfImageDescriptor,
	// The reference declares no signature at all, only the extension gate and the depth byte.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Studio Nabe image");
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
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Studio Nabe image");
		const { width, height, bitsPerPixel } = layout;
		const pixelCount = width * height;
		if (pixelCount > Math.floor(Number.MAX_SAFE_INTEGER / 4)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Studio Nabe image is too large",
			);
		}
		// The reference reads what it asks for and leaves the rest of the buffer blank, so a short file pads.
		const file = Buffer.from(
			await source.readAt(
				0n,
				Math.min(Number(source.size), DATA_OFFSET + pixelCount * 4),
			),
		);
		const colours: Buffer = Buffer.alloc(pixelCount * 3, 0x00);
		file.copy(
			colours,
			0,
			DATA_OFFSET,
			Math.min(file.length, DATA_OFFSET + colours.length),
		);
		if (bitsPerPixel === 24) {
			// Three bytes a pixel, handed over in the order they are stored: the reference's Bgr24.
			return Readable.from([writeBmp24(width, height, colours, false)]);
		}
		const alpha: Buffer = Buffer.alloc(pixelCount, 0x00);
		const alphaAt = DATA_OFFSET + colours.length;
		file.copy(alpha, 0, alphaAt, Math.min(file.length, alphaAt + alpha.length));
		const pixels: Buffer = Buffer.alloc(pixelCount * 4, 0x00);
		for (let index = 0; index < pixelCount; index += 1) {
			pixels[index * 4] = colours[index * 3] ?? 0;
			pixels[index * 4 + 1] = colours[index * 3 + 1] ?? 0;
			pixels[index * 4 + 2] = colours[index * 3 + 2] ?? 0;
			pixels[index * 4 + 3] = alpha[index] ?? 0;
		}
		return Readable.from([writeBmp32(width, height, pixels, false)]);
	},
});
