// Format reference: GARBro "Legacy/Gsx/ImageK4.cs", class `K4Format` with the `K4Reader` that unpacks
// through it. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'K4' and the two version bytes the reference compares as well. */
const SIGNATURE = Buffer.from([0x4b, 0x34, 0x01, 0x02]);
/** The first header carries the dimensions, the alpha mode and the frame count. */
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const ALPHA_MODE_FIELD = 0x0b;
const FRAME_COUNT_FIELD = 0x0c;
/** A second header sits at 0x30 and holds the values the reader really uses. */
const BASE_OFFSET = 0x30;
const PAYLOAD_WIDTH_FIELD = BASE_OFFSET;
const PAYLOAD_HEIGHT_FIELD = BASE_OFFSET + 2;
const PAYLOAD_BITS_FIELD = 0x3c;
const PAYLOAD_FLAGS_FIELD = 0x3e;
const ALPHA_POSITION_FIELD = 0x44;
const CONTROL_LENGTH_FIELD = 0x54;
/** The control plane begins here, and its length counts the header behind it. */
const CONTROL_BASE = 0x58;
const CONTROL_LENGTH_BASE = 0x10;
/** The one flag the reader looks at: whether a pixel may be built from the one above it. */
const DELTA_FLAG = 1;
/** The two ways an alpha channel is stored. */
const ALPHA_MODE_FF = 0xff;
const ALPHA_MODE_FE = 0xfe;
const ALPHA_MODES = [ALPHA_MODE_FF, ALPHA_MODE_FE];
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface K4Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	alphaMode: number;
	frameCount: number;
	/** Whether a pixel may be stored as a difference from the one above it. */
	delta: boolean;
	/** Where the alpha section begins, or nothing when the picture has no alpha channel. */
	alphaPosition: number | undefined;
	/** The control plane and the stream behind it. */
	controlOffset: number;
	controlBytes: number;
	streamOffset: number;
	/** The row length the pixels are stored with, rounded up to four bytes. */
	stride: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `K4Format.ReadMetaData` and the reading half of `K4Reader`'s constructor. The picture carries two
 * headers: the first holds the dimensions, the alpha mode and the frame count that decide whether the file
 * is one of these at all, and the second, at 0x30, holds the values the reader actually unpacks with --
 * among them the bit depth, the flag that lets a pixel stand as a difference, the place the alpha section
 * begins and the length of the control plane.
 */
export function readK4Layout(data: Buffer): K4Layout | undefined {
	if (data.length < CONTROL_BASE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const frameCount = data.readInt16LE(FRAME_COUNT_FIELD);
	if (frameCount <= 0) return undefined;
	const declaredWidth = data.readUInt16LE(WIDTH_FIELD);
	const declaredHeight = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === declaredWidth || 0 === declaredHeight) return undefined;

	const width = data.readUInt16LE(PAYLOAD_WIDTH_FIELD);
	const height = data.readUInt16LE(PAYLOAD_HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	const bitsPerPixel = data.readUInt16LE(PAYLOAD_BITS_FIELD);
	if (bitsPerPixel !== 24 && bitsPerPixel !== 32) return undefined;
	const pixelSize = bitsPerPixel / 8;
	const stride = (width * pixelSize + 3) & ~3;
	const total = height * stride;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;

	const alphaPosition = data.readUInt32LE(ALPHA_POSITION_FIELD);
	const controlBytes =
		data.readInt32LE(CONTROL_LENGTH_FIELD) - CONTROL_LENGTH_BASE;
	if (controlBytes < 0) return undefined;
	const streamOffset = CONTROL_BASE + controlBytes;
	if (streamOffset > data.length) return undefined;
	if (0 !== alphaPosition && alphaPosition >= data.length) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		alphaMode: data[ALPHA_MODE_FIELD] ?? 0,
		frameCount,
		delta: 0 !== (data.readUInt16LE(PAYLOAD_FLAGS_FIELD) & DELTA_FLAG),
		alphaPosition: 0 === alphaPosition ? undefined : alphaPosition,
		controlOffset: CONTROL_BASE,
		controlBytes,
		streamOffset,
		stride,
	};
}

