// Format reference: GARbro "ArcFormats/GameSystem/ImageALP.cs", class `AlpFormat` (tag `ALP/GAMESYSTEM`,
// an eight byte header and one byte per pixel, stored bottom up). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
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
const BYTES_PER_PIXEL = 1;

interface AlpLayout {
	width: number;
	height: number;
	dataOffset: number;
	dataSize: number;
}

/** The reference gates on the `.alp` extension first, so the check needs the source path. */
function isAlpName(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "alp";
}

/**
 * `AlpFormat.ReadMetaData`: eight bytes of dimensions, then exactly one byte per pixel. The relation is
 * computed with BigInt so a hostile header cannot overflow it.
 */
async function readLayout(source: ByteSource): Promise<AlpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		const dataSize = BigInt(width) * BigInt(height) * BigInt(BYTES_PER_PIXEL);
		if (source.size !== dataSize + BigInt(HEADER_SIZE)) return undefined;
		return {
			width,
			height,
			dataOffset: HEADER_SIZE,
			dataSize: Number(dataSize),
		};
	} catch {
		return undefined;
	}
}

export const gamesystemAlpImageDescriptor: FormatDescriptor = {
	id: "gamesystem-alp-image",
	name: "'Game System' grayscale image format",
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
			source: "ArcFormats/GameSystem/ImageALP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gamesystemAlpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gamesystemAlpImageDescriptor,
	// No signature: the name and the length relation are the whole detection.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!isAlpName(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = isAlpName(sourcePath) ? await readLayout(source) : undefined;
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Game System ALP image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.dataSize),
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// A bitmap header and palette are prepended, so the payload is longer than the stored pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Game System ALP image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		// `ImageData.CreateFlipped` stores the rows bottom up, so the bitmap height stays positive.
		return Readable.from([
			writeBmp8(layout.width, layout.height, pixels, true),
		]);
	},
});
