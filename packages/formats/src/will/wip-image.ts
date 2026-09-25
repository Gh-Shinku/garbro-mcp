// Format reference: GARBro "ArcFormats/Will/ImageWIP.cs", class `WipFormat` with the `Reader` beside it. The
// same file's `WipOpener` (ArcFormats/Will/ArcWIP.cs) is the container of multi-frame pictures and is ported
// as `will-wip`: a `.wip` is claimed there, since that port lists every frame, while the extensions only a
// picture carries - `msk`, `mos`, `wi0` - reach this one. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word every picture of this engine opens with. */
const SIGNATURE = Buffer.from("WIPF", "latin1");
/** The head: how many frames, the depth, the size, where the picture stands and the length of its run. */
const FRAMES_FIELD = 4;
const BITS_FIELD = 6;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xc;
const OFFSET_X_FIELD = 0x10;
const OFFSET_Y_FIELD = 0x14;
// The word at 0x18 is read by the reference and never looked at, so nothing here reads it either.
const FRAME_SIZE_FIELD = 0x1c;
/** The records of the frames begin here and take twenty four bytes each, the head standing over them. */
const RECORDS_BASE = 8;
const RECORD_SIZE = 0x18;
/** The two depths this engine stores a picture in. */
const BITS_8 = 8;
const BITS_24 = 24;
/** The colour map a picture of eight bits carries, three bytes to a colour. */
const PALETTE_COLOURS = 0x100;
const PALETTE_BYTES = PALETTE_COLOURS * 3;
/** The window the run copies from, and the way its control bits are read. */
const WINDOW_SIZE = 0x1000;
const WINDOW_MASK = WINDOW_SIZE - 1;
const WINDOW_START = 1;
const CONTROL_REFILL = 0xff00;
const COPY_BIAS = 2;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface WipLayout {
	frames: number;
	bitsPerPixel: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	frameSize: number;
	/** Where the colour map stands, which only a picture of eight bits carries. */
	paletteOffset: number | undefined;
	/** Where the run of the frame begins. */
	dataOffset: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `WipFormat.ReadMetaData` and the reading half of the `Reader`'s constructor: the depth decides whether a
 * colour map stands in front of the frame, and the frame's own head stands over the records of the frames
 * that follow it - so the run begins after `frames` records of twenty four bytes, which for one frame is
 * the place the head itself ends at.
 */
export function readWipLayout(data: Buffer): WipLayout | undefined {
	if (data.length < RECORDS_BASE + RECORD_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const frames = data.readUInt16LE(FRAMES_FIELD);
	const bitsPerPixel = data.readUInt16LE(BITS_FIELD);
	if (BITS_8 !== bitsPerPixel && BITS_24 !== bitsPerPixel) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	if (width * height > LIMIT) return undefined;
	const frameSize = data.readUInt32LE(FRAME_SIZE_FIELD);
	const recordsEnd = RECORDS_BASE + RECORD_SIZE * frames;
	if (recordsEnd > data.length) return undefined;
	const paletteOffset = BITS_8 === bitsPerPixel ? recordsEnd : undefined;
	const dataOffset =
		recordsEnd + (undefined === paletteOffset ? 0 : PALETTE_BYTES);
	if (dataOffset > data.length) return undefined;
	if (frameSize > data.length - dataOffset) return undefined;
	return {
		frames,
		bitsPerPixel,
		width,
		height,
		offsetX: data.readInt32LE(OFFSET_X_FIELD),
		offsetY: data.readInt32LE(OFFSET_Y_FIELD),
		frameSize,
		paletteOffset,
		dataOffset,
	};
}

/**
 * The `Reader.Unpack` walk: the control bits are read from the lowest of a byte up and refilled from the
 * stream as they run out, a set bit stands for a byte of its own and a clear one for a copy out of a
 * kilobyte window - the place and the count sharing two bytes - which the window's own place follows. The
 * walk reads exactly the frame's stored length, and a run that reaches past the picture is refused.
 */
export function unpackWipRun(
	data: Buffer,
	dataOffset: number,
	frameSize: number,
	outputSize: number,
): Buffer {
	const pixels = Buffer.alloc(outputSize, 0x00);
	const window = Buffer.alloc(WINDOW_SIZE, 0x00);
	let destination = 0;
	let windowIndex = WINDOW_START;
	let control = 0;
	let at = dataOffset;
	for (let left = frameSize; left > 0; ) {
		control >>= 1;
		if (0 === (control & 0x100)) {
			control = (data[at] ?? 0) | CONTROL_REFILL;
			at += 1;
			left -= 1;
		}
		if (destination >= pixels.length) {
			throw invalidImage("The run of the picture is longer than the picture");
		}
		if (0 !== (control & 1)) {
			if (left < 1) throw invalidImage("The run ends in the middle of a byte");
			const value = data[at] ?? 0;
			at += 1;
			left -= 1;
			pixels[destination] = value;
			destination += 1;
			window[windowIndex] = value;
			windowIndex = (windowIndex + 1) & WINDOW_MASK;
		} else {
			if (left < 2) throw invalidImage("The run ends in the middle of a copy");
			const high = data[at] ?? 0;
			const low = data[at + 1] ?? 0;
			at += 2;
			left -= 2;
			let place = ((high << 4) | (low >> 4)) & WINDOW_MASK;
			for (let count = (low & 0x0f) + COPY_BIAS; count > 0; count -= 1) {
				const value = window[place] ?? 0;
				place = (place + 1) & WINDOW_MASK;
				if (destination >= pixels.length) {
					throw invalidImage("A copy reaches past the picture");
				}
				pixels[destination] = value;
				destination += 1;
				window[windowIndex] = value;
				windowIndex = (windowIndex + 1) & WINDOW_MASK;
			}
		}
	}
	return pixels;
}

/** The colour map a picture of eight bits carries, as the four byte entries a bitmap holds it in. */
export function readWipPalette(data: Buffer, offset: number): Buffer {
	const palette = Buffer.alloc(PALETTE_COLOURS * 4, 0x00);
	for (let colour = 0; colour < PALETTE_COLOURS; colour += 1) {
		const at = offset + colour * 3;
		palette[colour * 4] = data[at + 2] ?? 0;
		palette[colour * 4 + 1] = data[at + 1] ?? 0;
		palette[colour * 4 + 2] = data[at] ?? 0;
	}
	return palette;
}

/** The three planes of a picture of twenty four bits, drawn together into the order a bitmap keeps. */
function joinPlanes(raw: Buffer, width: number, height: number): Buffer {
	const plane = width * height;
	const pixels = Buffer.alloc(plane * 3, 0x00);
	for (let at = 0; at < plane; at += 1) {
		pixels[at * 3] = raw[at] ?? 0;
		pixels[at * 3 + 1] = raw[at + plane] ?? 0;
		pixels[at * 3 + 2] = raw[at + 2 * plane] ?? 0;
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const willWipImageDescriptor: FormatDescriptor = {
	id: "will-wip-image",
	name: "Will Co. image",
	extensions: ["wip", "wi0", "msk", "mos"],
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
			source: "ArcFormats/Will/ImageWIP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const willWipImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: willWipImageDescriptor,
	// The container of multi-frame pictures claims the same word and its own `.wip` name, so a picture is
	// what stands behind it: the names only a picture carries reach this one first.
	detection: { signatures: [{ bytes: SIGNATURE }], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(RECORDS_BASE + RECORD_SIZE)) return false;
		return readWipLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readWipLayout(await readStored(source));
		if (!layout) {
			throw invalidImage("Not a Will Co. picture");
		}
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The frame is unfolded and a bitmap is written around it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				frameCount: layout.frames,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readWipLayout(stored);
		if (!layout) {
			throw invalidImage("Not a Will Co. picture");
		}
		// The reference's own place for the run holds four bytes to the pixel, while only three of them are
		// named by the picture; the walk is bounded by that place, as its own array is.
		const raw = unpackWipRun(
			stored,
			layout.dataOffset,
			layout.frameSize,
			layout.width * layout.height * 4,
		);
		if (BITS_24 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp24(
					layout.width,
					layout.height,
					joinPlanes(raw, layout.width, layout.height),
				),
			]);
		}
		const paletteOffset = layout.paletteOffset ?? 0;
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				raw.subarray(0, layout.width * layout.height),
				readWipPalette(stored, paletteOffset),
			),
		]);
	},
});
