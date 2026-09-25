// Port of GARbro "ArcFormats/MAI/ImageMAI.cs" (tags "CM/MAI", "AM/MAI" and "MSK/MAI"), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. Three pictures of the engine of MAI: a picture
// of the places of a colour of the file themselves, a picture of an alpha of its own behind them and a
// picture of the places of a colour map, of a run walk of the places of the file.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The count of the words of a colour map of a picture of the engine. */
const PALETTE_SIZE = 0x100;
/** The count of the places of the file of a colour map of a picture. */
const PALETTE_BYTES = PALETTE_SIZE * 4;
const CM_HEAD_SIZE = 0x20;
const AM_HEAD_SIZE = 0x30;
/** The places of the colour map of a picture of the places of a colour of the file. */
const MSK_DATA_OFFSET = 0x10 + PALETTE_BYTES;
/** The colour of a place of a colour map of eight places to a place that stands of no alpha. */
const TRANSPARENT = [0x00, 0xfe, 0x00] as const;
/** The count the alpha of a place of the picture grows by where it stands of a place of the file. */
const ALPHA_SCALE = 0x11;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `RleDecoder.Unpack`: a walk of the runs of the places of a picture. A place of the walk of less than
 * `0x80` stands of that count of the places of the picture as they stand behind it; a place of `0x80`
 * stands of no walk; a place above it stands of that count less `0x80` of the places of the file, all of
 * them the count of the places of a place behind it.
 */
export function unpackMaiRle(
	input: Buffer,
	inputSize: number,
	output: Buffer,
	pixelSize: number,
): void {
	let read = 0;
	let destination = 0;
	while (read < inputSize && destination < output.length) {
		const code = input[read];
		if (code === undefined) {
			throw invalidPicture("The places of the walk stand short of the file");
		}
		read += 1;
		if (0x80 === code) {
			throw invalidPicture(
				"A count of the places of a walk of no walk stands in the file",
			);
		}
		if (code < 0x80) {
			const count = Math.min(code * pixelSize, output.length - destination);
			input.copy(output, destination, read, read + count);
			read += count;
			destination += count;
		} else {
			let count = code & 0x7f;
			if (read + pixelSize > input.length) {
				throw invalidPicture("The places of the walk stand short of the file");
			}
			input.copy(output, destination, read, read + pixelSize);
			read += pixelSize;
			const source = destination;
			destination += pixelSize;
			count = Math.min((count - 1) * pixelSize, output.length - destination);
			if (source < 0)
				throw invalidPicture("The places of the walk stand short of the file");
			copyOverlapped(output, source, destination, count);
			destination += count;
		}
	}
}

/** `ImageFormat.ReadPalette` of a picture of a colour map of three places to a colour. */
function readPalette(data: Buffer, at: number, colors: number): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_BYTES, 0x00);
	const count = Math.min(colors, PALETTE_SIZE);
	for (let place = 0; place < count; place += 1) {
		const source = at + place * 3;
		if (source + 3 > data.length) {
			throw invalidPicture(
				"The words of the colour map stand short of the file",
			);
		}
		palette[place * 4] = data[source] ?? 0;
		palette[place * 4 + 1] = data[source + 1] ?? 0;
		palette[place * 4 + 2] = data[source + 2] ?? 0;
	}
	return palette;
}

/** The places of the picture of the row of the file the first, of the row of the display the first. */
function flipRows(pixels: Buffer, stride: number, height: number): Buffer {
	const flipped: Buffer = Buffer.alloc(pixels.length, 0x00);
	let destination = 0;
	for (let source = stride * (height - 1); source >= 0; source -= stride) {
		pixels.copy(flipped, destination, source, source + stride);
		destination += stride;
	}
	return flipped;
}

export interface CmLayout {
	width: number;
	height: number;
	colors: number;
	pixelSize: number;
	compressed: boolean;
	dataOffset: number;
	dataLength: number;
}

/** `CmFormat.ReadMetaData`. */
export function readCmLayout(data: Buffer): CmLayout | undefined {
	if (data.length < CM_HEAD_SIZE) return undefined;
	if (data[0] !== 0x43 || data[1] !== 0x4d) return undefined; // 'CM'
	if (data.readUInt32LE(2) !== data.length) return undefined;
	if (1 !== data[0x0e]) return undefined;
	const width = data.readUInt16LE(6);
	const height = data.readUInt16LE(8);
	const pixelSize = (data[0x0c] ?? 0) >> 3;
	if (0 === width || 0 === height) return undefined;
	if (1 !== pixelSize && 3 !== pixelSize && 4 !== pixelSize) return undefined;
	const dataLength = data.readUInt32LE(0x14);
	if (dataLength > data.length) return undefined;
	return {
		width,
		height,
		colors: data.readUInt16LE(0x0a),
		pixelSize,
		compressed: 0 !== data[0x0d],
		dataOffset: data.readUInt32LE(0x10),
		dataLength,
	};
}

