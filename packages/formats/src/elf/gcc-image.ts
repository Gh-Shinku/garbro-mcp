// Port of GARbro "ArcFormats/elf/ImageGCC.cs" (tag "GCC", class GccFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. Four walks of a picture of twenty four places to
// a place of the engine of AI5WIN: the places of the colours of it stand of a walk of the words of the LZSS
// engine or of a walk of its own, and the alpha of it of a walk of the counts of them.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 12;
/** The places of the head of a picture of a mask, of which the walks of the colours and the alpha stand. */
const MASKED_OFFSET = 0x20;
const PLAIN_OFFSET = 0x14;
/** The counts of the places of the file of a colour of the picture. */
const COLOR_PLACES = 3;

export const GCC_SIGNATURES: ReadonlyMap<
	number,
	{ masked: boolean; alt: boolean }
> = new Map([
	[0x6e343247, { masked: false, alt: false }], // 'G24n'
	[0x6d343247, { masked: true, alt: false }], // 'G24m'
	[0x6e343252, { masked: false, alt: true }], // 'R24n'
	[0x6d343252, { masked: true, alt: true }], // 'R24m'
]);

export interface GccLayout {
	signature: number;
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	masked: boolean;
	alt: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `GccFormat.ReadMetaData`. */
export function readGccLayout(data: Buffer): GccLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const signature = data.readUInt32LE(0);
	const walk = GCC_SIGNATURES.get(signature);
	if (!walk) return undefined;
	const width = data.readUInt16LE(8);
	const height = data.readUInt16LE(10);
	if (0 === width || 0 === height) return undefined;
	return {
		signature,
		offsetX: data.readInt16LE(4),
		offsetY: data.readInt16LE(6),
		width,
		height,
		masked: walk.masked,
		alt: walk.alt,
	};
}

/** `GccFormat.Reader.FlipPixels`: the walks of the picture stand of the row of the file the last first. */
function flipRows(pixels: Buffer, stride: number, height: number): Buffer {
	const flipped: Buffer = Buffer.alloc(pixels.length, 0x00);
	let destination = 0;
	for (let source = stride * (height - 1); source >= 0; source -= stride) {
		pixels.copy(flipped, destination, source, source + stride);
		destination += stride;
	}
	return flipped;
}

/** `GccFormat.Reader`: the walk of the bits of the alpha of a picture, of the places of the file of it. */
class GccReader {
	private index: number;
	private current = 0;
	private mask = 0x80;

	constructor(
		private readonly data: Buffer,
		at: number,
	) {
		this.index = at;
	}

	/** `GccFormat.Reader.NextBit`: the places of a walk of a picture, of the lowest place of a place first. */
	private nextBit(): boolean {
		this.mask <<= 1;
		if (0x100 === this.mask) {
			if (this.index >= this.data.length) {
				throw invalidPicture("The places of the walk stand short of the file");
			}
			this.current = this.data[this.index] ?? 0;
			this.index += 1;
			this.mask = 1;
		}
		return 0 !== (this.current & this.mask);
	}

	/** `GccFormat.Reader.ReadCount`: a count of the places of the walk, of the places of the file of it. */
	readCount(): number {
		let result = 1;
		let bits = 0;
		while (!this.nextBit()) bits += 1;
		while (0 !== bits) {
			bits -= 1;
			result <<= 1;
			if (this.nextBit()) result |= 1;
		}
		return result;
	}

	/** `GccFormat.Reader.UnpackAlpha`: the places of the alpha of a picture, of the counts of them. */
	unpackAlpha(width: number, height: number, at: number): Buffer {
		const total = width * height;
		const alpha: Buffer = Buffer.alloc(total, 0x00);
		let source = at;
		let destination = 0;
		while (destination < total) {
			if (this.nextBit()) {
				const count = this.readCount();
				const value = this.byteAt(source);
				source += 1;
				for (let place = 0; place < count && destination < total; place += 1) {
					alpha[destination] = value;
					destination += 1;
				}
			} else {
				alpha[destination] = this.byteAt(source);
				destination += 1;
				source += 1;
			}
		}
		return alpha;
	}

