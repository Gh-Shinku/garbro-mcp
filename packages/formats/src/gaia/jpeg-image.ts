// Format reference: GARbro "Legacy/Gaia/ImageJPG.cs", class `HiddenJpegFormat` (a JPEG image stored at a
// fixed offset behind a three byte marker). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference checks `Signature & 0xFFFFFF`, which is the first three bytes, read big endian. */
const MARKER = Buffer.from([0xff, 0xfd, 0x00]);
/** Where the embedded JPEG begins. */
const JPEG_OFFSET = 100;

/**
 * The equivalent of `Jpeg.ReadMetaData`: the marker walk of `packages/formats/src/shared/jpeg.ts`, which
 * follows the reference's own walk — a start of image marker, then a length for every marker, and the first
 * marker of the frame row apart from the Huffman table marker carrying the measurements.
 *
 * An earlier reading of this port walked the markers itself and took every marker whose high nibble is
 * `0xd` for a marker without a payload, which reads the quantisation table marker as one and loses the walk;
 * a stream of any real encoder carries such a table, so the reader here is shared with the other formats.
 */
function readJpegSize(
	buffer: Buffer,
	offset: number,
): { width: number; height: number } | undefined {
	const fields = readJpegHeaderFields(buffer.subarray(offset));
	if (!fields) return undefined;
	return { width: fields.width, height: fields.height };
}

async function readLayout(
	source: ByteSource,
): Promise<{ width: number; height: number } | undefined> {
	if (source.size <= BigInt(JPEG_OFFSET)) return undefined;
	try {
		// The reference reads the marker through the signature and the dimensions through a JPEG parser.
		const head = Buffer.from(await source.readAt(0n, MARKER.length));
		if (!head.equals(MARKER)) return undefined;
		const jpeg = Buffer.from(
			await source.readAt(
				BigInt(JPEG_OFFSET),
				Number(source.size) - JPEG_OFFSET,
			),
		);
		const size = readJpegSize(jpeg, 0);
		if (!size) return undefined;
		if (size.width === 0 || size.height === 0) return undefined;
		return size;
	} catch {
		return undefined;
	}
}

export const hiddenJpegImageDescriptor: FormatDescriptor = {
	id: "gaia-hidden-jpeg-image",
	name: "Gaia obfuscated JPEG image",
	extensions: ["jpg", "jpeg"],
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
			source: "Legacy/Gaia/ImageJPG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const hiddenJpegImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hiddenJpegImageDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const size = await readLayout(source);
		if (!size)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Gaia hidden JPEG image",
			);
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: BigInt(JPEG_OFFSET),
				size: source.size - BigInt(JPEG_OFFSET),
				metadata: {
					type: "image",
					width: size.width,
					height: size.height,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: size.width,
				height: size.height,
				prefixSize: JPEG_OFFSET,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if ((await readLayout(source)) === undefined)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Gaia hidden JPEG image",
			);
		const jpeg = Buffer.from(
			await source.readAt(
				BigInt(JPEG_OFFSET),
				Number(source.size) - JPEG_OFFSET,
			),
		);
		// The reference reads the picture through `Jpeg.Read`, which is the platform decoder of the Windows
		// imaging stack; this port reads it with its own reader of the format and hands a bitmap over.
		const image = readJpegImage(jpeg);
		return Readable.from([writeBmp32(image.width, image.height, image.pixels)]);
	},
});
