// Format reference: GARbro "ArcFormats/YuRis/ImageYCG.cs", classes `YcgFormat`, `YcgMetaData` and
// `YcgReader` (YU-RIS compressed image format). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `'YCG\0'`. */
const SIGNATURE = 0x00474359;
const HEADER_SIZE = 0x38;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
const BPP_FIELD = 12;
const METHOD_FIELD = 0x10;
const UNPACKED_SIZE_1_FIELD = 0x20;
const COMPRESSED_SIZE_1_FIELD = 0x24;
const UNPACKED_SIZE_2_FIELD = 0x30;
const COMPRESSED_SIZE_2_FIELD = 0x34;
/** The method the reference unfolds, and the one it does not implement. */
const METHOD_ZLIB = 1;
const METHOD_YSSNP = 2;
const PIXEL_SIZE = 4;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface YcgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	compressionMethod: number;
	unpackedSize1: number;
	compressedSize1: number;
	unpackedSize2: number;
	compressedSize2: number;
}

/**
 * `YcgFormat.ReadMetaData`: a header of fifty six bytes behind the signature, holding the measurements, the
 * depth, the method the picture is packed with and two pairs of lengths — what each of the two streams unfolds
 * to, and where the second one begins.
 */
export function readYcgLayout(data: Buffer): YcgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.readUInt32LE(0) !== SIGNATURE) return undefined;
	return {
		width: data.readUInt32LE(WIDTH_FIELD),
		height: data.readUInt32LE(HEIGHT_FIELD),
		bitsPerPixel: data.readInt32LE(BPP_FIELD),
		compressionMethod: data.readInt32LE(METHOD_FIELD),
		unpackedSize1: data.readInt32LE(UNPACKED_SIZE_1_FIELD),
		compressedSize1: data.readInt32LE(COMPRESSED_SIZE_1_FIELD),
		unpackedSize2: data.readInt32LE(UNPACKED_SIZE_2_FIELD),
		compressedSize2: data.readInt32LE(COMPRESSED_SIZE_2_FIELD),
	};
}

/** How many bytes of picture the header describes. */
export function ycgPixelLength(layout: YcgLayout): number {
	return layout.width * PIXEL_SIZE * layout.height;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `YcgReader.UnpackZlib`: two zlib streams, the second standing where the length of the first says it does, and
 * both read into the one picture of four bytes a pixel — the second where the first left off, which is not
 * necessarily the end of the picture, so what neither of them reaches stays at nothing. Each stream must hold
 * as much as its length promises, and the reference asks the first one for **exactly** that much, leaving
 * anything behind it in the stream unread.
 */
export async function unpackYcg(
	stored: Buffer,
	layout: YcgLayout,
): Promise<Buffer> {
	if (METHOD_ZLIB !== layout.compressionMethod) {
		if (METHOD_YSSNP === layout.compressionMethod) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"YSSnp compression is not implemented",
			);
		}
		throw invalidPicture("Unknown YuRis picture compression method");
	}
	const length = ycgPixelLength(layout);
	if (!Number.isSafeInteger(length) || length < 0) {
		throw invalidPicture("YuRis picture of no size");
	}
	if (length > MAXIMUM_PICTURE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`YuRis picture of ${length} bytes is too large`,
		);
	}
	for (const size of [
		layout.unpackedSize1,
		layout.unpackedSize2,
		layout.compressedSize1,
	]) {
		if (size < 0)
			throw invalidPicture("YuRis picture holds a length below nothing");
	}
	if (layout.unpackedSize1 + layout.unpackedSize2 > length) {
		throw invalidPicture(
			"YuRis picture holds more streams than it has room for",
		);
	}
	const output: Buffer = Buffer.alloc(length, 0x00);
	const first = await inflateStream(stored.subarray(HEADER_SIZE), length);
	if (first.length < layout.unpackedSize1) {
		throw invalidPicture("YuRis picture is cut short of its first stream");
	}
	first.copy(output, 0, 0, layout.unpackedSize1);
	const second = await inflateStream(
		stored.subarray(HEADER_SIZE + layout.compressedSize1),
		length - layout.unpackedSize1,
	);
	if (second.length < layout.unpackedSize2) {
		throw invalidPicture("YuRis picture is cut short of its second stream");
	}
	second.copy(output, layout.unpackedSize1, 0, layout.unpackedSize2);
	return output;
}

/** Unfolds one zlib stream of a picture, held to what the picture has room for. */
async function inflateStream(region: Buffer, cap: number): Promise<Buffer> {
	try {
		return await inflateZlibBufferCapped(region, cap);
	} catch {
		throw invalidPicture("YuRis picture holds no whole stream");
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const yuRisYcgImageDescriptor: FormatDescriptor = {
	id: "yu-ris-ycg-image",
	name: "YU-RIS compressed image format",
	extensions: [],
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
			source: "ArcFormats/YuRis/ImageYCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const yuRisYcgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yuRisYcgImageDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from([0x59, 0x43, 0x47, 0x00]) }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readYcgLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readYcgLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a YuRis picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							compressionMethod: layout.compressionMethod,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readYcgLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a YuRis picture");
		}
		const pixels = await unpackYcg(stored, layout);
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
