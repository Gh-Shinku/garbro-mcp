// Format reference: GARbro "GameRes/ImageJPEG.cs", class `JpegFormat` (JPEG image file format). GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";

/** The word the reference registers for it: the start of an image and the segment a camera writes first. */
const SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const EXTENSION = "jpg";

export interface JpegLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `JpegFormat.ReadMetaData`: the measurements and the depth are read by walking the segments of the file,
 * which the shared reader does the same way — a segment of the frame kind carrying the bits of a colour and
 * the number of colours to a pixel, whose product is the depth. The reference registers the word of nothing
 * beside the word above as well, so a file of any name is offered to it and one that does not walk as a JPEG
 * is not claimed.
 */
export function readJpegLayout(data: Buffer): JpegLayout | undefined {
	return readJpegHeaderFields(data);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameresJpegImageDescriptor: FormatDescriptor = {
	id: "gameres-jpeg-image",
	name: "JPEG image file format",
	extensions: ["jpg", "jpeg"],
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
			source: "GameRes/ImageJPEG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresJpegImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresJpegImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
		extensionFallback: true,
		// The reference exports this format with the priority of ten, which puts it before the formats that
		// carry no priority of their own.
		priority: 10,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 2n) return false;
		return readJpegLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readJpegLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a JPEG picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, EXTENSION),
						offset: 0n,
						size: source.size,
						compressed: false,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: EXTENSION,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		// The picture is handed out as it stands, because the project carries no decoder for it; the bytes are
		// the ones the reference decodes.
		const stored = await readStored(source);
		if (!readJpegLayout(stored)) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a JPEG picture");
		}
		return Readable.from([stored]);
	},
});
