// Format reference: GARbro "ArcFormats/Interheart/ImageKG.cs", class `KgFormat` (Interheart image format).
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

/** `GCGK`, the reference's word 0x4B474347. */
const MARKER: Buffer = Buffer.from("GCGK", "latin1");
const HEADER_SIZE = 12;
/** The table of row offsets follows the header, one word a row. */
const TABLE_OFFSET = HEADER_SIZE;
/** Four bytes a pixel, which is the only depth the reference knows. */
const BITS_PER_PIXEL = 32;
const PIXEL_SIZE = 4;
/** A run token's second byte counts pixels, and zero stands for this many. */
const FULL_RUN = 0x100;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface KgLayout {
	width: number;
	height: number;
	packedSize: number;
}

/** `ReadMetaData` wants a positive packed size; the port also refuses dimensions it cannot hold. */
function readLayout(header: Buffer): KgLayout | undefined {
	if (header.length < HEADER_SIZE) return undefined;
	if (!header.subarray(0, 4).equals(MARKER)) return undefined;
	const width = header.readUInt16LE(4);
	const height = header.readUInt16LE(6);
	const packedSize = header.readInt32LE(8);
	if (packedSize <= 0) return undefined;
	if (width === 0 || height === 0) return undefined;
	if (width * height * PIXEL_SIZE > MAX_IMAGE_BYTES) return undefined;
	return { width, height, packedSize };
}

export const interheartKgImageDescriptor: FormatDescriptor = {
	id: "interheart-kg-image",
	name: "Interheart image",
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
			source: "ArcFormats/Interheart/ImageKG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const interheartKgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: interheartKgImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readLayout(header) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (source.size < BigInt(HEADER_SIZE)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Interheart image");
		}
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const layout = readLayout(header);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Interheart image");
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
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "kg-alpha-runs",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readLayout(file);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Interheart image");
		const { width, height } = layout;
		const tableEnd = TABLE_OFFSET + height * 4;
		if (tableEnd > file.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Interheart image is truncated");
		}
		const pixels: Buffer = Buffer.alloc(width * height * PIXEL_SIZE, 0x00);
		let written = 0;
		for (let row = 0; row < height; row += 1) {
			const offset = file.readUInt32LE(TABLE_OFFSET + row * 4);
			let position = tableEnd + offset;
			if (position >= file.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Interheart row is out of bounds",
				);
			}
			for (let x = 0; x < width; ) {
				if (position + 2 > file.length) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Interheart run is truncated",
					);
				}
				const alpha = file[position] ?? 0;
				let count = file[position + 1] ?? 0;
				position += 2;
				if (count === 0) count = FULL_RUN;
				if (x + count > width) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Interheart run overruns its row",
					);
				}
				if (alpha === 0) {
					// A transparent run is written by skipping the pixels, which stay zero, alpha included.
					written += count * PIXEL_SIZE;
				} else {
					if (position + count * 3 > file.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Interheart run is truncated",
						);
					}
					for (let n = 0; n < count; n += 1) {
						// The stream holds red, green and blue in that order and the bitmap wants BGRA.
						const red = file[position] ?? 0;
						const green = file[position + 1] ?? 0;
						const blue = file[position + 2] ?? 0;
						position += 3;
						pixels[written] = blue;
						pixels[written + 1] = green;
						pixels[written + 2] = red;
						pixels[written + 3] = alpha;
						written += PIXEL_SIZE;
					}
				}
				x += count;
			}
			if (written > pixels.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Interheart image overruns its buffer",
				);
			}
		}
		// The reference builds the image without a stride and never flips it, so the bitmap is top down.
		return Readable.from([writeBmp32(width, height, pixels, false)]);
	},
});
