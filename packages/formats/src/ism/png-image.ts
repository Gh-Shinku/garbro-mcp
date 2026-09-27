// Port of GARbro "ArcFormats/Ism/ImagePNG.cs" (tag "PNG/ISM", class PngIsmFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The pictures of the engine of ISM: a PNG whose
// places of the colours are turned over, so that a place of no colour stands for a place of colour.
//
// The reference reaches this walk only from inside an archive of its own engine: `ReadMetaData` answers
// nothing unless the file stands inside an archive whose tag is `ISA` (`VFS.IsVirtual &&
// VFS.CurrentArchive.Tag != "ISA"`), and the format stands of the last priority of its own table
// (`[ExportMetadata("Priority", -1)]`), so a file of the name `.png` that stands alone stands of the walk of
// the format of that name rather than of this one. The port carries the walk and the last priority of the
// reference; the archive of the engine of ISM stands in this project as `ism-isa`, which lists the places of
// its files and hands them over as they stand rather than routing the pictures of the name `.png` here.
//
// The reference reads the picture with the decoder of the platform (`PngBitmapDecoder`) and turns the place
// of the colour of every picture of thirty two places over where the picture stands of `Bgra32`; this port
// reads the picture with its own reader of that format (`shared/png-image.ts`), which hands out places of
// the colours of the same shape, and turns the same place over. A picture of twenty four places of a colour
// stands as it stands, the reference turning no place of it over either.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { changeExtension } from "../shared/companion.js";
import { readPngImage } from "../shared/png-image.js";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** `PngIsmFormat.Signature`: the word the format opens with, the head of a picture of the name `.png`. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The places of the file of one place of a picture of thirty two places of a colour. */
const PLACES_PER_PICTURE = 4;
/** Where the place of the colour of a picture of that shape stands. */
const ALPHA_PLACE = 3;
const MOST_PLACES = 0xff;

/**
 * `PngIsmFormat.Read`: the places of a picture of the engine, of the walk of the reference. A picture the
 * reader of this project cannot walk stands of no picture at all rather than of a stream that throws.
 */
export async function readPngIsmPicture(
	data: Buffer,
): Promise<Buffer | undefined> {
	let picture: Awaited<ReturnType<typeof readPngImage>>;
	try {
		picture = await readPngImage(data);
	} catch (error) {
		if (error instanceof GarbroError) return undefined;
		throw error;
	}
	if (!picture) return undefined;
	if (32 === picture.bitsPerPixel) {
		for (
			let at = ALPHA_PLACE;
			at < picture.pixels.length;
			at += PLACES_PER_PICTURE
		) {
			picture.pixels[at] = (picture.pixels[at] ?? 0) ^ MOST_PLACES;
		}
		return writeBmp32(picture.width, picture.height, picture.pixels);
	}
	return writeBmp24(picture.width, picture.height, picture.pixels);
}

export const ismPngDescriptor: FormatDescriptor = {
	id: "png-ism-image",
	name: "ISM engine PNG image",
	extensions: ["png"],
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
			source: "ArcFormats/Ism/ImagePNG.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

export const ismPngFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ismPngDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
		// `PngIsmFormat` stands of the last priority of the table of the reference, so a picture of the name
		// `.png` that stands alone stands of the format of that name rather than of this one.
		priority: -1,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(SIGNATURE.length)) return false;
		const head = await source.readAt(0n, SIGNATURE.length);
		return head.equals(SIGNATURE);
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const picture = await readPngIsmPicture(data);
		if (!picture) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not a picture the reader of this format can walk",
			);
		}
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(basename(sourcePath), "bmp"),
					offset: 0n,
					size: source.size,
					metadata: {
						type: "image",
						image: "bmp",
					} as Record<string, unknown>,
				}),
			],
			metadata: { kind: "image" },
		};
	},
	async openEntry(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const picture = await readPngIsmPicture(data);
		if (!picture) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not a picture the reader of this format can walk",
			);
		}
		return Readable.from([picture]);
	},
});
