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
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { readPngHeaderFields } from "../shared/png.js";
import { readPngImage } from "../shared/png-image.js";

const MARK = Buffer.from("IMGD", "latin1");
const HEAD_SIZE = 0x10;
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

export interface DecodedImgdImage {
	layout: ImgdLayout;
	bitmap: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

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

/** Decode the complete decrypted IMGD entry to the bitmap returned by the standalone image format. */
export async function decodeImgdImage(
	stored: Buffer,
): Promise<DecodedImgdImage> {
	const layout = readImgdLayout(stored, stored.length);
	if (!layout) throw invalidPicture("Not a WAG picture");
	const image = await readPngImage(stored.subarray(layout.pictureOffset));
	if (!image) {
		throw invalidPicture(
			"The picture stands of no picture of the kind its head names",
		);
	}
	if (32 === image.bitsPerPixel) {
		return {
			layout,
			bitmap: writeBmp32(image.width, image.height, Buffer.from(image.pixels)),
		};
	}
	if (24 === image.bitsPerPixel) {
		return {
			layout,
			bitmap: writeBmp24(image.width, image.height, Buffer.from(image.pixels)),
		};
	}
	throw invalidPicture(
		`The picture stands of ${image.bitsPerPixel} places of a colour`,
	);
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
		// `ImgdFormat.Read` stands of the walk of the pictures of the kind this picture stands as, over the
		// places behind the words of the head of the picture. The places of a picture of this kind stand of
		// three or four places of a colour to a pixel, of the rows of the file turned over, which a bitmap of
		// this project holds the same way.
		return Readable.from([(await decodeImgdImage(stored)).bitmap]);
	},
});
