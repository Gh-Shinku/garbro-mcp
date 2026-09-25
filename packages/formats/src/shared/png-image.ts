// The picture behind a PNG file, of the kinds the pictures of these engines stand of. The reference hands
// the places of a PNG file to the decoder of its own system; the port reads them itself, which is written
// out in the notes of the formats that lean on it.

import { GarbroError } from "@garbro-mcp/core";
import { crc32, inflateZlibBuffer } from "@garbro-mcp/codecs";
import { PNG_SIGNATURE } from "./png.js";

const SIGNATURE_SIZE = 8;
const CHUNK_HEAD_SIZE = 8;
const CHUNK_CRC_SIZE = 4;
const IHDR_HEAD_SIZE = 13;
const PLTE_ENTRY_SIZE = 3;
const INTERLACE_NONE = 0;
const COLOUR_GREY = 0;
const COLOUR_RGB = 2;
const COLOUR_PALETTE = 3;
const COLOUR_GREY_ALPHA = 4;
const COLOUR_RGBA = 6;
const BYTE_BITS = 8;
const PLACE_SIZE_RGB = 3;
const PLACE_SIZE_RGBA = 4;
const FILTER_TYPES = 5;
const LIMIT = 256 * 1024 * 1024;
/** How many places of a place of a pixel every kind of a PNG file stands of. */
const CHANNEL_COUNTS = new Map([
	[COLOUR_GREY, 1],
	[COLOUR_RGB, 3],
	[COLOUR_PALETTE, 1],
	[COLOUR_GREY_ALPHA, 2],
	[COLOUR_RGBA, 4],
]);
/** The places of a place of a pixel every kind of a PNG file may stand of. */
const DEPTHS = new Map([
	[COLOUR_GREY, new Set([1, 2, 4, 8, 16])],
	[COLOUR_RGB, new Set([8, 16])],
	[COLOUR_PALETTE, new Set([1, 2, 4, 8])],
	[COLOUR_GREY_ALPHA, new Set([8, 16])],
	[COLOUR_RGBA, new Set([8, 16])],
]);

