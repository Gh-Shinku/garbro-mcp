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
} from "../shared/fixed-archive.js";

/** The head of a picture of the first kind stands in this many places, and the words of the kind stand where
 * the head of the picture names them. */
const HEAD_SIZE = 0x30;
const VERSION_FIELD = 0x04;
const MAXIMUM_VERSION = 2;
/** The words of a picture of the first kind. */
const FIRST_OFFSET_X_FIELD = 0x08;
const FIRST_OFFSET_Y_FIELD = 0x0c;
const FIRST_WIDTH_FIELD = 0x10;
const FIRST_HEIGHT_FIELD = 0x14;
const FIRST_BITS_FIELD = 0x18;
const FIRST_RGB_SIZE_FIELD = 0x20;
const FIRST_ALPHA_SIZE_FIELD = 0x24;
/** The words of a picture of the other kinds. */
const HEAD_SIZE_FIELD = 0x08;
const OFFSET_X_FIELD = 0x0c;
const OFFSET_Y_FIELD = 0x10;
const WIDTH_FIELD = 0x14;
const HEIGHT_FIELD = 0x18;
const BITS_FIELD = 0x1c;
const RGB_SIZE_FIELD = 0x24;
const ALPHA_SIZE_FIELD = 0x28;
/** Three places of a colour stand in every place of a picture, and a place of the transparency of the picture
 * stands beside them where the head of the picture names one. */
const COLOUR_PLACES = 3;
const ALPHA_PLACES = 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface QntLayout {
	version: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	headerSize: number;
	rgbSize: number;
	alphaSize: number;
	alignedWidth: number;
	alignedHeight: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readQntLayout(
	data: Buffer,
	fileLength = data.length,
): QntLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (data.toString("latin1", 0, 3) !== "QNT") return undefined;
	const version = data.readInt32LE(VERSION_FIELD);
	if (version < 0 || version > MAXIMUM_VERSION) return undefined;
	if (version === 0) {
		const width = data.readUInt32LE(FIRST_WIDTH_FIELD);
		const height = data.readUInt32LE(FIRST_HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height > LIMIT) return undefined;
		return {
			version,
			width,
			height,
			offsetX: data.readInt32LE(FIRST_OFFSET_X_FIELD),
			offsetY: data.readInt32LE(FIRST_OFFSET_Y_FIELD),
			bitsPerPixel: data.readInt32LE(FIRST_BITS_FIELD),
			headerSize: HEAD_SIZE,
			rgbSize: data.readUInt32LE(FIRST_RGB_SIZE_FIELD),
			alphaSize: data.readUInt32LE(FIRST_ALPHA_SIZE_FIELD),
			alignedWidth: (width + 1) & ~1,
			alignedHeight: (height + 1) & ~1,
		};
	}
	const headerSize = data.readInt32LE(HEAD_SIZE_FIELD);
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width * height > LIMIT) return undefined;
	if (headerSize < HEAD_SIZE || headerSize > fileLength) return undefined;
	return {
		version,
		width,
		height,
		offsetX: data.readInt32LE(OFFSET_X_FIELD),
		offsetY: data.readInt32LE(OFFSET_Y_FIELD),
		bitsPerPixel: data.readInt32LE(BITS_FIELD),
		headerSize,
		rgbSize: data.readUInt32LE(RGB_SIZE_FIELD),
		alphaSize: data.readUInt32LE(ALPHA_SIZE_FIELD),
		alignedWidth: (width + 1) & ~1,
		alignedHeight: (height + 1) & ~1,
	};
}

