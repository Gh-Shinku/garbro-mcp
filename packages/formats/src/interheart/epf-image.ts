// Format reference: GARbro "ArcFormats/Interheart/ImageCandy.cs", class `CandyFormat` (Candy Soft image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	writeBmp1,
	writeBmp24,
	writeBmp32,
	writeBmp8Palette,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference registers two words, both of them a big endian header size: `0x0E00` is a fourteen byte header,
 * and `0x80020A00` is a ten byte one whose width happens to be 0x280. Its signature list ends in the zero that
 * makes it reachable from the pass that tries every remaining format, which is why a file whose first word is
 * neither of those is still taken when its header is sound.
 */
const SIGNATURE_BYTES: Buffer[] = [
	Buffer.from([0x00, 0x0e]),
	Buffer.from([0x00, 0x0a, 0x02, 0x80]),
];
const SHORT_HEADER_SIZE = 10;
const LONG_HEADER_SIZE = 14;
const MIN_HEADER_SIZE = 10;
const DIGITS = { maxWidth: 0xffff, maxHeight: 0xffff };
const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const MIN_MATCH = 3;
/** The pixel order the blocks are shuffled in: 0x90 for eight bit images, 0x50 for the rest. */
const BLOCK_SIZE_8BPP = 144;
const BLOCK_SIZE_OTHER = 80;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface EpfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	colors: number;
	version: number;
	headerSize: number;
	offsetX: number;
	offsetY: number;
	/** Bytes a pixel once the depth and the version have chosen one. */
	pixelSize: number;
	stride: number;
}

/** Bytes a pixel and the stride of a tight row, as the reference's decoder picks them. */
function pixelLayout(
	width: number,
	bitsPerPixel: number,
	version: number,
): { pixelSize: number; stride: number } {
	if (bitsPerPixel === 24 || (bitsPerPixel === 32 && version === 1)) {
		return { pixelSize: 3, stride: width * 3 };
	}
	if (bitsPerPixel === 32) return { pixelSize: 4, stride: width * 4 };
	if (bitsPerPixel === 1) return { pixelSize: 1, stride: (width + 7) >> 3 };
	return { pixelSize: 1, stride: width };
}

async function readLayout(source: ByteSource): Promise<EpfLayout | undefined> {
	if (source.size < BigInt(MIN_HEADER_SIZE)) return undefined;
	try {
		// A ten byte header needs no more than ten bytes; the reference reads fourteen outright and would fail on
		// a file that short, which is a deviation only for a truncated one.
		const available = Math.min(LONG_HEADER_SIZE, Number(source.size));
		const header = Buffer.from(await source.readAt(0n, available));
		const headerSize = header.readUInt16BE(0);
		let width: number;
		let height: number;
		let bitsPerPixel: number;
		let version: number;
		let colors: number;
		let offsetX = 0;
		let offsetY = 0;
		if (headerSize === LONG_HEADER_SIZE) {
			offsetX = header.readInt16BE(2);
			offsetY = header.readInt16BE(4);
			width = header.readUInt16BE(6);
			height = header.readUInt16BE(8);
			bitsPerPixel = header[0x0a] ?? 0;
			version = header[0x0b] ?? 0;
			colors = header.readUInt16BE(0x0c);
		} else if (headerSize === SHORT_HEADER_SIZE) {
			width = header.readUInt16BE(2);
			height = header.readUInt16BE(4);
			bitsPerPixel = header[6] ?? 0;
			version = header[7] ?? 0;
			colors = header.readUInt16BE(8);
		} else {
			return undefined;
		}
		if (version !== 1 && version !== 2) return undefined;
		if (bitsPerPixel < 1 || bitsPerPixel > 32) return undefined;
		if (width === 0 || height === 0) return undefined;
		if (width > DIGITS.maxWidth || height > DIGITS.maxHeight) return undefined;
		const { pixelSize, stride } = pixelLayout(width, bitsPerPixel, version);
		if (stride * height > MAX_IMAGE_BYTES) return undefined;
		// The palette, when there is one, sits between the header and the compressed pixels.
		const paletteSize = colors > 0 ? colors * 4 : 0;
		const dataOffset = headerSize + paletteSize;
		if (source.size < BigInt(dataOffset)) return undefined;
		return {
			width,
			height,
			bitsPerPixel,
			colors,
			version,
			headerSize,
			offsetX,
			offsetY,
			pixelSize,
			stride,
		};
	} catch {
		return undefined;
	}
}

