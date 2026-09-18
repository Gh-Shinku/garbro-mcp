// Format reference: GARbro "ArcFormats/FrontWing/ImageFG.cs", classes `FwgiFormat`, `FweiFormat` and
// `FgMetaData` (a FrontWing picture whose pixels are a bitmap of their own, sometimes assembled out of a
// companion file and unfolded from a zlib stream first). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { readBmpImage, writeBmpImage } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'FWGI' and 'FWEI', the words the reference registers. */
const FWGI_SIGNATURE = Buffer.from("FWGI", "latin1");
const FWEI_SIGNATURE = Buffer.from("FWEI", "latin1");
const HEADER_SIZE = 0x1b0;
const VERSION_FIELD = 0x04;
const OFFSET_X_FIELD = 0x0c;
const OFFSET_Y_FIELD = 0x10;
const WIDTH_FIELD = 0x1c;
const HEIGHT_FIELD = 0x20;
/** The place of the bitmap stands four bytes before where it really is. */
const DATA_OFFSET_FIELD = 0x128;
const DATA_LENGTH_FIELD = 0x12c;
const DATA_OFFSET_BIAS = 4;
/** The companion of the encoded kind holds exactly this much. */
const FGE_SIZE = 0x818;
const FGE_CHUNK1_SIZE_FIELD = 0x00;
const FGE_CHUNK1_DATA = 4;
const FGE_CHUNK2_OFFSET_FIELD = 0x404;
const FGE_CHUNK2_SIZE_FIELD = 0x408;
const FGE_CHUNK2_DATA = 0x40c;
const FGE_COMPRESSED_FIELD = 0x810;
/** The encoded kind keeps its own data from here, behind its four byte mark and one more. */
const FWEI_DATA_OFFSET = 5;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface FwgiLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	dataOffset: number;
	dataLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `FwgiFormat.ReadMetaData`: the word `FWGI`, the word `1` at four, the offsets of the picture at twelve and
 * sixteen, the width and the height at `0x1C` and `0x20`, and the place and the size of the bitmap at
 * `0x128` and `0x12C` — where the place stands **four bytes before** where the bitmap really is. The depth
 * is always reported as thirty two bits.
 */
export function readFwgiLayout(
	data: Buffer,
	fileLength = data.length,
): FwgiLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, FWGI_SIGNATURE.length).equals(FWGI_SIGNATURE)) {
		return undefined;
	}
	if (data.readInt32LE(VERSION_FIELD) !== 1) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > 0x8000 || height > 0x8000) return undefined;
	const dataOffset = data.readUInt32LE(DATA_OFFSET_FIELD) + DATA_OFFSET_BIAS;
	const dataLength = data.readUInt32LE(DATA_LENGTH_FIELD);
	if (
		dataLength === 0 ||
		BigInt(dataOffset) + BigInt(dataLength) > BigInt(fileLength)
	) {
		return undefined;
	}
	return {
		width,
		height,
		offsetX: data.readInt32LE(OFFSET_X_FIELD),
		offsetY: data.readInt32LE(OFFSET_Y_FIELD),
		dataOffset,
		dataLength,
	};
}

/**
 * `FwgiFormat.Read`: the bitmap the head points at is read as a bitmap of its own and handed on, which is
 * how the reference reads `Bmp.ReadMetaData` and then `Bmp.Read` over the region.
 */
export function readFwgiBitmap(
	stored: Buffer,
	layout: FwgiLayout,
): Buffer | undefined {
	const region = stored.subarray(
		layout.dataOffset,
		layout.dataOffset + layout.dataLength,
	);
	const image = readBmpImage(region);
	if (!image) return undefined;
	return writeBmpImage(image);
}

/**
 * `FweiFormat.OpenFg`: the encoded kind carries no bitmap of its own. Its companion — the same name with the
 * extension `.fge`, of exactly `0x818` bytes — holds the first part of the stream, its own middle stands in
 * the file itself from the fifth byte on, and the companion holds the rest from `0x40C`. Where the companion
 * says so, the whole of it is then unfolded from a zlib stream, and the result is read as a picture of the
 * older kind.
 */
