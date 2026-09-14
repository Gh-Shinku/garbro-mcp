// Format reference: GARbro "Legacy/Kurumi/ImageGRA.cs", class `GraFormat` (the encrypted image, not the
// "GRA/VS" format of the same name under ArcFormats/Kurumi).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The word the reference finds its files by is the encryption of the word its reader expects to find behind the
 * cipher, so the two checks are the same check made in two places: the file's own bytes first, and then the
 * plaintext behind them.
 */
const SIGNATURE = Buffer.from([0x97, 0xa3, 0x2f, 0xee]);
const HEADER_SIZE = 0x14;
const FIRST_WORD = 0x10;
const OFFSET_X_FIELD = 0xc;
const OFFSET_Y_FIELD = 0xe;
const WIDTH_FIELD = 0x10;
const HEIGHT_FIELD = 0x12;
const BITS_PER_PIXEL = 16;
const BYTES_PER_PIXEL = 2;
const SEED = 34567;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

/**
 * The reference's cipher: a linear congruential sequence whose second byte is taken off as the keystream and
 * subtracted from the file, which walks it back to its plaintext. The multiplication is an unchecked thirty-two
 * bit one, so the sequence wraps around and the whole of its long trail depends on that.
 */
function decrypt(data: Buffer): Buffer {
	const output: Buffer = Buffer.alloc(data.length);
	let seed = SEED;
	for (let i = 0; i < data.length; i += 1) {
		const byte = ((data[i] ?? 0) - ((seed >> 8) & 0xff)) & 0xff;
		output[i] = byte;
		seed = (Math.imul(seed, 5) - 1) | 0;
	}
	return output;
}

interface GraLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

/** The header the reference reads: its word behind the cipher, the measurements and where the picture belongs. */
async function readLayout(source: ByteSource): Promise<GraLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const raw = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (raw.length < HEADER_SIZE) return undefined;
		if (!raw.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const header = decrypt(raw);
		if (header.readInt32LE(0) !== FIRST_WORD) return undefined;
		const width = header.readUInt16LE(WIDTH_FIELD);
		const height = header.readUInt16LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height * BYTES_PER_PIXEL > MAX_IMAGE_BYTES) return undefined;
		return {
			width,
			height,
			offsetX: header.readInt16LE(OFFSET_X_FIELD),
			offsetY: header.readInt16LE(OFFSET_Y_FIELD),
		};
	} catch {
		return undefined;
	}
}

/**
 * The reference's reader: every two bytes behind the cipher carry a picture pixel of fifteen bits, whose halves
 * are woven into them in a way that leaves a gap between the lowest two bits and the rest. The port keeps the
 * weaving as it stands.
 *
 * A stream that ends in the middle of a pixel stops with an error, which is what the reference's own reads do —
 * it walks a counter over the pixels and takes every byte out of the file.
 */
function unpackPixels(data: Buffer, count: number): Buffer {
	const pixels: Buffer = Buffer.alloc(count * BYTES_PER_PIXEL, 0x00);
	let src = HEADER_SIZE;
	let dst = 0;
	while (dst < pixels.length) {
		if (src + 2 > data.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Kurumi image");
		}
		const p0 = data[src] ?? 0;
		const p1 = data[src + 1] ?? 0;
		src += 2;
		pixels[dst] = (((p1 >> 2) & 0x1f) | (p0 & 0xe0)) & 0xff;
		pixels[dst + 1] = (((p0 & 0x1f) << 2) | (p1 & 3)) & 0xff;
		dst += 2;
	}
	return pixels;
}

export const kurumiGraLegacyImageDescriptor: FormatDescriptor = {
	id: "kurumi-gra-legacy-image",
	name: "Kurumi encrypted image",
	extensions: ["gra"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/Kurumi/ImageGRA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kurumiGraLegacyImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kurumiGraLegacyImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kurumi image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				} as Record<string, unknown>,
			}),
			// The image is built out of the file rather than being a part of it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				encryption: "kurumi",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kurumi image");
		const raw = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = unpackPixels(decrypt(raw), layout.width * layout.height);
		// `ImageData.Create` stores the rows top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp16(layout.width, layout.height, pixels, false),
		]);
	},
});
