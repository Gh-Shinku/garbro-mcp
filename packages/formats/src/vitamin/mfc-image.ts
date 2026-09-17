// Format reference: GARbro "ArcFormats/Vitamin/ImageMFC.cs", classes `MfcFormat`, `MfcMetaData` and the
// `RleUnpack` walk (a Vitamin picture with a run length coded alpha channel of four bits a pixel). GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB565_MASKS,
	toBgra32,
	writeBmp32,
	type BmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readSbiLayout, sbiStride, unpackSbi } from "./sbi-image.js";

/** 'MFC\n', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("MFC\n", "latin1");
const HEADER_SIZE = 0x18;
const ALPHA_OFFSET_FIELD = 12;
/** The four bytes at four must be a one, nothing, a one and a four. */
const MARKER = Buffer.from([1, 0, 1, 4]);
/** The depths the reader knows, as its base format does. */
const DEPTHS = [8, 16, 24, 32];
/** A ramp of greys, which is what the reference's own eight bit grey picture carries. */
const GREY_PALETTE: Buffer = (() => {
	const entries: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let i = 0; i < 0x100; i += 1) {
		entries[i * 4] = i;
		entries[i * 4 + 1] = i;
		entries[i * 4 + 2] = i;
	}
	return entries;
})();

export interface MfcLayout {
	width: number;
	height: number;
	/** The depth of the base picture, which the colour is read through. */
	bitsPerPixel: number;
	/** Where the base picture begins, and therefore where the alpha channel ends. */
	alphaSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MfcFormat.ReadMetaData`: the four bytes at four are a one, nothing, a one and a four, the size of the
 * alpha channel stands at twelve, and the base picture is a Vitamin picture of its own that begins where the
 * alpha channel ends. The measurements and the depth are the base picture's, and the picture itself is
 * always handed out thirty two bits a pixel.
 */
export function readMfcLayout(data: Buffer): MfcLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	for (let index = 0; index < MARKER.length; index += 1) {
		if (data[4 + index] !== MARKER[index]) return undefined;
	}
	const alphaSize = data.readInt32LE(ALPHA_OFFSET_FIELD);
	if (alphaSize < HEADER_SIZE || alphaSize > data.length) return undefined;
	const base = readSbiLayout(data.subarray(alphaSize));
	if (!base) return undefined;
	return {
		width: base.width,
		height: base.height,
		bitsPerPixel: base.bitsPerPixel,
		alphaSize,
	};
}

/**
 * `MfcReader.RleUnpack`: the alpha channel is a run length code of its own. A byte below `0x80` is that many
 * alpha bytes that stand in the stream themselves, and a byte at `0x80` or above is that many less `0x80`
 * copies of the byte behind it. The walk is bounded by the size the head declares for the channel.
 */
export function unpackMfcAlpha(
	data: Buffer,
	offset: number,
	inputSize: number,
	outputLength: number,
): Buffer {
	const output: Buffer = Buffer.alloc(Math.max(0, outputLength), 0x00);
	let position = offset;
	let remaining = inputSize;
	let dst = 0;
	while (remaining > 0) {
		if (position >= data.length) {
			throw invalidPicture("Vitamin alpha channel is cut short of its stream");
		}
		const control = data[position] ?? 0;
		position += 1;
		remaining -= 1;
		if (control >= 0x80) {
			if (position >= data.length) {
				throw invalidPicture(
					"Vitamin alpha channel is cut short of its stream",
				);
			}
			const value = data[position] ?? 0;
			position += 1;
			remaining -= 1;
			const count = control & 0x7f;
			if (dst + count > output.length) {
				throw invalidPicture("Vitamin alpha channel writes past its own end");
			}
			output.fill(value, dst, dst + count);
			dst += count;
		} else {
			if (dst + control > output.length) {
				throw invalidPicture("Vitamin alpha channel writes past its own end");
			}
			const available = Math.min(control, data.length - position);
			for (let index = 0; index < available; index += 1) {
				output[dst + index] = data[position + index] ?? 0;
			}
			position += available;
			remaining -= control;
			dst += control;
		}
	}
	return output;
}

/** The base picture as the four byte pixels the reference converts it to, with nothing for alpha yet. */
function baseAsBgra(
	pixels: Buffer,
	palette: Buffer | undefined,
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer | undefined {
	const depth = bitsPerPixel / 8;
	const tight = Buffer.alloc(width * height * depth, 0x00);
	const stride = sbiStride(width, bitsPerPixel);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(
			tight,
			row * width * depth,
			row * stride,
			row * stride + width * depth,
		);
	}
	const image: BmpImage = {
		width,
		height,
		bitsPerPixel,
		palette:
			palette ??
			(8 === bitsPerPixel ? Buffer.from(GREY_PALETTE) : Buffer.alloc(0)),
		pixels: tight,
	};
	if (16 === bitsPerPixel) image.masks = RGB565_MASKS;
	return toBgra32(image);
}

async function readHeader(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		return Buffer.from(await source.readAt(0n, HEADER_SIZE));
	} catch {
		return undefined;
	}
}

async function readLayout(source: ByteSource): Promise<MfcLayout | undefined> {
	const header = await readHeader(source);
	if (!header) return undefined;
	for (let index = 0; index < MARKER.length; index += 1) {
		if (header[4 + index] !== MARKER[index]) return undefined;
	}
	const alphaSize = header.readInt32LE(ALPHA_OFFSET_FIELD);
	if (alphaSize < HEADER_SIZE || BigInt(alphaSize) > source.size)
		return undefined;
	try {
		const base = Buffer.from(
			await source.readAt(BigInt(alphaSize), Number(source.size) - alphaSize),
		);
		const baseLayout = readSbiLayout(base);
		if (!baseLayout) return undefined;
		return {
			width: baseLayout.width,
			height: baseLayout.height,
			bitsPerPixel: baseLayout.bitsPerPixel,
			alphaSize,
		};
	} catch {
		return undefined;
	}
}

export const vitaminMfcImageDescriptor: FormatDescriptor = {
	id: "vitamin-mfc-image",
	name: "Vitamin image with alpha channel",
	extensions: ["mfc"],
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
			source: "ArcFormats/Vitamin/ImageMFC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vitaminMfcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vitaminMfcImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const layout = await readLayout(source);
		return layout !== undefined && DEPTHS.includes(layout.bitsPerPixel);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Vitamin picture with alpha");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.alphaSize),
				size: source.size - BigInt(layout.alphaSize),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 32,
				},
			}),
			// The colour and the alpha channel are unfolded and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Vitamin picture with alpha");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const alphaBytes = Math.floor((layout.width * layout.height) / 2);
		if (alphaBytes * 2 !== layout.width * layout.height) {
			throw invalidPicture(
				"Vitamin alpha channel does not hold a whole number of pixels",
			);
		}
		const alpha = unpackMfcAlpha(
			stored,
			HEADER_SIZE,
			layout.alphaSize - HEADER_SIZE,
			alphaBytes,
		);
		const base = stored.subarray(layout.alphaSize);
		const baseLayout = readSbiLayout(base);
		if (!baseLayout) {
			throw invalidPicture("Not a Vitamin picture with alpha");
		}
		const picture = unpackSbi(base, baseLayout);
		const pixels = baseAsBgra(
			picture.pixels,
			picture.palette,
			layout.width,
			layout.height,
			layout.bitsPerPixel,
		);
		if (!pixels) {
			throw invalidPicture("Not a Vitamin picture with alpha");
		}
		// `LsbBitStream.GetBits (4)` reads the low nibble of every alpha byte first, and the reference widens
		// it by repeating its four bits.
		for (let index = 0; index < layout.width * layout.height; index += 1) {
			const byte = alpha[index >> 1] ?? 0;
			const nibble = 0 === (index & 1) ? byte & 0x0f : byte >> 4;
			pixels[index * 4 + 3] = nibble * 0x11;
		}
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
