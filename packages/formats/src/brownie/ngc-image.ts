// Format reference: GARbro "Legacy/Brownie/ImageNGC.cs", classes `NgcFormat`, `NgcMetaData` and `NgcReader`
// (a Brownie picture of whole rows, each told apart by a command byte and some of them run length coded or
// masked against the row above). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'NG/B', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("NG/B", "latin1");
const HEADER_SIZE = 0x20;
const WIDTH_FIELD = 0x14;
const HEIGHT_FIELD = 0x18;
const BITS_LINE_SIZE_FIELD = 0x1c;
/** The three commands that do not stand as they are, and the depth they all share. */
const COPY_ABOVE = 0;
const BITS_LINE = 2;
const RLE_LINE = 3;
const BYTES_PER_PIXEL = 3;
/** The depth the reference always reports, and the picture it is willing to hold. */
const DEPTH = 24;
const LIMIT = 256 * 1024 * 1024;

export interface NgcLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** How many bytes of the bit line a masked row reads. */
	bitsLineSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `NgcFormat.ReadMetaData`: the width and the height stand at `0x14` and `0x18` as words and the size of the
 * bit line at `0x1C`. The depth is always reported as twenty four bits.
 */
export function readNgcLayout(data: Buffer): NgcLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsLineSize = data.readInt32LE(BITS_LINE_SIZE_FIELD);
	if (width === 0 || height === 0 || bitsLineSize < 0) return undefined;
	const size = width * height * BYTES_PER_PIXEL;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height, bitsPerPixel: DEPTH, bitsLineSize };
}

/**
 * `NgcReader.Unpack`: the picture stands from `0x20` as whole rows, each behind a command byte. A command of
 * nothing repeats the row above it; one of two is a masked row, whose mask stands in as many bytes as the
 * head declares and whose set bits take a byte from the stream while the clear ones take the byte a row
 * above; one of three is three run length coded lines, one a channel, interleaved across the row; and any
 * other command leaves the row in the stream as it stands.
 *
 * A run length line reads a control byte: above nothing it is a count of one value that stands behind it, and
 * nothing it is a count of bytes that stand in the stream themselves, of which a count of nothing ends the
 * line. A masked row that reaches above the first row, and a stream that stops where a byte is wanted, are
 * both refused; the reference's own array read and its byte reads answer those with exceptions of their own
 * (documented deviations in the message only).
 */
export function unpackNgc(data: Buffer, layout: NgcLayout): Buffer {
	const stride = layout.width * BYTES_PER_PIXEL;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const bits: Buffer = Buffer.alloc(layout.bitsLineSize, 0x00);
	let position = HEADER_SIZE;
	let dst = 0;
	const readByte = (): number => {
		if (position >= data.length) {
			throw invalidPicture("Brownie picture is cut short of its stream");
		}
		const value = data[position] ?? 0;
		position += 1;
		return value;
	};
	const readRleLine = (start: number): void => {
		let at = start;
		while (at < output.length) {
			const control = readByte();
			if (control !== 0) {
				const value = readByte();
				for (let index = 0; index < control && at < output.length; index += 1) {
					output[at] = value;
					at += BYTES_PER_PIXEL;
				}
			} else {
				const count = readByte();
				if (count === 0) break;
				for (let index = 0; index < count && at < output.length; index += 1) {
					output[at] = readByte();
					at += BYTES_PER_PIXEL;
				}
			}
		}
	};
	const readBitsLine = (start: number): void => {
		if (position + bits.length > data.length) {
			throw invalidPicture("Brownie picture is cut short of its bit line");
		}
		data.copy(bits, 0, position, position + bits.length);
		position += bits.length;
		let at = start;
		let count = stride;
		let source = 0;
		while (source < bits.length && count > 0) {
			const byte = bits[source] ?? 0;
			for (let mask = 0x80; mask !== 0 && count > 0; mask >>= 1) {
				if (0 !== (byte & mask)) {
					output[at] = readByte();
				} else {
					if (at - stride < 0) {
						throw invalidPicture(
							"Brownie picture takes a masked byte from before its own start",
						);
					}
					output[at] = output[at - stride] ?? 0;
				}
				at += 1;
				count -= 1;
			}
			source += 1;
		}
	};
	while (dst < output.length) {
		if (position >= data.length) break;
		const command = data[position] ?? 0;
		position += 1;
		if (COPY_ABOVE === command) {
			if (dst - stride < 0) {
				throw invalidPicture(
					"Brownie picture repeats a row before its own start",
				);
			}
			output.copy(output, dst, dst - stride, dst - stride + stride);
		} else if (BITS_LINE === command) {
			readBitsLine(dst);
		} else if (RLE_LINE === command) {
			readRleLine(dst);
			readRleLine(dst + 1);
			readRleLine(dst + 2);
		} else {
			if (position + stride > data.length) {
				throw invalidPicture("Brownie picture is cut short of its stream");
			}
			data.copy(output, dst, position, position + stride);
			position += stride;
		}
		dst += stride;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<NgcLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readNgcLayout(header);
	} catch {
		return undefined;
	}
}

export const brownieNgcImageDescriptor: FormatDescriptor = {
	id: "brownie-ngc-image",
	name: "Brownie image format",
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
			source: "Legacy/Brownie/ImageNGC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const brownieNgcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: brownieNgcImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Brownie picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					bitsLineSize: layout.bitsLineSize,
				},
			}),
			// The rows are unfolded from a walk and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Brownie picture");
		}
		const stored = await readStored(source);
		const pixels = unpackNgc(stored, layout);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
