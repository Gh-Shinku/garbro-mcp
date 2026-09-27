// Port of GARbro "Experimental/WebP/ImageWEBP.cs" (tag "WEBP", class WebPFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The reference hands the stream to the library of the
// picture of the web of its platform and this port walks the counts of the picture itself, so the places of the
// picture stand of the walk of this project and the head of the file of the walk the reference stands of.

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
import { readWebpHeader, readWebpImage } from "../shared/webp-image.js";

/** The head of the format of the picture of the web, of the counts of the head of the format of the picture of the
 * web of the places of the file and of the count of the head of the picture of the head of the file. */
const RIFF_HEAD = Buffer.from([0x52, 0x49, 0x46, 0x46]);

/** The head of the head of the file of the picture of the web, of the counts of the head of the format of the places
 * of the file of the head of the picture of the format. */
const WEBP_HEAD = Buffer.from([0x57, 0x45, 0x42, 0x50]);

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameresWebpImageDescriptor: FormatDescriptor = {
	id: "gameres-webp-image",
	name: "WebP image",
	extensions: ["webp"],
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
			source: "Experimental/WebP/ImageWEBP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresWebpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresWebpImageDescriptor,
	detection: { signatures: [{ bytes: RIFF_HEAD }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 12n) return false;
		const head = Buffer.from(await source.readAt(0n, 12));
		if (!head.subarray(0, 4).equals(RIFF_HEAD)) return false;
		return head.subarray(8, 12).equals(WEBP_HEAD);
	},
	async read(source: ByteSource) {
		const header = readWebpHeader(await readStored(source));
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: header.width,
					height: header.height,
					bitsPerPixel: 32,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: header.width,
				height: header.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		try {
			return Readable.from([
				writeBmpImage(readWebpImage(await readStored(source))),
			]);
		} catch (error) {
			if (error instanceof GarbroError)
				throw new GarbroError("UNSUPPORTED_FEATURE", error.message);
			throw error;
		}
	},
});
