// Format reference: GARbro "ArcFormats/Hexenhaus/ArcWAG.cs", class `ImgdFormat` (a picture of the WAG kind
// that stands as the places of a portable network graphic behind a head of its own: the reference stands the
// places of the picture behind the words of its head and hands them to the reader of the pictures of that
// kind). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { readPngHeaderFields } from "../shared/png.js";

/** The words a picture of this kind stands behind, and how many places of the file its head stands in. */
const MARK = Buffer.from("IMGD", "latin1");
const HEAD_SIZE = 0x10;
/** The words and the places the places of the picture stand behind at the end of the file, which name where
 * the places of the picture stand within the picture of the game they stand in. */
const TRAILER_MARK = "CNTR";
const TRAILER_SIZE = 12;
const TRAILER_TAIL = 14;
const OFFSET_X_FIELD = 4;
const OFFSET_Y_FIELD = 8;

export interface ImgdLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	offsetX: number;
	offsetY: number;
	pictureOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `ImgdFormat.ReadMetaData`: the words of the head of a picture of this kind stand in the first four places of
 * the file, and the places of a portable network graphic stand behind the head: the reference hands those
 * places to the reader of the pictures of that kind and reads the words of the head of the picture itself. The
 * places of the picture stand fourteen places behind the end of the file where they name where the picture
 * stands within the picture of the game it stands in.
 */
export function readImgdLayout(
	data: Buffer,
	fileLength = data.length,
): ImgdLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const png = readPngHeaderFields(data.subarray(HEAD_SIZE));
	if (!png) return undefined;
	let offsetX = 0;
	let offsetY = 0;
	const trailerAt = fileLength - TRAILER_TAIL;
	if (trailerAt >= 0 && trailerAt + TRAILER_SIZE <= data.length) {
		const trailer = data.subarray(trailerAt, trailerAt + TRAILER_SIZE);
		if (trailer.toString("latin1", 0, 4) === TRAILER_MARK) {
			offsetX = trailer.readInt32LE(OFFSET_X_FIELD);
			offsetY = trailer.readInt32LE(OFFSET_Y_FIELD);
		}
	}
	return {
		width: png.width,
		height: png.height,
		bitsPerPixel: png.bitsPerPixel,
		offsetX,
		offsetY,
		pictureOffset: HEAD_SIZE,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const hexenhausImgdImageDescriptor: FormatDescriptor = {
	id: "hexenhaus-imgd-image",
	name: "WAG archive PNG image",
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
			source: "ArcFormats/Hexenhaus/ArcWAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const hexenhausImgdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hexenhausImgdImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return (
				readImgdLayout(await readStored(source), Number(source.size)) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readImgdLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a WAG picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "png"),
					offset: BigInt(layout.pictureOffset),
					size: source.size - BigInt(layout.pictureOffset),
					compressed: false,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
						offsetX: layout.offsetX,
						offsetY: layout.offsetY,
					},
				}),
			],
			metadata: {
				image: "png",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readImgdLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a WAG picture");
		// The reference hands the places behind the words of its own head to the reader of the pictures of the
		// kind this one stands as, and this project reads no places of such a picture, so this port hands them
		// out as they stand.
		return Readable.from([Buffer.from(stored.subarray(layout.pictureOffset))]);
	},
});
