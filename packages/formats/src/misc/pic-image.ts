// Format reference: GARbro "ArcFormats/ImagePIC.cs", class `PicFormat` (a bitmap whose ten byte file header was
// replaced by a three byte tag and seven bytes of engine data). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `PIC` and a null: the reference's word `0x00434950`. */
const SIGNATURE = Buffer.from("PIC\0", "latin1");
const BMP_TAG = Buffer.from("BM", "ascii");
/** Everything the reference replaces: the bitmap file header, fourteen bytes of it, minus its first ten. */
const HEADER_SIZE = 10;

/**
 * `OpenAsBitmap` builds ten bytes — `BM`, the length of the **whole source file** and four zeros — and puts the
 * source from offset ten behind them. The result is a coherent bitmap: the four zeros are the reserved field,
 * the source's own bytes ten to thirteen are `bfOffBits`, and the information header follows at fourteen. The
 * length it writes is exactly the length of the stream it built, so the shared reader's sanity check passes.
 */
function synthesize(stored: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	BMP_TAG.copy(header, 0);
	header.writeUInt32LE(stored.length, 2);
	return Buffer.concat([header, stored.subarray(HEADER_SIZE)]);
}

interface PicLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/** The reference parses and later decodes the synthesized bitmap, so detection is that bitmap being readable. */
async function readLayout(source: ByteSource): Promise<PicLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The port re-checks the tag itself rather than trusting the registry gate: the synthesized bitmap
		// overwrites the bytes it lives in, so without this check any bitmap sized file would be accepted.
		if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const bmp = readBmpMetaData(synthesize(stored));
		if (!bmp) return undefined;
		return {
			width: bmp.width,
			height: bmp.height,
			bitsPerPixel: bmp.bitsPerPixel,
		};
	} catch {
		return undefined;
	}
}

export const picImageDescriptor: FormatDescriptor = {
	id: "misc-pic-image",
	name: "Soft House Sprite bitmap",
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
			source: "ArcFormats/ImagePIC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const picImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: picImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Soft House PIC image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// Ten stored bytes become a ten byte bitmap header, so the extraction has the stored length.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				prefixSize: HEADER_SIZE,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if ((await readLayout(source)) === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Soft House PIC image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The bitmap the reference hands to its reader, with the stored header, palette and pixels untouched.
		return Readable.from([synthesize(stored)]);
	},
});
