// Format reference: GARbro "ArcFormats/FC01/ImageTIL.cs", class `TilFormat` (AGSI tiled image format).
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

/** `TIL0`, the reference's word 0x304C4954. */
const MARKER: Buffer = Buffer.from("TIL0", "latin1");
const HEADER_SIZE = 0x14;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
const TILE_WIDTH_FIELD = 0xc;
const TILE_HEIGHT_FIELD = 0x10;
/** Every tile pixel is four bytes, which is the only depth the reference knows. */
const DEPTH = 32;
const PIXEL_SIZE = 4;
/** The first record starts right behind the header. */
const DATA_OFFSET = HEADER_SIZE;
/** A record is a length, a flag and, when the flag is set, an offset, a length and the bytes. */
const RECORD_PREFIX_SIZE = 8;
const PATCH_HEADER_SIZE = 16;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface TilLayout {
	width: number;
	height: number;
	tileWidth: number;
	tileHeight: number;
}

async function readLayout(source: ByteSource): Promise<TilLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		const width = header.readUInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		const tileWidth = header.readInt32LE(TILE_WIDTH_FIELD);
		const tileHeight = header.readInt32LE(TILE_HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		// The reference divides by both without looking at them, so a zero tile size has to be refused here.
		if (tileWidth <= 0 || tileHeight <= 0) return undefined;
		if (width * height * PIXEL_SIZE > MAX_IMAGE_BYTES) return undefined;
		return { width, height, tileWidth, tileHeight };
	} catch {
		return undefined;
	}
}

export const fc01TilImageDescriptor: FormatDescriptor = {
	id: "fc01-til-image",
	name: "AGSI tiled image",
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
			source: "ArcFormats/FC01/ImageTIL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fc01TilImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fc01TilImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AGSI tiled image");
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
					bitsPerPixel: DEPTH,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "tile-records",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: DEPTH,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AGSI tiled image");
		const { width, height, tileWidth, tileHeight } = layout;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The reference divides both dimensions by the tile size and truncates, so a remainder is left blank.
		const tileCountX = Math.trunc(width / tileWidth);
		const tileCountY = Math.trunc(height / tileHeight);
		const stride = width * PIXEL_SIZE;
		const pixels: Buffer = Buffer.alloc(stride * height, 0x00);
		let position = DATA_OFFSET;
		let tileY = 0;
		const tileStride = stride * tileHeight;
		for (let tileRow = 0; tileRow < tileCountY; tileRow += 1) {
			let tileX = tileY;
			for (let tileColumn = 0; tileColumn < tileCountX; tileColumn += 1) {
				let rowStart = tileX;
				for (let row = 0; row < tileHeight; row += 1) {
					if (position + RECORD_PREFIX_SIZE > file.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"AGSI tile record is truncated",
						);
					}
					const recordStart = position;
					// The record's length is the distance to the one behind it, which is where the reference
					// leaves its own stream position.
					position = recordStart + file.readUInt32LE(recordStart);
					if (file.readInt32LE(recordStart + 4) !== 0) {
						if (recordStart + PATCH_HEADER_SIZE > file.length) {
							throw new GarbroError(
								"INVALID_ARCHIVE",
								"AGSI tile record is truncated",
							);
						}
						const offset = file.readInt32LE(recordStart + 8) * PIXEL_SIZE;
						const length = file.readInt32LE(recordStart + 12) * PIXEL_SIZE;
						const from = recordStart + PATCH_HEADER_SIZE;
						if (
							offset < 0 ||
							length < 0 ||
							rowStart + offset + length > pixels.length
						) {
							throw new GarbroError(
								"INVALID_ARCHIVE",
								"AGSI tile patch leaves the image",
							);
						}
						// The reference reads into the buffer and keeps whatever it gets, so a short file
						// patches only as far as its bytes reach.
						const available = Math.min(length, Math.max(0, file.length - from));
						if (available > 0) {
							file.copy(pixels, rowStart + offset, from, from + available);
						}
					}
					rowStart += stride;
				}
				tileX += PIXEL_SIZE * tileWidth;
			}
			tileY += tileStride;
		}
		// `ImageData.Create` with the depth's stride and no flip: the bitmap is top down and its rows tight.
		return Readable.from([writeBmp32(width, height, pixels, false)]);
	},
});