/**
 * The reference's run length coded stream. A control byte's eight bits are first grouped into runs of equal
 * bits — each run is a bit value and a count — and each run then describes pixels: a set bit means that many
 * literal bytes, a clear bit that many two byte matches, of a low nibble plus three bytes copied from a twelve
 * bit window at an offset the rest of the word holds. The window starts as zeroes, so a match before any
 * literal reads them, and the window advances one byte for every byte written out.
 */
export function unpackCandyLz(input: Buffer, output: Buffer): void {
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	const bits = new Array<number>(16).fill(0);
	let position = 0;
	let framePosition = 0;
	let destination = 0;
	while (destination < output.length) {
		// The reference stops quietly at the end of the stream, leaving the rest of the pixels as they were.
		if (position >= input.length) break;
		let control = input[position] ?? 0;
		position += 1;
		bits[0] = control & 1;
		bits[1] = 1;
		let count = 0;
		for (let bit = 1; bit < 8; bit += 1) {
			control >>= 1;
			if (bits[2 * count] === (control & 1)) {
				bits[2 * count + 1] = (bits[2 * count + 1] ?? 0) + 1;
			} else {
				count += 1;
				bits[2 * count] = control & 1;
				bits[2 * count + 1] = 1;
			}
		}
		for (let run = 0; run <= count && destination < output.length; run += 1) {
			let remaining = bits[2 * run + 1] ?? 0;
			if (bits[2 * run] !== 0) {
				while (remaining > 0) {
					if (position >= input.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Candy Soft stream ends in the middle of a literal run",
						);
					}
					if (destination >= output.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Candy Soft literal run overflows the image",
						);
					}
					const value = input[position] ?? 0;
					position += 1;
					output[destination] = value;
					destination += 1;
					frame[framePosition & FRAME_MASK] = value;
					framePosition += 1;
					remaining -= 1;
				}
			} else {
				while (remaining > 0 && destination < output.length) {
					if (position + 2 > input.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Candy Soft stream ends in the middle of a match",
						);
					}
					const word = input.readUInt16LE(position);
					position += 2;
					const matchLength = Math.min(
						(word & 0x0f) + MIN_MATCH,
						output.length - destination,
					);
					let offset = word >> 4;
					for (let index = 0; index < matchLength; index += 1) {
						const value = frame[offset & FRAME_MASK] ?? 0;
						offset += 1;
						output[destination] = value;
						destination += 1;
						frame[framePosition & FRAME_MASK] = value;
						framePosition += 1;
					}
					remaining -= 1;
				}
			}
		}
	}
}

/**
 * The stored pixels are grouped into blocks whose **columns** are stored one after the other, and every pixel
 * is written back with its channels reversed. Eight bit images use blocks of 0x90 pixels a side, the rest 0x50.
 */
function restoreBlocks(
	stored: Buffer,
	width: number,
	height: number,
	pixelSize: number,
	stride: number,
	blockSize: number,
): Buffer {
	const pixels: Buffer = Buffer.alloc(stride * height, 0x00);
	let source = 0;
	for (let blockY = 0; blockY < height; blockY += blockSize) {
		for (let blockX = 0; blockX < width; blockX += blockSize) {
			let column = blockY * stride + blockX * pixelSize;
			const blockHeight = Math.min(blockSize, height - blockY);
			const blockWidth = Math.min(blockSize, width - blockX);
			for (let x = 0; x < blockWidth; x += 1) {
				let destination = column;
				for (let y = 0; y < blockHeight; y += 1) {
					if (pixelSize > 3) {
						pixels[destination + 3] = stored[source] ?? 0;
						pixels[destination + 2] = stored[source + 1] ?? 0;
						pixels[destination + 1] = stored[source + 2] ?? 0;
						pixels[destination] = stored[source + 3] ?? 0;
					} else if (pixelSize === 1) {
						pixels[destination] = stored[source] ?? 0;
					} else {
						pixels[destination + 2] = stored[source] ?? 0;
						pixels[destination + 1] = stored[source + 1] ?? 0;
						pixels[destination] = stored[source + 2] ?? 0;
					}
					destination += stride;
					source += pixelSize;
				}
				column += pixelSize;
			}
		}
	}
	return pixels;
}