/**
 * `K4Reader.Unpack`: the control plane holds one bit to a step of the picture, and the stream behind it
 * holds the steps themselves, most significant bit first. A bit of ones is a pixel: stored as it stands
 * when the picture is not a difference one, and otherwise as a nine bit step added to the pixel above it,
 * with the first row stored whole because it has no row above it. A bit of nothing is a run, and the bit
 * behind it decides how wide its place and its length are -- a place of fourteen bits and a length of four,
 * three longer than the count, or a place of nine and a length of three, two longer.
 *
 * When the picture is a difference one, a run is not copied but rebuilt: every byte of it is the byte it
 * names, plus the one above and to the right of that by the width of its own place, less the one above the
 * byte itself. Two dimension prediction of that shape reaches outside the picture easily, and the
 * reference would throw where this port refuses the picture.
 */
export function decodeK4(data: Buffer, layout: K4Layout): Buffer {
	const pixelSize = layout.bitsPerPixel / 8;
	const output: Buffer = Buffer.alloc(layout.height * layout.stride, 0x00);
	const controls = new MsbBitReader(
		data.subarray(layout.controlOffset, layout.streamOffset),
	);
	const stream = new MsbBitReader(data, layout.streamOffset);
	// The reference lets a stream that has ended read as ones, which is what its own cast writes down.
	const bits = (count: number): number => stream.tryReadBits(count);
	let destination = 0;
	while (destination < output.length) {
		const control = controls.tryReadBits(1);
		if (-1 === control) break;
		if (0 !== control) {
			if (!layout.delta) {
				output[destination] = bits(8) & 0xff;
				destination += 1;
			} else if (destination >= pixelSize) {
				const above = output[destination - pixelSize] ?? 0;
				output[destination] = (above + bits(9) + 1) & 0xff;
				destination += 1;
			} else {
				output[destination] = bits(9) & 0xff;
				destination += 1;
			}
			continue;
		}
		let place: number;
		let count: number;
		if (0 !== controls.tryReadBits(1)) {
			// A control bit of ones -- and one that is missing, which the reference reads the same way.
			place = bits(14);
			count = bits(4) + 3;
		} else {
			place = bits(9);
			count = bits(3) + 2;
		}
		const source = destination - place - 1;
		const length = Math.min(count, output.length - destination);
		if (!layout.delta || destination < pixelSize) {
			if (!copyOverlapped(output, source, destination, length)) {
				throw invalidImage("A GSX run reaches outside its picture");
			}
			destination += length;
			continue;
		}
		for (let index = 0; index < length; index += 1) {
			const at = source + index;
			const diagonal = at + place - pixelSize + 1;
			const above = at - pixelSize;
			if (at < 0 || diagonal < 0 || diagonal >= output.length || above < 0) {
				throw invalidImage("A GSX run reaches outside its picture");
			}
			output[destination + index] =
				((output[at] ?? 0) + (output[diagonal] ?? 0) - (output[above] ?? 0)) &
				0xff;
		}
		destination += length;
	}
	return output;
}

/**
 * `K4Reader.UnpackAlphaFF`: the alpha section opens with one place to a row, and each row holds runs of its
 * own -- a value, and a count of pixels to hand it to, where a value of nothing leaves the pixels it covers
 * fully transparent. The rows are stored from the bottom up, as the pixels are, so they are turned over
 * while they are joined to the alpha channel.
 */
function unpackAlphaFF(
	data: Buffer,
	layout: K4Layout,
	pixels: Buffer,
	alphaPosition: number,
): Buffer {
	const offsets: number[] = [];
	for (let row = 0; row < layout.height; row += 1) {
		const at = alphaPosition + row * 4;
		if (at + 4 > data.length) {
			throw invalidImage("The alpha places of the picture are cut short");
		}
		offsets.push(data.readInt32LE(at));
	}
	const output: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let destination = 0;
	for (let y = 0; y < layout.height; y += 1) {
		let at = alphaPosition + (offsets[y] ?? 0);
		if (at > data.length) {
			throw invalidImage("A row of alpha values lies outside the picture");
		}
		let source = (layout.height - y - 1) * layout.stride;
		let alpha = destination + 3;
		for (let x = 0; x < layout.width; x += 1) {
			output[destination] = pixels[source] ?? 0;
			output[destination + 1] = pixels[source + 1] ?? 0;
			output[destination + 2] = pixels[source + 2] ?? 0;
			destination += 4;
			source += layout.bitsPerPixel / 8;
		}
		let covered = 0;
		while (covered < layout.width) {
			const value = data[at];
			const count = data[at + 1];
			if (undefined === value || undefined === count) {
				throw invalidImage("The alpha values of a row are cut short");
			}
			at += 2;
			const width = Math.min(count, layout.width - covered);
			covered += width;
			if (value > 0) {
				const scaled = (value * 0xff) >> 7;
				for (let index = 0; index < width; index += 1) {
					output[alpha] = scaled;
					alpha += 4;
				}
			} else {
				alpha += 4 * width;
			}
		}
	}
	return output;
}

