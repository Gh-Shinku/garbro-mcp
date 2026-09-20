// Format reference: GARbro "ArcFormats/Cri/ImageSPC.cs", class `SpcFormat` over `XtxFormat` (a texture of the
// CRI MiddleWare kind that stands behind a walk of places of its own: the places of the file name how many
// places the texture holds, and the texture itself stands behind them, walked). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
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
import { MAXIMUM_HEADER_SIZE, readXtxLayout, unpackXtx } from "./xtx-image.js";

/** The places of the head name how many places the texture holds; the walk of the texture stands behind them.
 * The reference takes the same four places as the word it registers, so a file of this kind is told by its
 * head alone. */
const SIZE_FIELD = 0;
const WALK_OFFSET = 4;
/** A texture of fewer than this many places, or of more of them than this, stands as no texture at all. */
const MINIMUM_UNPACKED_SIZE = 0x20;
const MAXIMUM_UNPACKED_SIZE = 0x5000000;
/** How many places of the walked part are read to tell whether the places behind them stand as a texture: the
 * walk hands out at least one place of a colour for every nine places of the file, so this many places of the
 * file always stand as more places of the texture than the largest head of a texture may stand behind. */
const DETECT_INPUT_LIMIT = 0x10000;
/** The head of a texture may stand behind a size of its own, so this many places of the walked part are read
 * to tell whether a texture stands behind them. */
const HEAD_LIMIT = MAXIMUM_HEADER_SIZE + 0x20;

function invalidTexture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** How many places the texture holds, as the head of the file names them. */
export function readSpcSize(
	data: Buffer,
	fileLength = data.length,
): number | undefined {
	if (data.length < WALK_OFFSET) return undefined;
	if (fileLength < WALK_OFFSET) return undefined;
	const size = data.readUInt32LE(SIZE_FIELD);
	if (size <= MINIMUM_UNPACKED_SIZE || size > MAXIMUM_UNPACKED_SIZE) {
		return undefined;
	}
	return size;
}

/** The places of the texture: the walk of the file, which the reference walks as a walk of its own where the
 * places of its frame stand as nothing and its own first place stands at `0xFEE`. */
export function unpackSpc(stored: Buffer, unpackedSize: number): Buffer {
	return inflateLzss(stored.subarray(WALK_OFFSET), {
		outputLength: unpackedSize,
	});
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const criSpcImageDescriptor: FormatDescriptor = {
	id: "cri-spc-image",
	name: "CRI MiddleWare compressed texture format",
	extensions: ["spc"],
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
			source: "ArcFormats/Cri/ImageSPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const criSpcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: criSpcImageDescriptor,
	// The reference registers the word of no places at all, which every file stands under, so a texture of
	// this kind is tried after every kind of file that is told by a word of its own.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size <= BigInt(WALK_OFFSET)) return false;
		try {
			const size = readSpcSize(
				Buffer.from(await source.readAt(0n, WALK_OFFSET)),
				Number(source.size),
			);
			if (size === undefined) return false;
			const wanted = Number(
				source.size - BigInt(WALK_OFFSET) < BigInt(DETECT_INPUT_LIMIT)
					? source.size - BigInt(WALK_OFFSET)
					: BigInt(DETECT_INPUT_LIMIT),
			);
			const walked = unpackSpc(
				Buffer.from(await source.readAt(0n, WALK_OFFSET + wanted)),
				Math.min(size, HEAD_LIMIT),
			);
			return readXtxLayout(walked, size) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const size = readSpcSize(stored, Number(source.size));
		if (size === undefined) {
			throw invalidTexture("Not a CRI compressed texture");
		}
		const layout = readXtxLayout(unpackSpc(stored, size), size);
		if (!layout) throw invalidTexture("Not a CRI compressed texture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(WALK_OFFSET),
				size: source.size - BigInt(WALK_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					alignedWidth: layout.alignedWidth,
					alignedHeight: layout.alignedHeight,
					kind: layout.kind,
					unpackedSize: size,
				},
			}),
			// The places of the texture stand walked and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: 0 === layout.kind ? "none" : "dxt5",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				unpackedSize: size,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const size = readSpcSize(stored, Number(source.size));
		if (size === undefined) {
			throw invalidTexture("Not a CRI compressed texture");
		}
		const layout = readXtxLayout(unpackSpc(stored, size), size);
		if (!layout) throw invalidTexture("Not a CRI compressed texture");
		const pixels = unpackXtx(unpackSpc(stored, size), layout);
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
