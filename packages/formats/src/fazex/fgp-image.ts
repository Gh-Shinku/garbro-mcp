// Format reference: GARbro "Legacy/FazeX/ImageFGP.cs", class `FgpFormat` ([011130][Malt] Emblem).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature field is only the first four bytes, but the reader checks the whole string. */
const MARKER = "FAZEX_GRAPHIC_FILE";
/** The marker is eighteen bytes: the four byte signature field is only its first half. */
const MARKER_SIZE = MARKER.length;
const HEADER_SIZE = 0x1b;
/** The dimensions are read at unaligned offsets, in the middle of the header's tail. */
const WIDTH_POSITION = 0x13;
const HEIGHT_POSITION = 0x17;
/** Four planar channels, the last of which is stored inverted. */
const PLANE_COUNT = 4;
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface FgpLayout {
	width: number;
	height: number;
}

async function readLayout(source: ByteSource): Promise<FgpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.toString("latin1", 0, MARKER_SIZE) !== MARKER) {
			return undefined;
		}
		return {
			width: header.readUInt32LE(WIDTH_POSITION),
			height: header.readUInt32LE(HEIGHT_POSITION),
		};
	} catch {
		return undefined;
	}
}

export const fgpImageDescriptor: FormatDescriptor = {
	id: "fazex-fgp-image",
	name: "FazeX ADV System image",
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
			source: "Legacy/FazeX/ImageFGP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fgpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fgpImageDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from(MARKER, "latin1") }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FazeX image");
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
					bitsPerPixel: 32,
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
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FazeX image");
		const planeSize = layout.width * layout.height;
		const total = planeSize * PLANE_COUNT;
		if (total > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "FazeX image is too large");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const planes: Buffer = Buffer.alloc(total, 0x00);
		if (total > 0) {
			// One stream holds all four channels one after another, and a stream that stops early leaves the
			// rest of the channels zeroed rather than failing.
			const decoded = inflateLzss(stored.subarray(HEADER_SIZE), {
				outputLength: total,
			});
			decoded.copy(planes, 0, 0, Math.min(decoded.length, total));
		}
		const pixels: Buffer = Buffer.alloc(total, 0x00);
		for (let plane = 0; plane < PLANE_COUNT; plane += 1) {
			const source_base = plane * planeSize;
			const inverted = plane === 3;
			for (let index = 0; index < planeSize; index += 1) {
				const value = planes[source_base + index] ?? 0;
				pixels[index * PLANE_COUNT + plane] = inverted ? 0xff - value : value;
			}
		}
		return Readable.from([
			// The reference hands the pixels over as flipped, so the bitmap carries a positive height.
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