export function assembleFwei(fge: Buffer, fg: Buffer): Buffer | undefined {
	if (fge.length !== FGE_SIZE) return undefined;
	const chunk1Size = fge.readInt32LE(FGE_CHUNK1_SIZE_FIELD);
	const chunk2Offset = fge.readInt32LE(FGE_CHUNK2_OFFSET_FIELD);
	const chunk2Size = fge.readInt32LE(FGE_CHUNK2_SIZE_FIELD);
	if (chunk1Size < 0 || chunk2Offset < chunk1Size || chunk2Size < 0) {
		return undefined;
	}
	const part1Size = chunk2Offset + chunk2Size;
	if (
		FGE_CHUNK1_DATA + chunk1Size > fge.length ||
		FGE_CHUNK2_DATA + chunk2Size > fge.length
	) {
		return undefined;
	}
	const part1: Buffer = Buffer.alloc(part1Size, 0x00);
	fge.copy(part1, 0, FGE_CHUNK1_DATA, FGE_CHUNK1_DATA + chunk1Size);
	const middle = chunk2Offset - chunk1Size;
	if (FWEI_DATA_OFFSET + middle > fg.length) return undefined;
	fg.copy(part1, chunk1Size, FWEI_DATA_OFFSET, FWEI_DATA_OFFSET + middle);
	fge.copy(part1, chunk2Offset, FGE_CHUNK2_DATA, FGE_CHUNK2_DATA + chunk2Size);
	return Buffer.concat([part1, fg.subarray(FWEI_DATA_OFFSET + middle)]);
}

/** The companion of an encoded picture, or nothing where it does not stand beside it. */
async function readFge(sourcePath: string): Promise<Buffer | undefined> {
	const name = changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "fge");
	return await readCompanionFile(sourcePath, name);
}

/** The stream of an encoded picture, unfolded where the companion says it is packed. */
export async function unpackFwei(
	stored: Buffer,
	sourcePath: string,
): Promise<Buffer | undefined> {
	const fge = await readFge(sourcePath);
	if (!fge) return undefined;
	const assembled = assembleFwei(fge, stored);
	if (!assembled) return undefined;
	if (0 === fge.readInt32LE(FGE_COMPRESSED_FIELD)) return assembled;
	return await inflateZlibBufferCapped(assembled, LIMIT);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function pictureEntry(layout: FwgiLayout, sourcePath: string): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(layout.dataOffset),
			size: BigInt(layout.dataLength),
			compressed: false,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		}),
		// The bitmap the head points at is a picture of its own, which is written as it stands.
		sizeKnown: false,
	};
}

export const frontWingFwgiImageDescriptor: FormatDescriptor = {
	id: "frontwing-fwgi-image",
	name: "FrontWing image format",
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
			source: "ArcFormats/FrontWing/ImageFG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const frontWingFwgiImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: frontWingFwgiImageDescriptor,
	detection: { signatures: [{ bytes: FWGI_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readFwgiLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readFwgiLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a FrontWing picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath)],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readFwgiLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a FrontWing picture");
		}
		const bitmap = readFwgiBitmap(stored, layout);
		if (!bitmap) {
			throw invalidPicture("FrontWing picture does not hold a bitmap");
		}
		return Readable.from([bitmap]);
	},
});

export const frontWingFweiImageDescriptor: FormatDescriptor = {
	id: "frontwing-fwei-image",
	name: "FrontWing encoded image format",
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
			source: "ArcFormats/FrontWing/ImageFG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const frontWingFweiImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: frontWingFweiImageDescriptor,
	detection: { signatures: [{ bytes: FWEI_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (source.size < BigInt(FWEI_DATA_OFFSET)) return false;
		try {
			const header = Buffer.from(
				await source.readAt(0n, FWEI_SIGNATURE.length),
			);
			if (!header.subarray(0, FWEI_SIGNATURE.length).equals(FWEI_SIGNATURE)) {
				return false;
			}
			// The reference refuses a picture of this kind without the companion it names, and so does this
			// port: there is nothing to read without it.
			const fge = await readFge(sourcePath);
			return fge !== undefined && fge.length === FGE_SIZE;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const assembled = await unpackFwei(stored, sourcePath);
		if (!assembled) {
			throw invalidPicture(
				"FrontWing encoded picture is missing the companion file it names",
			);
		}
		const layout = readFwgiLayout(assembled, assembled.length);
		if (!layout) {
			throw invalidPicture("Not a FrontWing picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
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
					bitsPerPixel: 32,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					companion: true,
				},
			}),
			// The stream is assembled out of two files and unfolded before the bitmap is read out of it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const stored = await readStored(source);
		const assembled = await unpackFwei(stored, sourcePath);
		if (!assembled) {
			throw invalidPicture(
				"FrontWing encoded picture is missing the companion file it names",
			);
		}
		const layout = readFwgiLayout(assembled, assembled.length);
		if (!layout) {
			throw invalidPicture("Not a FrontWing picture");
		}
		const bitmap = readFwgiBitmap(assembled, layout);
		if (!bitmap) {
			throw invalidPicture("FrontWing picture does not hold a bitmap");
		}
		return Readable.from([bitmap]);
	},
});