	private byteAt(at: number): number {
		if (at >= this.data.length) {
			throw invalidPicture("The places of the alpha stand short of the file");
		}
		return this.data[at] ?? 0;
	}
}

/** `GccFormat.Reader.Convert24To32`: the places of the colours of a picture, of the alpha of it. */
function convertToBgra(
	pixels: Buffer,
	alpha: Buffer,
	layout: GccLayout,
	alphaWidth: number,
	alphaHeight: number,
): Buffer {
	const converted: Buffer = Buffer.alloc(
		layout.width * layout.height * 4,
		0x00,
	);
	let destination = 0;
	let alphaRow = alphaWidth * (alphaHeight - layout.offsetY - 1);
	for (
		let row = layout.width * (layout.height - 1);
		row >= 0;
		row -= layout.width
	) {
		let source = row * COLOR_PLACES;
		for (let x = 0; x < layout.width; x += 1) {
			const place = alphaRow + layout.offsetX + x;
			if (place < 0 || place >= alpha.length) {
				throw invalidPicture(
					"The alpha of the picture stands beyond the places of it",
				);
			}
			converted[destination] = pixels[source] ?? 0;
			converted[destination + 1] = pixels[source + 1] ?? 0;
			converted[destination + 2] = pixels[source + 2] ?? 0;
			converted[destination + 3] = alpha[place] ?? 0;
			destination += 4;
			source += COLOR_PLACES;
		}
		alphaRow -= alphaWidth;
	}
	return converted;
}

/** `GccFormat.Reader.Unpack`: the places of the picture, handed over as a bitmap. */
export function unpackGccPicture(data: Buffer, layout: GccLayout): Buffer {
	if (layout.alt) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"the R24 pictures of the AI5WIN engine stand of a walk of their own",
		);
	}
	const expected = layout.width * layout.height * COLOR_PLACES;
	// The walks of the alpha of a picture stand behind the walk of the colours of it: the walk of the LZSS
	// engine stands of the places of the picture alone, as the walk of the reference stands of them.
	const pixels = inflateLzss(
		data.subarray(layout.masked ? MASKED_OFFSET : PLAIN_OFFSET),
		{ outputLength: expected },
	);
	const flipped = flipRows(pixels, layout.width * COLOR_PLACES, layout.height);
	if (!layout.masked) {
		return writeBmp24(layout.width, layout.height, flipped);
	}
	const alphaWidth = data.readUInt16LE(0x18);
	const alphaHeight = data.readUInt16LE(0x1a);
	const bitsAt = MASKED_OFFSET + data.readInt32LE(0x0c);
	const alphaAt = bitsAt + data.readInt32LE(0x1c);
	if (bitsAt < 0 || bitsAt > data.length) {
		throw invalidPicture("The walk of the alpha stands beyond the file");
	}
	const reader = new GccReader(data, bitsAt);
	const alpha = reader.unpackAlpha(alphaWidth, alphaHeight, alphaAt);
	if (
		alphaWidth < layout.offsetX + layout.width ||
		alphaHeight < layout.offsetY + layout.height
	) {
		return writeBmp24(layout.width, layout.height, flipped);
	}
	const converted = convertToBgra(
		pixels,
		alpha,
		layout,
		alphaWidth,
		alphaHeight,
	);
	return writeBmp32(layout.width, layout.height, converted);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const elfGccImageDescriptor: FormatDescriptor = {
	id: "elf-gcc-image",
	name: "AI5WIN engine image",
	extensions: ["g24", "r24"],
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
			source: "ArcFormats/elf/ImageGCC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const elfGccImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: elfGccImageDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from("G24n", "latin1") },
			{ bytes: Buffer.from("G24m", "latin1") },
			{ bytes: Buffer.from("R24n", "latin1") },
			{ bytes: Buffer.from("R24m", "latin1") },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readGccLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readGccLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the AI5WIN engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.masked ? 32 : 24,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.masked ? 32 : 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGccLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the AI5WIN engine");
		return Readable.from([unpackGccPicture(data, layout)]);
	},
});
