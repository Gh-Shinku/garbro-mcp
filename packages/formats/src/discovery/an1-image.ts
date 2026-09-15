// Format reference: GARbro "Legacy/Discovery/ImageAN1.cs", classes `An1Format` and `AnReader` (Discovery
// animation resource). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";
import {
	flattenPrPlanes,
	PIXEL_OFFSET,
	readPrLayout,
	readPrPalette,
	unpackPrPlanes,
} from "./pr1-image.js";

/** The width of one frame, and the number of bytes its row takes once the planes are woven. */
const FRAME_WIDTH = 0x20;
const FRAME_HEIGHT_UNIT = 0x20;
const FRAME_STRIDE = FRAME_WIDTH >> 1;
/** Groups of eight pixels to a byte, so a row of a frame is four plane bytes long. */
const FRAME_PLANE_STRIDE_GROUPS = FRAME_STRIDE >> 2;
/** What stands in front of the frames in the planes: six bytes and twenty two to a frame. */
const TABLE_HEADER = 6;
const TABLE_ENTRY = 0x16;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** The frames the picture holds, read out of the first plane the way the reference reads it. */
function readFrameCount(planes: Uint8Array[]): number {
	const plane = planes[0];
	if (!plane || plane.length < 4) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Discovery animation has no frame table",
		);
	}
	return (plane[2] ?? 0) | ((plane[3] ?? 0) << 8);
}

/**
 * The header of an animation resource: the header the two pictures share, but only for the extension of this
 * one, which is what the reference's own metadata reader asks for.
 */
async function readAn1Layout(source: ByteSource, sourcePath: string) {
	if ("an1" !== sourceExtension(sourcePath)) return undefined;
	return readPrLayout(source, sourcePath);
}

/** The whole animation as one picture of frames stacked from the top down. */
async function renderAn1Image(
	source: ByteSource,
	sourcePath: string,
): Promise<Buffer> {
	const layout = await readAn1Layout(source, sourcePath);
	if (!layout) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Discovery AN1 image");
	}
	const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
	if (stored.length < PIXEL_OFFSET) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Truncated Discovery image palette",
		);
	}
	const palette = readPrPalette(stored);
	// The planes are read with the measurements of the header, and only then do the frames say how big the
	// picture is.
	const planes = unpackPrPlanes(stored, layout);
	const frameCount = readFrameCount(planes);
	const frameHeight = frameCount * FRAME_HEIGHT_UNIT;
	if (0 === frameHeight) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`Unsupported Discovery animation of ${frameCount} frames`,
		);
	}
	const total = FRAME_STRIDE * frameHeight;
	if (!Number.isSafeInteger(total) || total > MAX_IMAGE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Discovery animation of ${frameCount} frames is too large`,
		);
	}
	const output: Buffer = Buffer.alloc(total, 0x00);
	// The reference flattens the planes from behind the frame table to the end of the picture it computed,
	// which is the frames themselves.
	flattenPrPlanes(
		planes,
		FRAME_PLANE_STRIDE_GROUPS * frameHeight,
		frameCount * TABLE_ENTRY + TABLE_HEADER,
		output,
	);
	return writeBmp4(FRAME_WIDTH, frameHeight, output, palette);
}

export const discoveryAn1ImageDescriptor: FormatDescriptor = {
	id: "discovery-an1-image",
	name: "Discovery animation resource",
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
			source: "Legacy/Discovery/ImageAN1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const discoveryAn1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: discoveryAn1ImageDescriptor,
	// The export of this format is commented out in the reference, so its catalogue never offers it: its
	// reader is never reached by extension or signature, only by asking for this format itself.
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readAn1Layout(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readAn1Layout(source, sourcePath);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Discovery AN1 image");
		}
		// The reference's metadata reader wants the extension of this format and nothing else.
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
					bitsPerPixel: 4,
					colors: 16,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					flags: layout.flags,
					mask: layout.mask,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "discovery-rle",
				// The picture itself is a strip of frames; this is what the stored header says.
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 4,
				colors: 16,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		return Readable.from([await renderAn1Image(source, sourcePath)]);
	},
});
