// Format reference: GARbro "ArcFormats/Zyx/ImageMTL.cs", classes `MtlFormat` and `MtlReader` (a thirty two
// bit picture behind a `METAL` head, whose pixels are a walk of six kinds of run). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The four bytes GARbro's own signature word holds, which the port matches on their own. */
const SIGNATURE = Buffer.from("META", "latin1");
/** The head the reference reads at once, before the name behind it. */
const HEADER_SIZE = 0x2c;
const NAME_LENGTH_FIELD = 0x28;
const WIDTH_FIELD = 0x20;
const HEIGHT_FIELD = 0x24;
/** The word at 0x10 must be this, and the byte at 0x15 must not be nothing. */
const MARKER_FIELD = 0x10;
const MARKER = 0x28;
const FLAG_FIELD = 0x15;
/** What stands between the name and the frame index. */
const FRAME_MARKER = 0xc;
const FRAME_MARKER_SIZE = 4;
const FRAME_COUNT_SIZE = 4;
/** One frame record of the index behind the head. */
const FRAME_RECORD_SIZE = 0x18;
const BYTES_PER_PIXEL = 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface MtlLayout {
	width: number;
	height: number;
	/** Where the walk of pixels stands, behind the head, the name and the frame index. */
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MtlFormat.ReadMetaData`: the reference reads forty four bytes at once and requires the word at 0x10 to
 * be `0x28` and the byte at 0x15 not to be nothing, then a name of its own declared length, the word `0xC`
 * and a sane count of frames. The pixels stand behind one twenty four byte record per frame. The depth is
 * always reported as thirty two bits.
 */
export function readMtlLayout(data: Buffer): MtlLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.subarray(0, 5).toString("latin1") !== "METAL") return undefined;
	if (data.readInt32LE(MARKER_FIELD) !== MARKER) return undefined;
	if (data[FLAG_FIELD] === 0) return undefined;
	const nameLength = data.readInt32LE(NAME_LENGTH_FIELD);
	if (nameLength <= 0) return undefined;
	const nameEnd = HEADER_SIZE + nameLength;
	if (nameEnd + FRAME_MARKER_SIZE + FRAME_COUNT_SIZE > data.length)
		return undefined;
	if (data.readInt32LE(nameEnd) !== FRAME_MARKER) return undefined;
	const frameCount = data.readInt32LE(nameEnd + FRAME_MARKER_SIZE);
	if (!isSaneCount(frameCount)) return undefined;
	const dataOffset = nameEnd + FRAME_MARKER_SIZE + FRAME_COUNT_SIZE;
	const indexSize = frameCount * FRAME_RECORD_SIZE;
	if (!Number.isSafeInteger(indexSize) || dataOffset + indexSize > data.length)
		return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
		return undefined;
	return {
		width,
		height,
		dataOffset: dataOffset + indexSize,
	};
}

/**
 * GARbro `Binary.CopyOverlapped`: a copy whose destination stands behind its source repeats the pattern it
 * finds, which a byte at a time copy does by itself, and one that stands before it is a plain copy.
 */
function copyOverlapped(
	output: Buffer,
	source: number,
	destination: number,
	count: number,
): void {
	for (let index = 0; index < count; index += 1) {
		output[destination + index] = output[source + index] ?? 0;
	}
}

/**
 * `MtlReader.Unpack`: a walk of six kinds of command, told apart by the high bits of a control byte.
 *
 * | control | what it does |
 * | --- | --- |
 * | below `0x80` | that many pixels stand in the stream themselves, three bytes each |
 * | `0x80` to `0xBF` | that many pixels are left as they stand, which the empty buffer holds as nothing |
 * | `0xC0` to `0xDF` | one pixel stands in the stream and is repeated, that many more times |
 * | `0xE0` to `0xEF` | one pixel is copied from the left, above, above left or above right, told apart by the two low bits |
 * | `0xF0` and above | a run of pixels is copied from a place behind, whose distance and count stand in the stream |
 *
 * The low nibble of a given pixel is read as the pixel, and the longest count of the last two kinds is a
 * whole sixteen bit word plus one. A command that reaches outside the picture is refused, which the
 * reference's own array reads and writes answer with an exception as well.
 */
export function unpackMtl(input: Buffer, layout: MtlLayout): Buffer {
	const size = layout.width * layout.height * BYTES_PER_PIXEL;
	if (!Number.isSafeInteger(size) || size > LIMIT) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Zyx METAL picture of ${size} bytes is too large`,
		);
	}
	const output: Buffer = Buffer.alloc(size, 0x00);
	const stride = layout.width * BYTES_PER_PIXEL;
	// The places the reference copies a single pixel from: the left, above, above left and above right.
	const neighbours = [BYTES_PER_PIXEL, stride, stride + 4, stride - 4];
	let position = layout.dataOffset;
	const readByte = (): number => {
		if (position >= input.length) {
			throw invalidPicture("Zyx METAL picture is cut short of its stream");
		}
		const value = input[position] ?? 0;
		position += 1;
		return value;
	};
	const readWord = (): number => {
		const low = readByte();
		return low | (readByte() << 8);
	};
	const checkRange = (source: number, destination: number, count: number) => {
		if (source < 0 || destination < 0 || destination + count > output.length) {
			throw invalidPicture("Zyx METAL picture writes past its own end");
		}
	};
	let dst = 0;
	while (dst < output.length) {
		const control = readByte();
		let count: number;
		if (0 === (control & 0x80)) {
			count = (control & 0x7f) + 1;
			checkRange(dst, dst, count * BYTES_PER_PIXEL);
			for (let index = 0; index < count; index += 1) {
				const at = dst + index * BYTES_PER_PIXEL;
				output[at] = readByte();
				output[at + 1] = readByte();
				output[at + 2] = readByte();
			}
		} else if (0x80 === (control & 0xc0)) {
			// The pixels are left as the buffer holds them, which is nothing.
			count = (control & 0x3f) + 1;
			checkRange(dst, dst, count * BYTES_PER_PIXEL);
		} else if (0xc0 === (control & 0xe0)) {
			count = (control & 0x1f) + 1;
			checkRange(dst, dst, (count + 1) * BYTES_PER_PIXEL);
			output[dst] = readByte();
			output[dst + 1] = readByte();
			output[dst + 2] = readByte();
			copyOverlapped(
				output,
				dst,
				dst + BYTES_PER_PIXEL,
				count * BYTES_PER_PIXEL,
			);
			count += 1;
		} else if (0xe0 === (control & 0xf0)) {
			count = 1;
			const offset = neighbours[control & 3] ?? 0;
			checkRange(dst - offset, dst, BYTES_PER_PIXEL);
			output[dst] = output[dst - offset] ?? 0;
			output[dst + 1] = output[dst - offset + 1] ?? 0;
			output[dst + 2] = output[dst - offset + 2] ?? 0;
			output[dst + 3] = output[dst - offset + 3] ?? 0;
		} else {
			const offset = (0 !== (control & 1) ? readWord() : readByte()) + 1;
			count = 1;
			if (0 !== (control & 8)) {
				count += 0 !== (control & 2) ? readWord() : readByte();
			}
			checkRange(dst - offset * BYTES_PER_PIXEL, dst, count * BYTES_PER_PIXEL);
			copyOverlapped(
				output,
				dst - offset * BYTES_PER_PIXEL,
				dst,
				count * BYTES_PER_PIXEL,
			);
		}
		dst += count * BYTES_PER_PIXEL;
	}
	return output;
}

export const zyxMtlImageDescriptor: FormatDescriptor = {
	id: "zyx-mtl-image",
	name: "Zyx METAL image format",
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
			source: "ArcFormats/Zyx/ImageMTL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readLayout(source: ByteSource): Promise<MtlLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		return readMtlLayout(stored);
	} catch {
		return undefined;
	}
}

export const zyxMtlImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: zyxMtlImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Zyx METAL picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 32,
				},
			}),
			// The pixels are unfolded from a walk and a bitmap header is written around them.
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
			throw invalidPicture("Not a Zyx METAL picture");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels = unpackMtl(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
