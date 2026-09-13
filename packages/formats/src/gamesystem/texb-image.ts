// Format reference: GARbro "ArcFormats/GameSystem/ImageTEXB.cs", class `TexbFormat` (a raw 32 bit texture
// whose dimensions describe the file length exactly, stored bottom up). GARbro commit
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
	sourceExtension,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
const WIDTH_OFFSET = 0;
const HEIGHT_OFFSET = 4;
const PIXEL_OFFSET = 8;
const BYTES_PER_PIXEL = 4;

interface TexbLayout {
	width: number;
	height: number;
}

/** The reference gates on `.texb` before reading anything. */
function hasExtension(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "texb";
}

/**
 * `ReadMetaData`: the name must end in `.texb`, both dimensions must be non-zero, and the file has to be
 * exactly a header plus `width * height * 4` bytes. There is no signature, so this arithmetic is what
 * identifies the format.
 */
async function readLayout(source: ByteSource): Promise<TexbLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		const expected = BigInt(HEADER_SIZE) + BigInt(width) * BigInt(height) * 4n;
		if (expected !== source.size) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const texbImageDescriptor: FormatDescriptor = {
	id: "gamesystem-texb-image",
	name: "'Game System' texture image format",
	extensions: ["texb"],
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
			source: "ArcFormats/GameSystem/ImageTEXB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const texbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: texbImageDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GameSystem TEXB image");
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GameSystem TEXB image");
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
					bitsPerPixel: 32,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the pixels.
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GameSystem TEXB image");
		const pixels = Buffer.from(
			await source.readAt(
				BigInt(PIXEL_OFFSET),
				layout.width * layout.height * BYTES_PER_PIXEL,
			),
		);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
