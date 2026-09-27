// Format reference: GARbro "Legacy/Ags32i/ImageGSS.cs", class `GssFormat` (a standalone image
// resource: an encrypted, zlib compressed bitmap; the cipher is shared with the audio opener).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { decryptAgs32 } from "./wav-audio.js";

/**
 * The signature list `{ 0x20575A52, 0x20574242, 0x20574346, 0 }` in the reference corresponds to the
 * encrypted `GSS\0` tag for the keys shipped with the supported titles.
 */
const SIGNATURES = [
	Buffer.from([0x52, 0x5a, 0x57, 0x20]),
	Buffer.from([0x42, 0x42, 0x57, 0x20]),
	Buffer.from([0x46, 0x43, 0x57, 0x20]),
	Buffer.alloc(4),
];
/** The plaintext tag, and the word the key is recovered from. */
const TAG = Buffer.from("GSS\0", "latin1");
const TAG_WORD = 0x00535347;
/** The tag and the unpacked size precede the compressed stream. */
const PREFIX_SIZE = 8;
const UNPACKED_SIZE_OFFSET = 4;
/** The bitmap header inside the compressed stream. */
const BMP_HEADER_SIZE = 0x28;
const HEADER_LENGTH_OFFSET = 0;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
const BPP_OFFSET = 0xe;

interface GssLayout {
	/** The decompressed bitmap, header included. */
	bitmap: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The count of the places of the file the head of the bitmap stands of. */
	dataOffset: number;
}

/**
 * GARbro `GssFormat.ReadMetaData`: decrypt the stream, then inflate the bitmap that follows the
 * eight byte prefix. The reference streams the inflation; the port inflates eagerly.
 */
async function readLayout(source: ByteSource): Promise<GssLayout | undefined> {
	if (source.size <= BigInt(PREFIX_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, 4));
		if (!SIGNATURES.some((allowed) => allowed.equals(stored))) return undefined;
		const key = (stored.readUInt32LE(0) ^ TAG_WORD) >>> 0;
		const raw = Buffer.from(await source.readAt(0n, Number(source.size)));
		const plain = decryptAgs32(raw, key);
		if (!plain.subarray(0, 4).equals(TAG)) return undefined;
		const unpackedSize = plain.readInt32LE(UNPACKED_SIZE_OFFSET);
		if (unpackedSize <= 0) return undefined;
		const bitmap = await inflateZlibBuffer(plain.subarray(PREFIX_SIZE));
		if (bitmap.length < BMP_HEADER_SIZE) return undefined;
		const headerLength = bitmap.readInt32LE(HEADER_LENGTH_OFFSET);
		if (headerLength <= 0 || headerLength >= unpackedSize) return undefined;
		return {
			bitmap,
			width: bitmap.readUInt32LE(WIDTH_OFFSET) >>> 0,
			height: bitmap.readUInt32LE(HEIGHT_OFFSET) >>> 0,
			bitsPerPixel: bitmap.readInt16LE(BPP_OFFSET),
			dataOffset: headerLength,
		};
	} catch {
		return undefined;
	}
}

export const gssImageDescriptor: FormatDescriptor = {
	id: "ags32i-gss-image",
	name: "AGS32i engine encrypted bitmap",
	extensions: [],
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
			source: "Legacy/Ags32i/ImageGSS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gssImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gssImageDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid AGS32i encrypted bitmap",
			);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The payload is decrypted and inflated, so its length differs from the source.
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
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid AGS32i encrypted bitmap",
			);
		// `GssFormat.Read`: the places of the picture stand behind the head of the bitmap the stream holds, of
		// three or four places of a colour to a pixel, and the rows of the file stand bottom up, since the
		// reference stands of `ImageData.CreateFlipped`.
		const places =
			32 === layout.bitsPerPixel ? 4 : 24 === layout.bitsPerPixel ? 3 : 0;
		if (0 === places) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`The picture stands of ${layout.bitsPerPixel} places of a colour`,
			);
		}
		const count = layout.width * layout.height * places;
		const stored = layout.bitmap.subarray(
			layout.dataOffset,
			layout.dataOffset + count,
		);
		if (stored.length < count) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`The picture stands of too few places of the file: ${stored.length} against ${count}`,
			);
		}
		const rows = Buffer.alloc(count);
		const stride = layout.width * places;
		for (let row = 0; row < layout.height; row += 1) {
			stored.copy(
				rows,
				row * stride,
				(layout.height - 1 - row) * stride,
				(layout.height - row) * stride,
			);
		}
		if (4 === places) {
			return Readable.from([writeBmp32(layout.width, layout.height, rows)]);
		}
		return Readable.from([writeBmp24(layout.width, layout.height, rows)]);
	},
});