/** `CmFormat.Reader.Unpack`: the places of the picture, handed over as a bitmap. */
export function unpackCmPicture(data: Buffer, layout: CmLayout): Buffer {
	if (layout.dataOffset + layout.dataLength > data.length) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	const stride = layout.width * layout.pixelSize;
	const size = stride * layout.height;
	const pixels: Buffer = Buffer.alloc(size, 0x00);
	const source = data.subarray(layout.dataOffset);
	if (layout.compressed) {
		unpackMaiRle(source, layout.dataLength, pixels, layout.pixelSize);
	} else {
		if (layout.dataLength < size) {
			throw invalidPicture("The places of the picture stand short of the file");
		}
		source.copy(pixels, 0, 0, size);
	}
	const flipped = flipRows(pixels, stride, layout.height);
	if (1 === layout.pixelSize) {
		return writeBmp8Palette(
			layout.width,
			layout.height,
			flipped,
			readPalette(data, CM_HEAD_SIZE, layout.colors),
		);
	}
	if (3 === layout.pixelSize) {
		return writeBmp24(layout.width, layout.height, flipped);
	}
	return writeBmp32(layout.width, layout.height, flipped);
}

export interface AmLayout extends CmLayout {
	maskWidth: number;
	maskHeight: number;
	maskOffset: number;
	maskLength: number;
	maskCompressed: boolean;
}

/** `AmFormat.ReadMetaData`. */
export function readAmLayout(data: Buffer): AmLayout | undefined {
	if (data.length < AM_HEAD_SIZE) return undefined;
	if (data[0] !== 0x41 || data[1] !== 0x4d) return undefined; // 'AM'
	if (data.readUInt32LE(2) !== data.length) return undefined;
	const kind = data[0x16] ?? 0;
	if ((1 !== kind && 2 !== kind) || 1 !== data[0x18]) return undefined;
	const width = data.readUInt16LE(6);
	const height = data.readUInt16LE(8);
	const pixelSize = (data[0x14] ?? 0) >> 3;
	if (0 === width || 0 === height) return undefined;
	if (1 !== pixelSize && 3 !== pixelSize && 4 !== pixelSize) return undefined;
	const dataLength = data.readUInt32LE(0x1e);
	const maskLength = data.readUInt32LE(0x26);
	if (dataLength + maskLength > data.length) return undefined;
	return {
		width,
		height,
		colors: data.readUInt16LE(0x12),
		pixelSize,
		compressed: 0 !== data[0x15],
		dataOffset: data.readUInt32LE(0x1a),
		dataLength,
		maskWidth: data.readUInt16LE(0x0a),
		maskHeight: data.readUInt16LE(0x0c),
		maskOffset: data.readUInt32LE(0x22),
		maskLength,
		maskCompressed: 0 !== data[0x2a],
	};
}

/** `AmFormat.Reader.Unpack`: the places of the picture and of the alpha of it, handed over as a bitmap. */
export function unpackAmPicture(data: Buffer, layout: AmLayout): Buffer {
	if (
		layout.dataOffset + layout.dataLength > data.length ||
		layout.maskOffset + layout.maskLength > data.length
	) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	const stride = layout.width * layout.pixelSize;
	const size = stride * layout.height;
	const pixels: Buffer = Buffer.alloc(size, 0x00);
	if (layout.compressed) {
		unpackMaiRle(
			data.subarray(layout.dataOffset),
			layout.dataLength,
			pixels,
			layout.pixelSize,
		);
	} else {
		if (layout.dataLength < size) {
			throw invalidPicture("The places of the picture stand short of the file");
		}
		data.copy(pixels, 0, layout.dataOffset, layout.dataOffset + size);
	}
	const maskSize = layout.maskCompressed
		? layout.maskWidth * layout.maskHeight
		: layout.maskLength;
	const alpha: Buffer = Buffer.alloc(maskSize, 0x00);
	if (layout.maskCompressed) {
		unpackMaiRle(data.subarray(layout.maskOffset), layout.maskLength, alpha, 1);
	} else {
		data.copy(alpha, 0, layout.maskOffset, layout.maskOffset + maskSize);
	}
	const palette =
		1 === layout.pixelSize
			? readPalette(data, AM_HEAD_SIZE, layout.colors)
			: undefined;
	const converted: Buffer = Buffer.alloc(
		layout.width * layout.height * 4,
		0x00,
	);
	for (let row = 0; row < layout.height; row += 1) {
		let source = (layout.height - 1 - row) * stride;
		let destination = row * layout.width * 4;
		for (let x = 0; x < layout.width; x += 1) {
			const place = row * layout.width + x;
			let value = alpha[place] ?? 0;
			if (1 === layout.pixelSize) {
				if (!palette) {
					throw invalidPicture(
						"The colour map of the picture stands of no words",
					);
				}
				const index = (pixels[source] ?? 0) * 4;
				const blue = palette[index] ?? 0;
				const green = palette[index + 1] ?? 0;
				const red = palette[index + 2] ?? 0;
				if (
					blue === TRANSPARENT[0] &&
					green === TRANSPARENT[1] &&
					red === TRANSPARENT[2]
				) {
					value = 0;
				} else if (0 === value) {
					value = 0xff;
				} else {
					value = (value * ALPHA_SCALE) & 0xff;
				}
				converted[destination] = blue;
				converted[destination + 1] = green;
				converted[destination + 2] = red;
			} else {
				converted[destination] = pixels[source] ?? 0;
				converted[destination + 1] = pixels[source + 1] ?? 0;
				converted[destination + 2] = pixels[source + 2] ?? 0;
			}
			converted[destination + 3] = value;
			source += layout.pixelSize;
			destination += 4;
		}
	}
	return writeBmp32(layout.width, layout.height, converted);
}