export interface PngImage {
	width: number;
	height: number;
	/** The places of a place of the picture, three or four of them, blue first. */
	bitsPerPixel: number;
	pixels: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

interface PngFields {
	width: number;
	height: number;
	bitDepth: number;
	colourType: number;
	palette: Buffer;
	places: Buffer[];
}

/** The head of a PNG file and the places of it, with every chunk of it held to its own word. */
function readPngFields(data: Buffer): PngFields {
	if (
		data.length <
		SIGNATURE_SIZE + CHUNK_HEAD_SIZE + IHDR_HEAD_SIZE + CHUNK_CRC_SIZE
	) {
		throw invalidPicture("The picture stands short of its own head");
	}
	if (!data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		throw invalidPicture("Not a PNG picture");
	}
	let at = SIGNATURE_SIZE;
	let width = 0;
	let height = 0;
	let bitDepth = 0;
	let colourType = 0;
	let seen = false;
	let palette: Buffer = Buffer.alloc(0);
	const places: Buffer[] = [];
	while (at + CHUNK_HEAD_SIZE <= data.length) {
		const length = data.readUInt32BE(at);
		const type = data.subarray(at + 4, at + 8).toString("latin1");
		const start = at + CHUNK_HEAD_SIZE;
		if (length > LIMIT || start + length + CHUNK_CRC_SIZE > data.length) {
			throw invalidPicture("The places of the picture stand outside it");
		}
		const body = data.subarray(start, start + length);
		const word = data.readUInt32BE(start + length);
		if (crc32(data.subarray(at + 4, start + length)) !== word) {
			throw invalidPicture("The words of the picture stand of another picture");
		}
		if ("IHDR" === type) {
			if (seen || IHDR_HEAD_SIZE !== length) {
				throw invalidPicture("The head of the picture stands of nothing");
			}
			seen = true;
			width = body.readUInt32BE(0);
			height = body.readUInt32BE(4);
			bitDepth = body[8] ?? 0;
			colourType = body[9] ?? 0;
			if (0 !== (body[10] ?? 1) || 0 !== (body[11] ?? 1)) {
				throw invalidPicture(
					"The picture stands of a kind this project does not read",
				);
			}
			if (INTERLACE_NONE !== (body[12] ?? 1)) {
				throw new GarbroError(
					"UNSUPPORTED_FEATURE",
					"A picture standing of places in more than one pass is not read",
				);
			}
		} else if ("PLTE" === type) {
			if (0 !== length % PLTE_ENTRY_SIZE) {
				throw invalidPicture("The colours of the picture stand of nothing");
			}
			palette = Buffer.from(body);
		} else if ("IDAT" === type) {
			places.push(Buffer.from(body));
		} else if ("IEND" === type) {
			break;
		}
		at = start + length + CHUNK_CRC_SIZE;
	}
	if (!seen) throw invalidPicture("The picture stands of no head at all");
	const channels = CHANNEL_COUNTS.get(colourType);
	if (undefined === channels || 0 === width || 0 === height) {
		throw invalidPicture(
			"The picture stands of a kind this project does not read",
		);
	}
	if (!(DEPTHS.get(colourType)?.has(bitDepth) ?? false)) {
		throw invalidPicture(
			"The places of the picture stand of no kind this project reads",
		);
	}
	if (width * height > LIMIT) {
		throw invalidPicture("The picture stands of more places than it may");
	}
	return { width, height, bitDepth, colourType, palette, places };
}

/** The places of one row of a picture, put back together out of the places of the row before it. */
function unfilterRow(row: Buffer, previous: Buffer, placeSize: number): void {
	const filter = row[0] ?? 0;
	if (filter >= FILTER_TYPES)
		throw invalidPicture("The places of the picture stand of no filter");
	const data = row.subarray(1);
	// The places of a row stand of the places of the row itself and of the row before it, one after another.
	if (0 === filter) return;
	for (let at = 0; at < data.length; at += 1) {
		const left = at >= placeSize ? (data[at - placeSize] ?? 0) : 0;
		const up = previous[at] ?? 0;
		const upLeft = at >= placeSize ? (previous[at - placeSize] ?? 0) : 0;
		const value = data[at] ?? 0;
		if (1 === filter) data[at] = (value + left) & 0xff;
		else if (2 === filter) data[at] = (value + up) & 0xff;
		else if (3 === filter) data[at] = (value + ((left + up) >> 1)) & 0xff;
		else {
			// The fourth kind of filter takes the place of the three places before it that stands nearest to
			// the place behind it, as the reference's own reader takes it.
			const estimate = left + up - upLeft;
			const leftDistance = Math.abs(estimate - left);
			const upDistance = Math.abs(estimate - up);
			const upLeftDistance = Math.abs(estimate - upLeft);
			const nearest =
				leftDistance <= upDistance && leftDistance <= upLeftDistance
					? left
					: upDistance <= upLeftDistance
						? up
						: upLeft;
			data[at] = (value + nearest) & 0xff;
		}
	}
}

/** The places of a row of a picture, of the places of the row at the depth they stand of. */
function expandRow(
	data: Buffer,
	width: number,
	fields: PngFields,
	output: Buffer,
	row: number,
	stride: number,
): void {
	const { bitDepth, colourType } = fields;
	const palette = fields.palette;
	const alpha = COLOUR_GREY_ALPHA === colourType || COLOUR_RGBA === colourType;
	const placeSize = alpha ? PLACE_SIZE_RGBA : PLACE_SIZE_RGB;
	let at = row * stride;
	// A place of a pixel standing of fewer places than a byte holds several of them, and the first of them
	// stands in the highest places of the byte.
	const packed = bitDepth < BYTE_BITS;
	const read = (index: number): number => {
		if (packed) {
			const perByte = BYTE_BITS / bitDepth;
			const byte = data[Math.trunc(index / perByte)] ?? 0;
			const shift = BYTE_BITS - bitDepth * ((index % perByte) + 1);
			return (byte >> shift) & ((1 << bitDepth) - 1);
		}
		if (bitDepth > BYTE_BITS) {
			// A place of a pixel standing of two bytes: the picture keeps the higher of them.
			return data[index * 2] ?? 0;
		}
		return data[index] ?? 0;
	};
	for (let column = 0; column < width; column += 1) {
		const channels = CHANNEL_COUNTS.get(colourType) ?? 1;
		const values: number[] = [];
		for (let channel = 0; channel < channels; channel += 1) {
			values.push(read(column * channels + channel));
		}
		if (COLOUR_PALETTE === colourType) {
			const entry = (values[0] ?? 0) * PLTE_ENTRY_SIZE;
			output[at] = palette[entry] ?? 0;
			output[at + 1] = palette[entry + 1] ?? 0;
			output[at + 2] = palette[entry + 2] ?? 0;
		} else if (COLOUR_GREY === colourType || COLOUR_GREY_ALPHA === colourType) {
			const grey =
				bitDepth < BYTE_BITS
					? Math.trunc(((values[0] ?? 0) * 0xff) / ((1 << bitDepth) - 1))
					: (values[0] ?? 0);
			output[at] = grey;
			output[at + 1] = grey;
			output[at + 2] = grey;
			if (alpha) output[at + 3] = values[1] ?? 0;
		} else {
			output[at] = values[2] ?? 0;
			output[at + 1] = values[1] ?? 0;
			output[at + 2] = values[0] ?? 0;
			if (alpha) output[at + 3] = values[3] ?? 0;
		}
		at += placeSize;
	}
}

/**
 * The picture behind a PNG file, of the places of a place of it: four places where the picture stands of an
 * alpha of its own, and three everywhere else, which is the place of the pictures the reference hands over.
 */
export async function readPngImage(
	data: Buffer,
): Promise<PngImage | undefined> {
	const fields = readPngFields(data);
	const { width, height, bitDepth, colourType } = fields;
	const channels = CHANNEL_COUNTS.get(colourType) ?? 1;
	const rowBytes = Math.ceil((width * channels * bitDepth) / BYTE_BITS);
	// The places of a picture are read whole: the reader of the places of a file is not held to the length
	// the head names, because the places standing behind the last row of it are not the picture. A file whose
	// places stand of no walks of their own stands of no picture this project reads.
	let raw: Buffer;
	try {
		raw = Buffer.from(await inflateZlibBuffer(Buffer.concat(fields.places)));
	} catch {
		throw invalidPicture(
			"The places of the picture stand of no walks of their own",
		);
	}
	if (raw.length < (rowBytes + 1) * height) {
		throw invalidPicture("The places of the picture stand short of it");
	}
	const alpha = COLOUR_GREY_ALPHA === colourType || COLOUR_RGBA === colourType;
	const placeSize = alpha ? PLACE_SIZE_RGBA : PLACE_SIZE_RGB;
	const stride = width * placeSize;
	const pixels: Buffer = Buffer.alloc(stride * height, 0x00);
	const previous: Buffer = Buffer.alloc(rowBytes, 0x00);
	for (let row = 0; row < height; row += 1) {
		const start = row * (rowBytes + 1);
		const line = Buffer.from(raw.subarray(start, start + rowBytes + 1));
		unfilterRow(
			line,
			previous,
			Math.max(1, Math.ceil((channels * bitDepth) / BYTE_BITS)),
		);
		line.subarray(1).copy(previous, 0);
		expandRow(line.subarray(1), width, fields, pixels, row, stride);
	}
	return { width, height, bitsPerPixel: alpha ? 32 : 24, pixels };
}
