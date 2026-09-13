// Format reference: GARbro "ArcFormats/Kaguya/ImageAPS.cs", class `ApsFormat : Aps3Format` (the older tiled
// container).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	type ApsLayout,
	readApsCompression,
	readApsPayload,
	unionRectangle,
} from "./aps3-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The name and tile counts are sixteen bit words with a ceiling of a thousand parts. */
const MAX_PARTS = 1000;
/** A name is a thirty two bit length, then that many bytes; the reference caps it at 260. */
const MAX_NAME_LENGTH = 260;
/** Bytes following each tile's name: twelve the reference skips plus the four the rectangle needs. */
const TILE_NAME_TRAILER = 0x0c;
const TILE_TRAILER = 0x28;
const BITS_PER_PIXEL = 32;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;
/** Enough for a count and nothing else. */
const MINIMUM_SIZE = 2;

/**
 * The older container has **no signature at all**: what identifies it is the shape of two tables, and the
 * reference is strict about that shape — both counts have to be between one and a thousand, and every name has
 * to be between one and two hundred and sixty bytes long. That strictness is what the port relies on instead of
 * a marker, so the probe is the parse.
 *
 * Unlike the newer container there is no payload size word here; the compression header follows the tile table
 * directly.
 */
async function readFields(source: ByteSource): Promise<ApsLayout | undefined> {
	if (source.size < BigInt(MINIMUM_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		let position = 0;
		const readCount = (): number | undefined => {
			if (position + 2 > stored.length) return undefined;
			const count = stored.readInt16LE(position);
			position += 2;
			return count;
		};
		/** A thirty two bit length, a bound check, and the name itself skipped over. */
		const skipName = (): boolean => {
			if (position + 4 > stored.length) return false;
			const nameLength = stored.readInt32LE(position);
			position += 4;
			if (nameLength <= 0 || nameLength > MAX_NAME_LENGTH) return false;
			if (position + nameLength > stored.length) return false;
			position += nameLength;
			return true;
		};
		const nameCount = readCount();
		if (nameCount === undefined || nameCount <= 0 || nameCount > MAX_PARTS)
			return undefined;
		for (let index = 0; index < nameCount; index += 1) {
			if (!skipName()) return undefined;
		}
		const tileCount = readCount();
		if (tileCount === undefined || tileCount <= 0 || tileCount > MAX_PARTS)
			return undefined;
		const rect = { left: 0, top: 0, right: 0, bottom: 0 };
		for (let index = 0; index < tileCount; index += 1) {
			if (position + 4 > stored.length) return undefined;
			const nameLength = stored.readInt32LE(position);
			position += 4;
			if (nameLength <= 0 || nameLength > MAX_NAME_LENGTH) return undefined;
			position += nameLength + TILE_NAME_TRAILER;
			if (position + 16 + TILE_TRAILER > stored.length) return undefined;
			const x = stored.readInt32LE(position);
			const y = stored.readInt32LE(position + 4);
			const farX = stored.readInt32LE(position + 8);
			const farY = stored.readInt32LE(position + 12);
			position += 16;
			// Every tile counts here, because the reference has already refused a zero length name.
			unionRectangle(rect, x, y, farX, farY);
			position += TILE_TRAILER;
		}
		const header = readApsCompression(stored, position);
		if (!header) return undefined;
		const width = rect.right - rect.left;
		const height = rect.bottom - rect.top;
		if (width < 0 || height < 0) return undefined;
		if ((width * height * BITS_PER_PIXEL) / 8 > MAX_PIXEL_BYTES)
			return undefined;
		if (header.packedSize > stored.length - header.dataOffset) return undefined;
		if (header.unpackedSize > MAX_PIXEL_BYTES) return undefined;
		return { width, height, ...header };
	} catch {
		return undefined;
	}
}

export const apsImageDescriptor: FormatDescriptor = {
	id: "kaguya-aps-image",
	name: "KaGuYa tiled image",
	extensions: ["aps", "parts"],
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

export const apsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: apsImageDescriptor,
	// No signature: the shape of the two tables is what identifies the format.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa APS image");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa APS image");
		return Readable.from([await readApsPayload(source, layout)]);
	},
});
