// Format reference: GARbro "ArcFormats/Kaguya/ImageAPS.cs", class `Aps3Format` (KaGuYa tiled image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { AP_HEADER_SIZE, readApBitmap, readApFields } from "./ap-image.js";
import { unpackKaguyaLz } from "./kaguya-lz.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'\x04APS'`. */
const SIGNATURE = Buffer.from([0x04, 0x41, 0x50, 0x53]);
/** The byte after the signature says which generation of the container this is. */
const VERSION_POSITION = 4;
const VERSION = 0x33; // '3'
const COUNT_POSITION = 5;
/** Twelve bytes of tile fields the reference skips after the rectangle. */
const TILE_TRAILER = 12;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;
/** The depth is not stored: a tile set is always thirty two bit. */
const BITS_PER_PIXEL = 32;

export interface Aps3Layout {
	width: number;
	height: number;
	/** Zero means the payload is stored as it is; one means the KaGuYa LZ codec. */
	compression: number;
	packedSize: number;
	unpackedSize: number;
	dataOffset: number;
}

/** The compression header that ends every container's metadata. */
export interface ApsCompression {
	compression: number;
	packedSize: number;
	unpackedSize: number;
	dataOffset: number;
}

/**
 * `ReadCompressionMetaData`, shared by both generations of the container. The word before it says how long the
 * payload is, but nothing else uses it; what matters here is the mode, which is either zero or one, and the
 * sizes. The data offset is wherever this leaves the reader.
 */
export function readApsCompression(
	stored: Buffer,
	position: number,
): ApsCompression | undefined {
	if (position + 2 > stored.length) return undefined;
	const compression = stored.readInt16LE(position);
	position += 2;
	if (compression !== 0 && compression !== 1) return undefined;
	let packedSize = 0;
	if (compression === 1) {
		if (position + 4 > stored.length) return undefined;
		packedSize = stored.readUInt32LE(position);
		position += 4;
	}
	if (position + 4 > stored.length) return undefined;
	const unpackedSize = stored.readUInt32LE(position);
	position += 4;
	return { compression, packedSize, unpackedSize, dataOffset: position };
}

/**
 * The bounding box of everything seen, starting at the origin — so the origin is always inside it. The port
 * keeps the reference's `Rectangle.Union` arithmetic rather than a tighter reading of the tile rectangles.
 */
export function unionRectangle(
	rect: { left: number; top: number; right: number; bottom: number },
	x: number,
	y: number,
	farX: number,
	farY: number,
): void {
	rect.left = Math.min(rect.left, x);
	rect.top = Math.min(rect.top, y);
	rect.right = Math.max(rect.right, farX);
	rect.bottom = Math.max(rect.bottom, farY);
}

/**
 * The tile table plus the compression header. Each part contributes a rectangle and the ones with a name take
 * part in a **union**, which is the bounding box of everything seen so far — and since that box starts at the
 * origin, a part at (10, 10) makes the image fifteen by fifteen rather than five by five. That is the
 * reference's arithmetic and a test pins it.
 */
async function readFields(source: ByteSource): Promise<Aps3Layout | undefined> {
	if (source.size < BigInt(COUNT_POSITION + 4)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		if ((stored[VERSION_POSITION] ?? 0) !== VERSION) return undefined;
		const count = stored.readInt32LE(COUNT_POSITION);
		if (count < 0 || count > 1000) return undefined;
		let position = COUNT_POSITION + 4;
		const rect = { left: 0, top: 0, right: 0, bottom: 0 };
		for (let index = 0; index < count; index += 1) {
			if (position + 13 > stored.length) return undefined;
			position += 4; // a per part value the reference reads and discards
			const nameLength = stored[position] ?? 0;
			position += 1 + nameLength;
			if (position + 16 > stored.length) return undefined;
			const x = stored.readInt32LE(position);
			const y = stored.readInt32LE(position + 4);
			const farX = stored.readInt32LE(position + 8);
			const farY = stored.readInt32LE(position + 12);
			position += 16;
			if (nameLength > 0) {
				unionRectangle(rect, x, y, farX, farY);
			}
			position += TILE_TRAILER;
			if (position > stored.length) return undefined;
		}
		if (position + 4 > stored.length) return undefined;
		// The declared payload size is read, checked and then never used.
		const dataSize = stored.readUInt32LE(position);
		position += 4;
		if (dataSize > stored.length - position) return undefined;
		const header = readApsCompression(stored, position);
		if (!header) return undefined;
		const width = rect.right - rect.left;
		const height = rect.bottom - rect.top;
		if (width < 0 || height < 0) return undefined;
		if ((width * height * BITS_PER_PIXEL) / 8 > MAX_PIXEL_BYTES)
			return undefined;
		if (header.packedSize > stored.length - header.dataOffset) return undefined;
		if (header.unpackedSize > MAX_PIXEL_BYTES) return undefined;
		return {
			width,
			height,
			...header,
		};
	} catch {
		return undefined;
	}
}

export const aps3ImageDescriptor: FormatDescriptor = {
	id: "kaguya-aps3-image",
	name: "KaGuYa tiled image",
	extensions: ["aps", "parts", "ap3"],
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
			source: "ArcFormats/Kaguya/ImageAPS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aps3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aps3ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa APS3 image");
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
				compression: layout.compression,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa APS3 image");
		const payload = Buffer.from(
			await source.readAt(
				BigInt(layout.dataOffset),
				layout.compression === 1 ? layout.packedSize : layout.unpackedSize,
			),
		);
		const inner =
			layout.compression === 1
				? unpackKaguyaLz(payload, layout.unpackedSize)
				: payload;
		// What comes out of the tile container is an ordinary `AP` image, so the base format's reader runs on
		// it — including its bottom-up rows and its thirty two bit bitmap.
		const innerSource = new BufferByteSource(inner);
		const apLayout = await readApFields(innerSource);
		if (!apLayout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"KaGuYa APS3 payload is not an AP image",
			);
		const pixels = await readApBitmap(innerSource, apLayout, AP_HEADER_SIZE);
		return Readable.from([
			writeBmp32(apLayout.width, apLayout.height, pixels, false),
		]);
	},
});
