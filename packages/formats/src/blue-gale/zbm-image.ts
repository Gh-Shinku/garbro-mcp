// Format reference: GARBro "ArcFormats/BlueGale/ImageZBM.cs", classes `ZbmFormat` and `ZbmMetaData`. The
// codec and the obfuscation behind it are shared with the animation archives of the same engine and are
// ported in "./zbm.ts"; this module is the picture format itself.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, writeBmpImage } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { decryptZbm, unpackZbm } from "./zbm.js";

/** The four bytes of the signature, which the reference packs into a word. */
const SIGNATURE = Buffer.from("amp_", "latin1");
const VERSION_OFFSET = 4;
const VERSION = 1;
const UNPACKED_SIZE_OFFSET = 6;
const DATA_OFFSET_FIELD = 0x0a;
/** Everything up to the picture itself: the four fields above. */
const STREAM_OFFSET = 0x0e;
/** The shortest a bitmap can be, which is what the reference insists the size stands above. */
const MINIMUM_SIZE = 0x36;
/** How much of the picture the reference unfolds to read the measurements of the bitmap with. */
const FIELDS_SIZE = 0x20;
/** The measurements stand where a bitmap keeps them, and the depth two bytes behind them. */
const WIDTH_FIELD = 0x12;
const HEIGHT_FIELD = 0x16;
const DEPTH_FIELD = 0x1c;
const BMP_TAG = Buffer.from("BM", "latin1");
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface ZbmImageLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `ZbmFormat.ReadMetaData`: the four bytes `amp_`, then a version word that has to stand at one, the size the
 * picture unfolds to — which has to stand above the length of a bitmap — and the place the picture stands at,
 * which may not stand inside the header. The measurements come from the first thirty two bytes of the bitmap
 * that unfolds there, once the obfuscation has been taken off them: where a bitmap keeps its measurements. The
 * reference reads the depth as a signed word and reports it as it stands.
 */
export function readZbmImageLayout(data: Buffer): ZbmImageLayout | undefined {
	if (data.length < STREAM_OFFSET) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (VERSION !== data.readInt16LE(VERSION_OFFSET)) return undefined;
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_OFFSET);
	const dataOffset = data.readInt32LE(DATA_OFFSET_FIELD);
	if (unpackedSize < MINIMUM_SIZE || dataOffset < STREAM_OFFSET)
		return undefined;
	if (dataOffset >= data.length) return undefined;
	const fields: Buffer = Buffer.alloc(FIELDS_SIZE, 0x00);
	unpackZbm(data.subarray(dataOffset), fields);
	decryptZbm(fields);
	if (!fields.subarray(0, BMP_TAG.length).equals(BMP_TAG)) return undefined;
	const width = fields.readUInt32LE(WIDTH_FIELD);
	const height = fields.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	return {
		width,
		height,
		bitsPerPixel: fields.readInt16LE(DEPTH_FIELD),
		unpackedSize,
		dataOffset,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const blueGaleZbmImageDescriptor: FormatDescriptor = {
	id: "blue-gale-zbm-image",
	name: "BlueGale compressed image format",
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
			source: "ArcFormats/BlueGale/ImageZBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const blueGaleZbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blueGaleZbmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(STREAM_OFFSET)) return false;
		return readZbmImageLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readZbmImageLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a BlueGale picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(layout.dataOffset),
						size: BigInt(layout.unpackedSize),
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: true,
				},
			],
			metadata: {
				image: "bmp",
				compression: "zbm",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readZbmImageLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a BlueGale picture");
		}
		if (layout.unpackedSize > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`BlueGale picture of ${layout.unpackedSize} bytes is too large`,
			);
		}
		const bitmap: Buffer = Buffer.alloc(layout.unpackedSize, 0x00);
		unpackZbm(stored.subarray(layout.dataOffset), bitmap);
		decryptZbm(bitmap);
		// `Bmp.Read`: the reference takes the bitmap apart and hands the picture out, which the port mirrors.
		const image = readBmpImage(bitmap);
		if (!image) {
			throw invalidPicture("Not a BlueGale picture");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
