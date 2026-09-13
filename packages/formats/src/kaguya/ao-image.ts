// Format reference: GARbro "ArcFormats/Kaguya/ImageAO.cs", class `AoFormat : ApFormat` (KaGuYa image with an
// origin).
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
import { type ApLayout, readApBitmap, readApFields } from "./ap-image.js";

/** `AO` rather than the base class's `AP`. */
const MARKER = Buffer.from([0x41, 0x4f]);
/** The base header plus two signed origin fields. */
const HEADER_SIZE = 0x14;
const OFFSET_X_POSITION = 0x0c;
const OFFSET_Y_POSITION = 0x10;

/**
 * Everything the base format checks, and then the two fields it adds. The origin is signed and may be
 * negative, which is why the story that produced the image can place it anywhere; the port carries it into
 * the metadata rather than into the pixels, since a bitmap has nowhere to put it.
 */
async function readAoFields(source: ByteSource): Promise<ApLayout | undefined> {
	const layout = await readApFields(source, MARKER, HEADER_SIZE);
	if (!layout) return undefined;
	try {
		const origin = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return {
			...layout,
			offsetX: origin.readInt32LE(OFFSET_X_POSITION),
			offsetY: origin.readInt32LE(OFFSET_Y_POSITION),
		};
	} catch {
		return undefined;
	}
}

export const aoImageDescriptor: FormatDescriptor = {
	id: "kaguya-ao-image",
	name: "KaGuYa script engine image with an origin",
	extensions: ["sp_"],
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
			source: "ArcFormats/Kaguya/ImageAO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aoImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aoImageDescriptor,
	// No signature: the marker is checked by the probe itself, and it is what separates this format from the
	// base class's files.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAoFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readAoFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AO image");
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
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
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
				bitsPerPixel: layout.bitsPerPixel,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readAoFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AO image");
		const pixels = await readApBitmap(source, layout, HEADER_SIZE);
		// `ImageData.Create` is top down, which a bitmap records as a negative height.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
