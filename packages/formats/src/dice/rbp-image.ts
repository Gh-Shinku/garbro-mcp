// Format reference: GARbro "Legacy/Dice/ImageRBP.cs", class `RbpFormat` ([000623][Marimo] Setsunai).
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

const HEADER_SIZE = 0x14;
const MARKER = "RBP1";
/** A depth word of one means twenty four bits; anything else is thirty two. */
const DEPTH_MARKER = 1;
/** The three byte pixels hold five bits a channel plus six bits of alpha. */
const COLOUR_BITS = 3;
const ALPHA_MAX = 0x3f;
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface RbpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Where the pixels begin, which the reference seeks without checking. */
	dataOffset: number;
}

async function readLayout(source: ByteSource): Promise<RbpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.toString("latin1", 0, 4) !== MARKER) return undefined;
		return {
			bitsPerPixel: header.readInt32LE(4) === DEPTH_MARKER ? 24 : 32,
			width: header.readUInt32LE(8),
			height: header.readUInt32LE(0x0c),
			dataOffset: header.readInt32LE(0x10),
		};
	} catch {
		return undefined;
	}
}

export const rbpImageDescriptor: FormatDescriptor = {
	id: "dice-rbp-image",
	name: "DiceSystem image",
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
			source: "Legacy/Dice/ImageRBP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rbpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rbpImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARKER, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Dice image");
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
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Dice image");
		const { width, height, bitsPerPixel, dataOffset } = layout;
		const stride = 4 * width;
		const total = stride * height;
		if (total > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "Dice image is too large");
		}
		if (dataOffset < 0 || BigInt(dataOffset) > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Dice image starts past its file",
			);
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels: Buffer = Buffer.alloc(total, 0x00);
		if (bitsPerPixel === 24) {
			// Three bytes for every pixel, and the reference's own reader fails at the end of the file
			// rather than leaving the rest blank.
			const needed = width * height * COLOUR_BITS;
			if (dataOffset + needed > file.length) {
				throw new GarbroError("INVALID_ARCHIVE", "Truncated Dice image");
			}
			for (let index = 0; index < width * height; index += 1) {
				const at = dataOffset + index * COLOUR_BITS;
				// The three bytes are a word with five bits a channel and six of alpha, expanded by shifts.
				const pixel =
					(file[at] ?? 0) |
					((file[at + 1] ?? 0) << 8) |
					((file[at + 2] ?? 0) << 16);
				pixels[index * 4] = (pixel << 3) & 0xff;
				pixels[index * 4 + 1] = (pixel >> 3) & 0xfc;
				pixels[index * 4 + 2] = (pixel >> 8) & 0xf8;
				// The alpha is scaled from six bits, which the reference truncates to a byte afterwards.
				pixels[index * 4 + 3] =
					(Math.trunc(((pixel >> 16) * 0xff) / ALPHA_MAX) & 0xff) >>> 0;
			}
		} else {
			// A short read leaves the rest of the pixels blank here, which is the other half of the
			// asymmetry the twenty four bit branch shows.
			const available = Math.min(total, file.length - dataOffset);
			file.copy(pixels, 0, dataOffset, dataOffset + available);
			for (let index = 3; index < total; index += 4) {
				const alpha = pixels[index] ?? 0;
				if (alpha !== 0) {
					pixels[index] = Math.trunc((alpha * 0xff) / ALPHA_MAX) & 0xff;
				}
			}
		}
		return Readable.from([writeBmp32(width, height, pixels, false)]);
	},
});
