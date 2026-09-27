// Port of GARbro "GameRes/ImageTIFF.cs" (tag "TIFF", class TifFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The reference hands the stream to the decoder of
// its platform and this port walks the file itself, so the places of the picture stand of the walk of this
// project and the head of the file of the walk the reference stands of.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmpImage } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readTiffImage } from "../shared/tiff-image.js";

/** The two heads the format names, little endian and big endian. */
const LITTLE_HEAD = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const BIG_HEAD = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameresTiffImageDescriptor: FormatDescriptor = {
	id: "gameres-tiff-image",
	name: "Tagged Image File Format image",
	extensions: ["tif", "tiff"],
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
			source: "GameRes/ImageTIFF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresTiffImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresTiffImageDescriptor,
	detection: { signatures: [{ bytes: LITTLE_HEAD }, { bytes: BIG_HEAD }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 8n) return false;
		const head = Buffer.from(await source.readAt(0n, 8));
		if (
			!head.subarray(0, 4).equals(LITTLE_HEAD) &&
			!head.subarray(0, 4).equals(BIG_HEAD)
		)
			return false;
		try {
			return (await readTiffImage(await readStored(source))) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const image = await readTiffImage(await readStored(source));
		if (!image) throw invalidPicture("Not a tagged image file");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: image.width,
					height: image.height,
					bitsPerPixel: image.bitsPerPixel,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: image.width,
				height: image.height,
				bitsPerPixel: image.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const image = await readTiffImage(await readStored(source));
		if (!image)
			throw invalidPicture(
				"The places of the picture stand of no picture of their own",
			);
		return Readable.from([writeBmpImage(image)]);
	},
});