/**
 * `K4Reader.UnpackAlphaFE`: the same rows in the same order, but the alpha values are one bit each, eight
 * pixels to a byte and the lowest bit first, where a set bit is opaque.
 */
function unpackAlphaFE(
	data: Buffer,
	layout: K4Layout,
	pixels: Buffer,
	alphaPosition: number,
): Buffer {
	const output: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let at = alphaPosition;
	for (let y = 0; y < layout.height; y += 1) {
		let source = (layout.height - y - 1) * layout.stride;
		let alpha = y * layout.width * 4 + 3;
		for (let x = 0; x < layout.width; x += 1) {
			output[alpha - 3] = pixels[source] ?? 0;
			output[alpha - 2] = pixels[source + 1] ?? 0;
			output[alpha - 1] = pixels[source + 2] ?? 0;
			alpha += 4;
			source += layout.bitsPerPixel / 8;
		}
		for (let x = 0; x < layout.width; x += 8) {
			const value = data[at];
			if (undefined === value) {
				throw invalidImage("The alpha bits of a row are cut short");
			}
			at += 1;
			const count = Math.min(8, layout.width - x);
			let bits = value;
			let target = y * layout.width * 4 + x * 4 + 3;
			for (let index = 0; index < count; index += 1) {
				output[target] = 0x00 !== (bits & 1) ? 0xff : 0x00;
				target += 4;
				bits >>= 1;
			}
		}
	}
	return output;
}

/**
 * `K4Reader.Unpack`: with no alpha section the pixels are handed over as they were unpacked, which is from
 * the bottom row up; with one, the alpha channel is joined to them and the rows end up from the top.
 */
export function decodeK4Picture(
	data: Buffer,
	layout: K4Layout,
): { pixels: Buffer; bottomUp: boolean } {
	const pixels = decodeK4(data, layout);
	const alphaPosition = layout.alphaPosition;
	if (undefined === alphaPosition) {
		return { pixels, bottomUp: true };
	}
	if (!ALPHA_MODES.includes(layout.alphaMode)) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`GSX alpha channel mode 0x${layout.alphaMode.toString(16)}`,
		);
	}
	const joined =
		layout.alphaMode === ALPHA_MODE_FF
			? unpackAlphaFF(data, layout, pixels, alphaPosition)
			: unpackAlphaFE(data, layout, pixels, alphaPosition);
	return { pixels: joined, bottomUp: false };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gsxK4ImageDescriptor: FormatDescriptor = {
	id: "gsx-k4-image",
	name: "GSX engine image",
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
			source: "Legacy/Gsx/ImageK4.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gsxK4ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsxK4ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(CONTROL_BASE)) return false;
		return readK4Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readK4Layout(await readStored(source));
		if (!layout) {
			throw invalidImage("Not a GSX picture");
		}
		const bitsPerPixel =
			undefined === layout.alphaPosition ? layout.bitsPerPixel : 32;
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
					bitsPerPixel,
				},
			}),
			// The picture is reserialised as a bitmap, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel,
				frameCount: layout.frameCount,
				alpha: undefined !== layout.alphaPosition,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readK4Layout(stored);
		if (!layout) {
			throw invalidImage("Not a GSX picture");
		}
		const { pixels, bottomUp } = decodeK4Picture(stored, layout);
		if (undefined === layout.alphaPosition) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, bottomUp),
			]);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, bottomUp),
		]);
	},
});
