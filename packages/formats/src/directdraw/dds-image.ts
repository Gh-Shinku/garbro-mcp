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
	DXT1_BLOCK_BYTES,
	DXT_BLOCK_BYTES,
	DXT_BLOCK_SIZE,
	unpackDxt1,
	unpackDxt3,
	unpackDxt5,
} from "../shared/dxt.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'DDS ', the word the reference registers. */
const SIGNATURE = Buffer.from("DDS ", "latin1");
const HEADER_SIZE = 0x6c;
const SIZE_FIELD = 0x04;
/** The smallest size the head may give itself. */
const MINIMUM_SIZE = 0x7c;
const HEIGHT_FIELD = 0x0c;
const WIDTH_FIELD = 0x10;
const PIXEL_FLAGS_FIELD = 0x50;
const FOUR_CC_FIELD = 0x54;
const DEPTH_FIELD = 0x58;
const RED_MASK_FIELD = 0x5c;
const GREEN_MASK_FIELD = 0x60;
const BLUE_MASK_FIELD = 0x64;
const ALPHA_MASK_FIELD = 0x68;
const ALPHA_PIXELS = 0x01;
const FOUR_CC = 0x04;
const REFUSED = 0x200 | 0x20000;
/** The colour of a picture of thirty two bits a pixel that needs no spreading out. */
const PLAIN_BPP = 32;
const RED_PLAIN = 0xff0000;
const GREEN_PLAIN = 0x00ff00;
const BLUE_PLAIN = 0x0000ff;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface DdsLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	dataOffset: number;
	pixelFlags: number;
	/** The four letters of a picture of a compressed kind, where the head gives them. */
	fourCc: string | null;
	redMask: number;
	greenMask: number;
	blueMask: number;
	alphaMask: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readDdsLayout(
	data: Buffer,
	fileLength = data.length,
): DdsLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const size = data.readInt32LE(SIZE_FIELD);
	if (size < MINIMUM_SIZE) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	const pixelFlags = data.readUInt32LE(PIXEL_FLAGS_FIELD);
	let fourCc: string | null = null;
	if (0 !== (pixelFlags & FOUR_CC)) {
		const letters = data.subarray(FOUR_CC_FIELD, FOUR_CC_FIELD + 4);
		const end = letters.indexOf(0);
		fourCc = letters
			.subarray(0, end < 0 ? letters.length : end)
			.toString("latin1");
	}
	const dataOffset = 4 + size;
	if (dataOffset > fileLength || dataOffset < HEADER_SIZE) return undefined;
	return {
		width,
		height,
		bitsPerPixel: data.readInt32LE(DEPTH_FIELD),
		dataOffset,
		pixelFlags,
		fourCc,
		redMask: data.readUInt32LE(RED_MASK_FIELD),
		greenMask: data.readUInt32LE(GREEN_MASK_FIELD),
		blueMask: data.readUInt32LE(BLUE_MASK_FIELD),
		alphaMask: data.readUInt32LE(ALPHA_MASK_FIELD),
	};
}