export interface MskLayout {
	width: number;
	height: number;
	compressed: boolean;
	dataLength: number;
}

/** `MaskFormat.ReadMetaData`. */
export function readMskLayout(data: Buffer): MskLayout | undefined {
	if (data.length < MSK_DATA_OFFSET) return undefined;
	if (data.readUInt32LE(0) !== data.length) return undefined;
	const width = data.readUInt32LE(4);
	const height = data.readUInt32LE(8);
	const compressed = data.readInt32LE(0x0c);
	if (0 === width || 0 === height) return undefined;
	if (compressed > 1) return undefined;
	if (0 === compressed && width * height + MSK_DATA_OFFSET !== data.length) {
		return undefined;
	}
	return {
		width,
		height,
		compressed: 1 === compressed,
		dataLength: data.length - MSK_DATA_OFFSET,
	};
}

/** `MaskFormat.Read`: the places of the picture, handed over as a bitmap. */
export function unpackMskPicture(data: Buffer, layout: MskLayout): Buffer {
	const palette = Buffer.from(data.subarray(0x10, 0x10 + PALETTE_BYTES));
	const size = layout.width * layout.height;
	const pixels: Buffer = Buffer.alloc(size, 0x00);
	const source = data.subarray(MSK_DATA_OFFSET);
	if (layout.compressed) {
		unpackMaiRle(source, layout.dataLength, pixels, 1);
	} else {
		data.copy(pixels, 0, MSK_DATA_OFFSET, MSK_DATA_OFFSET + size);
	}
	return writeBmp8Palette(layout.width, layout.height, pixels, palette);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function pictureDescriptor(
	id: string,
	name: string,
	extensions: string[],
	source: string,
): FormatDescriptor {
	return {
		id,
		name,
		extensions,
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
				source,
				license: "MIT",
				commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
			},
		],
	};
}

function pictureEntry(
	layout: { width: number; height: number; pixelSize: number },
	size: bigint,
): FixedEntry {
	return {
		...createFixedEntry({
			id: 0,
			path: "image.bmp",
			offset: 0n,
			size,
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8 * layout.pixelSize,
			},
		}),
		sizeKnown: false,
	};
}

export const maiCmImageDescriptor: FormatDescriptor = pictureDescriptor(
	"mai-cm-image",
	"MAI image",
	["cmp"],
	"ArcFormats/MAI/ImageMAI.cs",
);

export const maiCmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: maiCmImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("CM", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(CM_HEAD_SIZE)) return false;
		try {
			return readCmLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readCmLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the MAI engine");
		return {
			entries: [pictureEntry(layout, source.size)],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8 * layout.pixelSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readCmLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the MAI engine");
		return Readable.from([unpackCmPicture(data, layout)]);
	},
});

export const maiAmImageDescriptor: FormatDescriptor = pictureDescriptor(
	"mai-am-image",
	"MAI image with an alpha",
	["amp", "ami"],
	"ArcFormats/MAI/ImageMAI.cs",
);

export const maiAmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: maiAmImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("AM", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(AM_HEAD_SIZE)) return false;
		try {
			return readAmLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readAmLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the MAI engine");
		return {
			entries: [pictureEntry(layout, source.size)],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readAmLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the MAI engine");
		return Readable.from([unpackAmPicture(data, layout)]);
	},
});

export const maiMskImageDescriptor: FormatDescriptor = pictureDescriptor(
	"mai-msk-image",
	"MAI colour map image",
	["msk"],
	"ArcFormats/MAI/ImageMAI.cs",
);

export const maiMskImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: maiMskImageDescriptor,
	// The reference stands of no mark of its own: the head of the picture is what decides.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(MSK_DATA_OFFSET)) return false;
		try {
			return readMskLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readMskLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the MAI engine");
		return {
			entries: [pictureEntry({ ...layout, pixelSize: 1 }, source.size)],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readMskLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the MAI engine");
		return Readable.from([unpackMskPicture(data, layout)]);
	},
});