export const interheartEpfImageDescriptor: FormatDescriptor = {
	id: "interheart-epf-image",
	name: "Candy Soft image",
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
			source: "ArcFormats/Interheart/ImageCandy.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const interheartEpfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: interheartEpfImageDescriptor,
	detection: {
		signatures: SIGNATURE_BYTES.map((bytes) => ({ bytes })),
		// The reference's signature list ends in a zero, so its second pass offers every remaining file to it.
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Candy Soft image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const metadata: Record<string, unknown> = {
			type: "image",
			width: layout.width,
			height: layout.height,
			bitsPerPixel: layout.bitsPerPixel,
			colors: layout.colors,
			version: layout.version,
		};
		if (layout.headerSize === LONG_HEADER_SIZE) {
			metadata.offsetX = layout.offsetX;
			metadata.offsetY = layout.offsetY;
		}
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "candy-lz",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Candy Soft image");
		const { width, height, bitsPerPixel, colors, pixelSize, stride } = layout;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const paletteSize = colors > 0 ? colors * 4 : 0;
		const stored: Buffer = Buffer.alloc(stride * height, 0x00);
		let palette: Buffer = Buffer.alloc(0);
		if (colors > 0) {
			const from = layout.headerSize;
			if (from + paletteSize > file.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Candy Soft palette is truncated",
				);
			}
			// Every entry is four bytes whose first is dropped, so the colours are red, green and blue in the
			// last three; a bitmap palette takes them blue, green, red and unused.
			palette = Buffer.alloc(colors * 4, 0x00);
			for (let index = 0; index < colors; index += 1) {
				const source = from + index * 4;
				palette[index * 4] = file[source + 3] ?? 0;
				palette[index * 4 + 1] = file[source + 2] ?? 0;
				palette[index * 4 + 2] = file[source + 1] ?? 0;
			}
		}
		const codedStart = layout.headerSize + paletteSize;
		unpackCandyLz(file.subarray(codedStart), stored);
		if (bitsPerPixel === 1) {
			// One bit pixels are stored already packed a row at a time, so nothing is shuffled or reversed.
			return Readable.from([
				writeBmp1(
					width,
					height,
					stored,
					palette.length > 0 ? palette : defaultPalette(2),
					false,
				),
			]);
		}
		const pixels = restoreBlocks(
			stored,
			width,
			height,
			pixelSize,
			stride,
			bitsPerPixel === 8 ? BLOCK_SIZE_8BPP : BLOCK_SIZE_OTHER,
		);
		let bitmap: Buffer;
		if (bitsPerPixel === 8) {
			bitmap = writeBmp8Palette(
				width,
				height,
				pixels,
				palette.length > 0 ? palette : defaultPalette(0x100),
				false,
			);
		} else if (pixelSize === 4) {
			bitmap = writeBmp32(width, height, pixels, false);
		} else {
			bitmap = writeBmp24(width, height, pixels, false);
		}
		return Readable.from([bitmap]);
	},
});

/**
 * A bitmap palette is what the reference asks WPF for, and it has none when the header declares no colours; the
 * port writes a grey ramp rather than leaving the image unreachable.
 */
function defaultPalette(entries: number): Buffer {
	const palette: Buffer = Buffer.alloc(entries * 4, 0x00);
	for (let index = 0; index < entries; index += 1) {
		const level = entries === 2 ? index * 0xff : index;
		palette[index * 4] = level;
		palette[index * 4 + 1] = level;
		palette[index * 4 + 2] = level;
	}
	return palette;
}