export function unpackQnt(
	first: Buffer,
	second: Buffer | undefined,
	layout: QntLayout,
): Buffer {
	const width = layout.width;
	const height = layout.height;
	const places = layout.alphaSize !== 0 ? ALPHA_PLACES : COLOUR_PLACES;
	const colours = layout.alignedHeight * layout.alignedWidth * COLOUR_PLACES;
	if (first.length < colours) {
		throw invalidPicture("AliceSoft picture is cut short of its places");
	}
	const output: Buffer = Buffer.alloc(width * height * places, 0x00);
	const stride = places * width;
	let src = 0;
	for (let channel = 0; channel < COLOUR_PLACES; channel += 1) {
		let dst = channel;
		for (let y = height >> 1; y !== 0; y -= 1) {
			for (let x = 0; x < width; x += 1) {
				output[dst] = first[src++] ?? 0;
				output[dst + stride] = first[src++] ?? 0;
				dst += places;
			}
			dst += stride;
			src += 2 * (width & 1);
		}
		if (0 !== (height & 1)) {
			for (let x = 0; x < width; x += 1) {
				output[dst] = first[src] ?? 0;
				src += 2;
				dst += places;
			}
			src += 2 * (width & 1);
		}
	}
	if (places !== COLOUR_PLACES) {
		if (undefined === second) {
			throw invalidPicture("AliceSoft picture stands with no transparency");
		}
		let at = 0;
		let dst = 3;
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				output[dst] = second[at++] ?? 0;
				dst += ALPHA_PLACES;
			}
			at += width & 1;
		}
	}
	let dst = places;
	for (let i = stride - places; i !== 0; i -= 1) {
		const value = (output[dst - places] ?? 0) - (output[dst] ?? 0);
		output[dst] = value & 0xff;
		dst += 1;
	}
	for (let y = height - 1; y !== 0; y -= 1) {
		for (let i = 0; i !== places; i += 1) {
			output[dst] = ((output[dst - stride] ?? 0) - (output[dst] ?? 0)) & 0xff;
			dst += 1;
		}
		for (let i = stride - places; i !== 0; i -= 1) {
			const value =
				(((output[dst - stride] ?? 0) + (output[dst - places] ?? 0)) >> 1) -
				(output[dst] ?? 0);
			output[dst] = value & 0xff;
			dst += 1;
		}
	}
	return output;
}

async function inflatePlaces(part: Buffer): Promise<Buffer> {
	try {
		return await inflateZlibBuffer(part);
	} catch {
		throw invalidPicture("AliceSoft picture is cut short of its places");
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readQnt(source: ByteSource, stored: Buffer) {
	const layout = readQntLayout(stored, Number(source.size));
	if (!layout) throw invalidPicture("Not an AliceSoft picture");
	const colours = layout.alignedHeight * layout.alignedWidth * COLOUR_PLACES;
	const first = await inflatePlaces(
		stored.subarray(layout.headerSize, layout.headerSize + layout.rgbSize),
	);
	if (first.length < colours) {
		throw invalidPicture("AliceSoft picture is cut short of its places");
	}
	let second: Buffer | undefined;
	if (layout.alphaSize !== 0) {
		second = await inflatePlaces(
			stored.subarray(
				layout.headerSize + layout.rgbSize,
				layout.headerSize + layout.rgbSize + layout.alphaSize,
			),
		);
	}
	return { layout, pixels: unpackQnt(first, second, layout) };
}

export const alicesoftQntImageDescriptor: FormatDescriptor = {
	id: "alicesoft-qnt-image",
	name: "AliceSoft System image format",
	extensions: ["qnt"],
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
			source: "ArcFormats/AliceSoft/ImageQNT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const alicesoftQntImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: alicesoftQntImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("QNT", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const stored = await readStored(source);
			const layout = readQntLayout(stored, Number(source.size));
			if (!layout) return false;
			const colours =
				layout.alignedHeight * layout.alignedWidth * COLOUR_PLACES;
			const first = await inflatePlaces(
				stored.subarray(layout.headerSize, layout.headerSize + layout.rgbSize),
			);
			return first.length >= colours;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readQntLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an AliceSoft picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const places = layout.alphaSize !== 0 ? ALPHA_PLACES : COLOUR_PLACES;
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: BigInt(layout.headerSize),
					size: source.size - BigInt(layout.headerSize),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: places * 8,
						version: layout.version,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: places * 8,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
				version: layout.version,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const { layout, pixels } = await readQnt(source, stored);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (layout.alphaSize !== 0) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, false),
			]);
		}
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, false),
		]);
	},
});