export function readDdsPixels(stored: Buffer, layout: DdsLayout): Buffer {
	const sourceSize = (layout.bitsPerPixel + 7) >> 3;
	const pixels = layout.width * layout.height;
	if (layout.bitsPerPixel <= 0 || sourceSize > 4) {
		throw invalidPicture(
			"Direct Draw surface declares a colour of an impossible size",
		);
	}
	const inputSize = pixels * sourceSize;
	if (layout.dataOffset + inputSize > stored.length) {
		throw invalidPicture("Direct Draw surface is cut short of its pixels");
	}
	const input = stored.subarray(
		layout.dataOffset,
		layout.dataOffset + inputSize,
	);
	if (
		PLAIN_BPP === layout.bitsPerPixel &&
		RED_PLAIN === layout.redMask &&
		GREEN_PLAIN === layout.greenMask &&
		BLUE_PLAIN === layout.blueMask
	) {
		return Buffer.from(input);
	}
	const output: Buffer = Buffer.alloc(pixels * 4, 0x00);
	const hasAlpha =
		0 !== (layout.pixelFlags & ALPHA_PIXELS) && layout.alphaMask !== 0;
	const spread = (pixel: number, mask: number): number => {
		if (0 === mask) return 0;
		if (layout.bitsPerPixel > 24) {
			return Math.floor(((pixel & mask) * 0xff) / mask) & 0xff;
		}
		// A picture of twenty four bits a pixel or less spreads the place out in a word of four bytes,
		// which may run over — the reference lets it and the port keeps its answer.
		const product = ((pixel & mask) * 0xff) >>> 0;
		return Math.floor(product / mask) & 0xff;
	};
	let dst = 0;
	for (let src = 0; src < inputSize; src += sourceSize) {
		let pixel: number;
		if (8 === layout.bitsPerPixel) pixel = input[src] ?? 0;
		else if (layout.bitsPerPixel <= 16) pixel = input.readUInt16LE(src);
		else pixel = input.readUInt32LE(src);
		output[dst] = spread(pixel, layout.blueMask);
		output[dst + 1] = spread(pixel, layout.greenMask);
		output[dst + 2] = spread(pixel, layout.redMask);
		if (hasAlpha) output[dst + 3] = spread(pixel, layout.alphaMask);
		dst += 4;
	}
	return output;
}

/** The bytes of a picture of a compressed kind, every block of four by four pixels taking its own. */
function blockBytes(layout: DdsLayout, ofOneBlock: number): number {
	const blocksWide = Math.ceil(layout.width / DXT_BLOCK_SIZE);
	const blocksHigh = Math.ceil(layout.height / DXT_BLOCK_SIZE);
	return blocksWide * blocksHigh * ofOneBlock;
}

/**
 * `DdsFormat.Read`: a picture of the fifth or the third kind of block stands behind four letters of its own
 * and takes sixteen bytes to every block of four by four pixels, and one of the first kind takes eight. Any
 * other picture of a compressed kind is turned away.
 */
export function readDdsPicture(stored: Buffer, layout: DdsLayout): Buffer {
	if (layout.fourCc === null || layout.fourCc === "") {
		if (
			0 === layout.redMask ||
			0 === layout.greenMask ||
			0 === layout.blueMask
		) {
			// The reference spreads a colour out by a place of nought only where the head says its colour
			// stands in places at all, and its walk would be turned away there instead.
			throw invalidPicture(
				"Direct Draw surface gives no places for its colour",
			);
		}
		return readDdsPixels(stored, layout);
	}
	const kinds: Record<string, { bytes: number; unpack: typeof unpackDxt1 }> = {
		DXT1: { bytes: DXT1_BLOCK_BYTES, unpack: unpackDxt1 },
		DXT3: { bytes: DXT_BLOCK_BYTES, unpack: unpackDxt3 },
		DXT5: { bytes: DXT_BLOCK_BYTES, unpack: unpackDxt5 },
	};
	const kind = kinds[layout.fourCc];
	if (!kind) {
		throw invalidPicture(
			`Compressed Direct Draw surface of the kind ${layout.fourCc} not supported`,
		);
	}
	const needed = blockBytes(layout, kind.bytes);
	if (layout.dataOffset + needed > stored.length) {
		throw invalidPicture("Direct Draw surface is cut short of its blocks");
	}
	return kind.unpack(
		stored.subarray(layout.dataOffset, layout.dataOffset + needed),
		layout.width,
		layout.height,
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const directDrawDdsImageDescriptor: FormatDescriptor = {
	id: "directdraw-dds-image",
	name: "Direct Draw Surface format",
	extensions: ["dds"],
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
			source: "ArcFormats/DirectDraw/ImageDDS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const directDrawDdsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: directDrawDdsImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readDdsLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readDdsLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Direct Draw surface");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const compressed = null !== layout.fourCc && "" !== layout.fourCc;
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					fourCc: layout.fourCc,
				},
			}),
			// The pixels are spread out and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: compressed ? layout.fourCc?.toLowerCase() : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readDdsLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Direct Draw surface");
		}
		if (0 !== (layout.pixelFlags & REFUSED)) {
			throw invalidPicture(
				"Direct Draw surface of a colour this project does not read",
			);
		}
		const pixels = readDdsPicture(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
