// Reader of the tagged image file format (TIFF 6.0): the reference stands its platform over such a file
// (`GameRes/ImageTIFF.cs` hands the stream to `TiffBitmapDecoder` of WPF), so this module walks the file itself
// and hands the places of the picture over the way that walk would. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Read here: both byte orders, one or more strips, the compressions of nothing, of the pack of bytes and of the
// walk of the zlib kind, the pictures of a grey place, of a colour of the press, of a list of colours and of the
// three or four places of a colour, of one, two, four, eight and sixteen places of the file a sample, the rows
// that stand of the difference of the row in front of them, and the list of colours of the head. Tiles, the
// kinds of the fax family, the walk of the counts of twelve places of the file (LZW), the walks of the jpeg and
// of the jpeg of the two thousand, and the places of the colour of the two of them stand turned away, each with
// a message of its own.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type { BmpImage } from "./bmp.js";
import { readJpegImage } from "./jpeg-image.js";

/** The two heads the format names, little endian and big endian, each with the count of its own. */
const LITTLE_SIGNATURE = 0x002a4949;
const BIG_SIGNATURE = 0x2a004d4d;

/** The kinds of the counts of the places of a strip. */
const COMPRESSION_NONE = 1;
const COMPRESSION_DEFLATE = 8;
const COMPRESSION_OLD_DEFLATE = 32946;
const COMPRESSION_PACKBITS = 32773;
const COMPRESSION_LZW = 5;
const COMPRESSION_JPEG = 7;

/** The kinds of the places of a colour of a picture. */
const PHOTOMETRIC_WHITE_IS_ZERO = 0;
const PHOTOMETRIC_BLACK_IS_ZERO = 1;
const PHOTOMETRIC_RGB = 2;
const PHOTOMETRIC_PALETTE = 3;
const PHOTOMETRIC_CMYK = 5;

/** The tags this walk reads. */
const TAG_WIDTH = 256;
const TAG_HEIGHT = 257;
const TAG_BITS = 258;
const TAG_COMPRESSION = 259;
const TAG_PHOTOMETRIC = 262;
const TAG_STRIP_OFFSETS = 273;
const TAG_SAMPLES = 277;
const TAG_ROWS_PER_STRIP = 278;
const TAG_STRIP_COUNTS = 279;
const TAG_PLANAR = 284;
const TAG_PREDICTOR = 317;
const TAG_COLOUR_MAP = 320;
const TAG_EXTRA_SAMPLES = 338;
const TAG_SAMPLE_FORMAT = 339;
const TAG_TILE_WIDTH = 322;
const TAG_TILE_LENGTH = 323;
const TAG_TILE_OFFSETS = 324;
const TAG_TILE_COUNTS = 325;

/** The counts of the places of the file of a value of every kind the format names. */
const TYPE_SIZES: readonly number[] = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

/** The kinds of a value this walk reads: the places of the file, and the counts of the two kinds of them. */
const TYPE_BYTE = 1;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_SBYTE = 6;
const TYPE_UNDEFINED = 7;
const TYPE_SSHORT = 8;
const TYPE_SLONG = 9;

const ALPHA = 0xff;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedPicture(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

interface Entry {
	tag: number;
	type: number;
	count: number;
	/** Where the value stands: in the four places of the entry itself, or at the places it names. */
	at: number;
}

/** Reads a tagged image file and hands a bitmap of the picture over. */
export async function readTiffImage(data: Buffer): Promise<BmpImage> {
	if (data.length < 8)
		throw invalidPicture("The picture stands short of its own head");
	const little = LITTLE_SIGNATURE === data.readUInt32LE(0);
	if (!little && BIG_SIGNATURE !== data.readUInt32LE(0))
		throw invalidPicture(
			"The picture stands of no head of a tagged image file",
		);
	const u16 = (at: number): number =>
		little ? data.readUInt16LE(at) : data.readUInt16BE(at);
	const u32 = (at: number): number =>
		little ? data.readUInt32LE(at) : data.readUInt32BE(at);
	const readSigned = (at: number, size: number): number => {
		const value = 2 === size ? u16(at) : u32(at);
		const limit = 2 === size ? 0x8000 : 0x80000000;
		return value >= limit ? value - limit * 2 : value;
	};

	const ifd = u32(4);
	if (ifd + 2 > data.length)
		throw invalidPicture("The counts of the picture stand outside it");
	const count = u16(ifd);
	if (ifd + 2 + count * 12 > data.length)
		throw invalidPicture("The counts of the picture stand outside it");
	const entries: Entry[] = [];
	for (let index = 0; index < count; index += 1) {
		const at = ifd + 2 + index * 12;
		entries.push({
			tag: u16(at),
			type: u16(at + 2),
			count: u32(at + 4),
			at: at + 8,
		});
	}
	const values = (tag: number): number[] | undefined => {
		const entry = entries.find((candidate) => candidate.tag === tag);
		if (!entry) return undefined;
		const size = TYPE_SIZES[entry.type] ?? 0;
		if (0 === size || entry.count <= 0)
			throw invalidPicture("An entry of the picture names no value");
		const places = entry.count * size;
		// The places of a value of more than four places of the file stand at the places the entry names; the
		// entry itself stands as it was read, so a tag the walk asks for twice stands of the same counts twice.
		let from = entry.at;
		if (places > 4) {
			from = u32(entry.at);
			if (from + places > data.length)
				throw invalidPicture("A value of the picture stands outside it");
		}
		const out: number[] = [];
		for (let index = 0; index < entry.count; index += 1) {
			const at = from + index * size;
			switch (entry.type) {
				case TYPE_BYTE:
				case TYPE_UNDEFINED:
					out.push(data[at] ?? 0);
					break;
				case TYPE_SBYTE:
					out.push(((data[at] ?? 0) << 24) >> 24);
					break;
				case TYPE_SHORT:
					out.push(u16(at));
					break;
				case TYPE_SSHORT:
					out.push(readSigned(at, 2));
					break;
				case TYPE_LONG:
					out.push(u32(at));
					break;
				case TYPE_SLONG:
					out.push(readSigned(at, 4));
					break;
				default:
					throw unsupportedPicture(
						"An entry of the picture stands of a kind of value this walk does not read",
					);
			}
		}
		return out;
	};
	const one = (tag: number, fallback?: number): number => {
		const list = values(tag);
		if (!list) {
			if (undefined === fallback)
				throw invalidPicture("The picture stands short of an entry of its own");
			return fallback;
		}
		return list[0] ?? 0;
	};

	const tileWidth = values(TAG_TILE_WIDTH)?.[0];
	const tileLength = values(TAG_TILE_LENGTH)?.[0];
	const tiled = undefined !== tileWidth && undefined !== tileLength;
	if (tiled && (0 === tileWidth || 0 === tileLength))
		throw invalidPicture(
			"The picture names no count of the places of a tile of its own",
		);
	if (
		tiled &&
		(undefined === values(TAG_TILE_OFFSETS) ||
			undefined === values(TAG_TILE_COUNTS))
	)
		throw invalidPicture(
			"The tiles of the picture stand of no places of their own",
		);
	const width = one(TAG_WIDTH);
	const height = one(TAG_HEIGHT);
	if (width <= 0 || height <= 0)
		throw invalidPicture("The picture names no places of its own");
	if (1 !== one(TAG_PLANAR, 1))
		throw unsupportedPicture(
			"A picture whose places of a colour stand apart stands of no walk of this project",
		);
	if (1 !== one(TAG_PREDICTOR, 1) && 2 !== one(TAG_PREDICTOR, 1))
		throw unsupportedPicture(
			"A picture whose rows stand of the difference of the row in front of them of another count stands of no walk of this project",
		);
	const compression = one(TAG_COMPRESSION, COMPRESSION_NONE);
	// A strip of the walk of the jpeg holds one whole stream of that kind, of the counts of the picture itself, so
	// the walk of the jpeg of this project stands over it. A stream of the kind the reference names as its own
	// (the tables of it standing apart, of the places of the file the old kind writes) stands turned away, which
	// is where the platform of the reference fails as well.
	if (COMPRESSION_JPEG === compression) {
		const places = values(TAG_STRIP_OFFSETS) ?? [];
		const lengths = values(TAG_STRIP_COUNTS) ?? [];
		if (1 !== places.length || 1 !== lengths.length)
			throw unsupportedPicture(
				"A picture whose places of the walk of the jpeg stand in strips of their own stands of no walk of this project",
			);
		const at = places[0] ?? 0;
		const length = lengths[0] ?? 0;
		if (at + length > data.length)
			throw invalidPicture("The places of a strip stand outside the picture");
		const image = readJpegImage(data.subarray(at, at + length));
		return {
			width: image.width,
			height: image.height,
			bitsPerPixel: image.bitsPerPixel,
			palette: Buffer.alloc(0),
			pixels: image.pixels,
		};
	}

	const photometric = one(TAG_PHOTOMETRIC);
	const samples = one(TAG_SAMPLES, 1);
	const bits = values(TAG_BITS) ?? [1];
	const sampleBits = bits[0] ?? 1;
	if (bits.some((value) => value !== sampleBits))
		throw unsupportedPicture(
			"A picture whose places of a colour stand of counts of places of the file of their own stands of no walk of this project",
		);
	const formats = values(TAG_SAMPLE_FORMAT);
	if (formats?.some((value) => value !== 1 && value !== 2))
		throw unsupportedPicture(
			"A picture whose samples stand of a kind this walk does not read stands of no walk of this project",
		);
	const rowsPerStrip = one(TAG_ROWS_PER_STRIP, height);
	const offsets = values(TAG_STRIP_OFFSETS) ?? [];
	const counts = values(TAG_STRIP_COUNTS) ?? [];
	if (!tiled && 0 === offsets.length)
		throw invalidPicture("The picture names no places of its strips");
	if (!tiled && offsets.length !== counts.length)
		throw invalidPicture(
			"The strips of the picture stand of counts of their own",
		);

	// The places of the file of every sample, of a row of the picture one behind the other. A picture whose places
	// stand in tiles of their own holds its rows of places in as many rows of tiles as its counts name, of the
	// count of the places of a tile itself, and the right and the lower tiles stand clipped where the picture
	// ends; every other picture holds its places in strips.
	const rowBytes = Math.ceil((width * samples * sampleBits) / 8);
	const stored: Buffer = Buffer.alloc(rowBytes * height, 0x00);
	if (tiled) {
		const places = values(TAG_TILE_OFFSETS) ?? [];
		const lengths = values(TAG_TILE_COUNTS) ?? [];
		if (places.length !== lengths.length)
			throw invalidPicture(
				"The tiles of the picture stand of counts of their own",
			);
		const tileRowBytes = Math.ceil((tileWidth * samples * sampleBits) / 8);
		const across = Math.ceil(width / tileWidth);
		const down = Math.ceil(height / tileLength);
		if (places.length < across * down)
			throw invalidPicture("The picture stands short of the tiles of its own");
		console.log("tiles", {
			places,
			lengths,
			tileWidth,
			tileLength,
			across,
			down,
			length: data.length,
			rowBytes,
		});
		for (let tile = 0; tile < across * down; tile += 1) {
			const at = places[tile] ?? 0;
			const length = lengths[tile] ?? 0;
			if (at + length > data.length)
				throw invalidPicture("The places of a tile stand outside the picture");
			const plain = await unpackStrip(
				data.subarray(at, at + length),
				compression,
				tileRowBytes * tileLength,
			);
			const column = (tile % across) * tileWidth;
			const from = Math.floor(tile / across) * tileLength;
			const places8 = Math.min(tileWidth, width - column);
			const bytes = Math.ceil((places8 * samples * sampleBits) / 8);
			for (let index = 0; index < tileLength; index += 1) {
				const row = from + index;
				if (row >= height) break;
				plain.copy(
					stored,
					row * rowBytes + Math.floor((column * samples * sampleBits) / 8),
					index * tileRowBytes,
					index * tileRowBytes + bytes,
				);
			}
		}
	} else {
		let row = 0;
		for (let strip = 0; strip < offsets.length; strip += 1) {
			const at = offsets[strip] ?? 0;
			const length = counts[strip] ?? 0;
			if (at + length > data.length)
				throw invalidPicture("The places of a strip stand outside the picture");
			const plain = await unpackStrip(
				data.subarray(at, at + length),
				compression,
				rowBytes * rowsPerStrip,
			);
			const rows = Math.min(rowsPerStrip, height - row);
			for (let index = 0; index < rows; index += 1) {
				const from = index * rowBytes;
				plain.copy(stored, (row + index) * rowBytes, from, from + rowBytes);
			}
			if (2 === one(TAG_PREDICTOR, 1)) {
				for (let index = 0; index < rows; index += 1) {
					undoDifference(
						stored,
						(row + index) * rowBytes,
						rowBytes,
						samples,
						sampleBits,
						little,
					);
				}
			}
			row += rows;
		}
	}

	if (PHOTOMETRIC_PALETTE === photometric) {
		const palette = values(TAG_COLOUR_MAP);
		if (!palette)
			throw invalidPicture("The picture names no list of its colours");
		const entries = Math.floor(palette.length / 3);
		const colours: Buffer = Buffer.alloc(entries * 4, ALPHA);
		for (let index = 0; index < entries; index += 1) {
			colours[index * 4] = quantize(palette[entries * 2 + index] ?? 0, 16);
			colours[index * 4 + 1] = quantize(palette[entries + index] ?? 0, 16);
			colours[index * 4 + 2] = quantize(palette[index] ?? 0, 16);
		}
		return {
			width,
			height,
			bitsPerPixel: 8,
			palette: colours,
			pixels: expandIndices(stored, rowBytes, width, height, sampleBits),
		};
	}
	if (PHOTOMETRIC_RGB === photometric || PHOTOMETRIC_CMYK === photometric) {
		if (8 !== sampleBits && 16 !== sampleBits)
			throw unsupportedPicture(
				"A picture whose places of a colour stand of this count of places of the file a sample stands of no walk of this project",
			);
		const colour = PHOTOMETRIC_RGB === photometric ? 3 : 4;
		if (samples < colour)
			throw invalidPicture(
				"The picture stands short of the places of a colour of its own",
			);
		if (samples > colour + 1)
			throw unsupportedPicture(
				"A picture of more places of a colour than a picture of this kind holds stands of no walk of this project",
			);
		const hasAlpha =
			samples > colour && undefined !== values(TAG_EXTRA_SAMPLES);
		const places = 8 === sampleBits ? 1 : 2;
		const sample = (x: number, y: number, place: number): number => {
			let value = 0;
			for (let index = 0; index < places; index += 1) {
				const at = y * rowBytes + (x * samples + place) * places + index;
				const shift = little ? index : places - 1 - index;
				value |= (stored[at] ?? 0) << (8 * shift);
			}
			return 8 === sampleBits ? value : value >> 8;
		};
		const alphaAt = hasAlpha ? colour : 0;
		const pixels: Buffer = Buffer.alloc(
			width * height * (hasAlpha ? 4 : 3),
			ALPHA,
		);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const at = (y * width + x) * (hasAlpha ? 4 : 3);
				if (PHOTOMETRIC_CMYK === photometric) {
					// The counts of the places of the colour of the press of this format are the counts of the
					// places of the colour of their own: a count of nothing stands for no place of a colour at
					// all, where the streams of the jpeg of this kind hold the counts turned over. A place of the
					// picture therefore stands of the place of its colour times the place of the black of it,
					// each of them counted of what the head of the file leaves of it.
					const black = 255 - sample(x, y, 3);
					pixels[at] =
						Math.round(((255 - sample(x, y, 2)) * black) / 255) & 0xff;
					pixels[at + 1] =
						Math.round(((255 - sample(x, y, 1)) * black) / 255) & 0xff;
					pixels[at + 2] =
						Math.round(((255 - sample(x, y, 0)) * black) / 255) & 0xff;
				} else {
					pixels[at] = sample(x, y, 2);
					pixels[at + 1] = sample(x, y, 1);
					pixels[at + 2] = sample(x, y, 0);
				}
				if (hasAlpha) pixels[at + 3] = sample(x, y, alphaAt);
			}
		}
		return {
			width,
			height,
			bitsPerPixel: hasAlpha ? 32 : 24,
			palette: Buffer.alloc(0),
			pixels,
		};
	}
	if (
		PHOTOMETRIC_WHITE_IS_ZERO !== photometric &&
		PHOTOMETRIC_BLACK_IS_ZERO !== photometric
	)
		throw unsupportedPicture(
			"A picture whose places of a colour stand of a kind this walk does not read stands of no walk of this project",
		);
	if (samples > 1 && undefined === values(TAG_EXTRA_SAMPLES))
		throw unsupportedPicture(
			"A grey picture of more than one place of the file a place stands of no walk of this project",
		);
	const grey = expandSamples(
		stored,
		rowBytes,
		width,
		height,
		sampleBits,
		little,
	);
	if (PHOTOMETRIC_WHITE_IS_ZERO === photometric) {
		for (let index = 0; index < grey.length; index += 1)
			grey[index] = (grey[index] ?? 0) ^ 0xff;
	}
	if (samples > 1) {
		const pixels: Buffer = Buffer.alloc(width * height * 4, ALPHA);
		for (let at = 0; at < width * height; at += 1) {
			const value = grey[at] ?? 0;
			pixels[at * 4] = value;
			pixels[at * 4 + 1] = value;
			pixels[at * 4 + 2] = value;
		}
		return {
			width,
			height,
			bitsPerPixel: 32,
			palette: Buffer.alloc(0),
			pixels,
		};
	}
	return {
		width,
		height,
		bitsPerPixel: 8,
		palette: greyPalette(),
		pixels: grey,
	};
}

/** The places of a strip the codec gives back, of the count the walk of the picture reads. */
async function unpackStrip(
	stored: Buffer,
	compression: number,
	expected: number,
): Promise<Buffer> {
	switch (compression) {
		case COMPRESSION_NONE:
			return stored;
		case COMPRESSION_DEFLATE:
		case COMPRESSION_OLD_DEFLATE: {
			const plain = await inflateZlibBuffer(stored, expected);
			if (!plain)
				throw invalidPicture(
					"The places of a strip do not stand of the walk of the zlib kind",
				);
			return plain;
		}
		case COMPRESSION_PACKBITS:
			return unpackPackBits(stored, expected);
		case COMPRESSION_LZW:
			return unpackLzw(stored, expected);
		default:
			throw unsupportedPicture(
				"A picture whose strips stand of a kind of count of the places of their own stands of no walk of this project",
			);
	}
}

/** The walk of the pack of bytes: a count of the places of the file itself, or a place of a count of its own. */
function unpackPackBits(stored: Buffer, expected: number): Buffer {
	const out: Buffer = Buffer.alloc(expected, 0x00);
	let at = 0;
	let to = 0;
	while (at < stored.length && to < expected) {
		const count = ((stored[at] ?? 0) << 24) >> 24;
		at += 1;
		if (count >= 0) {
			const places = count + 1;
			for (let index = 0; index < places && to < expected; index += 1) {
				out[to] = stored[at + index] ?? 0;
				to += 1;
			}
			at += places;
			continue;
		}
		if (-128 === count) continue;
		const places = 1 - count;
		const place = stored[at] ?? 0;
		at += 1;
		for (let index = 0; index < places && to < expected; index += 1) {
			out[to] = place;
			to += 1;
		}
	}
	return out;
}

/**
 * The walk of the counts of twelve places of the file, of the kind this format names: a count of the places of
 * the file themselves, a count that clears the table, a count that ends the picture, and counts of the strings
 * of the table, whose count of the places of the file stands of nine counts at the start and of one more at
 * every count of the table that passes a count of the places of the file itself, one count early (which is
 * what this format names as its own kind of that walk).
 */
function unpackLzw(stored: Buffer, expected: number): Buffer {
	const out: Buffer = Buffer.alloc(expected, 0x00);
	const CLEAR = 256;
	const END = 257;
	let table: number[][] = [];
	const reset = (): void => {
		table = [];
		for (let index = 0; index < 256; index += 1) table.push([index]);
		table.push([], []);
	};
	reset();
	let at = 0;
	let bits = 0;
	let count = 0;
	const readCode = (width: number): number => {
		while (count < width) {
			if (at >= stored.length) return -1;
			bits = (bits << 8) | (stored[at] ?? 0);
			at += 1;
			count += 8;
		}
		count -= width;
		return (bits >> count) & ((1 << width) - 1);
	};
	let to = 0;
	let width = 9;
	let previous: number[] | undefined;
	while (to < expected) {
		const code = readCode(width);
		if (code < 0) break;
		if (CLEAR === code) {
			reset();
			width = 9;
			previous = undefined;
			continue;
		}
		if (END === code) break;
		let entry: number[];
		if (code < table.length) entry = table[code] ?? [];
		else if (previous) entry = [...previous, previous[0] ?? 0];
		else
			throw invalidPicture("A count of a strip stands of no string of its own");
		for (const place of entry) {
			if (to < expected) out[to] = place;
			to += 1;
		}
		if (previous) {
			table.push([...previous, entry[0] ?? 0]);
			// The count of the counts of the table grows one count early, which is this format's own kind.
			if (table.length + 1 >= 1 << width && width < 12) width += 1;
		}
		previous = entry;
	}
	return out;
}

/** Undoes the difference of a row against the row in front of it, of a place of the file a sample. */
function undoDifference(
	stored: Buffer,
	at: number,
	rowBytes: number,
	samples: number,
	bits: number,
	little: boolean,
): void {
	if (8 === bits) {
		for (let index = samples; index < rowBytes; index += 1) {
			stored[at + index] =
				((stored[at + index] ?? 0) + (stored[at + index - samples] ?? 0)) &
				0xff;
		}
		return;
	}
	if (16 !== bits) return;
	// A sample of sixteen places of the file stands of two places of it, and the difference stands of the count
	// of the sample itself, of the count of the sample in front of it of the same row, of the count of the counts
	// of that kind of sample. The order of the two places of a sample stands of the file.
	const high = little ? 1 : 0;
	const low = little ? 0 : 1;
	const count = Math.floor(rowBytes / 2);
	for (let index = samples; index < count; index += 1) {
		const here = at + index * 2;
		const before = at + (index - samples) * 2;
		const value =
			(((stored[here + high] ?? 0) << 8) | (stored[here + low] ?? 0)) +
			(((stored[before + high] ?? 0) << 8) | (stored[before + low] ?? 0));
		stored[here + high] = (value >> 8) & 0xff;
		stored[here + low] = value & 0xff;
	}
}

/** The places of a picture of a list of colours, of one place of the file a place of the picture. */
function expandIndices(
	stored: Buffer,
	rowBytes: number,
	width: number,
	height: number,
	bits: number,
): Buffer {
	const out: Buffer = Buffer.alloc(width * height, 0x00);
	const per = 8 / bits;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			if (8 === bits) {
				out[y * width + x] = stored[y * rowBytes + x] ?? 0;
				continue;
			}
			const at = y * rowBytes + Math.floor(x / per);
			const shift = (per - 1 - (x % per)) * bits;
			out[y * width + x] = ((stored[at] ?? 0) >> shift) & ((1 << bits) - 1);
		}
	}
	return out;
}

/** The places of a grey picture, of one, two, four, eight or sixteen places of the file a sample. */
function expandSamples(
	stored: Buffer,
	rowBytes: number,
	width: number,
	height: number,
	bits: number,
	little: boolean,
): Buffer {
	const out: Buffer = Buffer.alloc(width * height, 0x00);
	if (8 === bits) {
		for (let y = 0; y < height; y += 1)
			stored.copy(out, y * width, y * rowBytes, y * rowBytes + width);
		return out;
	}
	if (16 === bits) {
		// The two places of a sample stand the way the file stands: the count of the place of the picture is
		// the high place of the file in either order.
		const high = little ? 1 : 0;
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1)
				out[y * width + x] = stored[y * rowBytes + x * 2 + high] ?? 0;
		}
		return out;
	}
	const per = 8 / bits;
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const at = y * rowBytes + Math.floor(x / per);
			const shift = (per - 1 - (x % per)) * bits;
			const value = ((stored[at] ?? 0) >> shift) & ((1 << bits) - 1);
			out[y * width + x] = quantize(value, 1 << bits);
		}
	}
	return out;
}

/** A count of a place of a picture of eight places of the file, of a count of the counts of a place. */
function quantize(value: number, of: number): number {
	if (of >= 256) return value & 0xff;
	return Math.round((value * 255) / (of - 1)) & 0xff;
}

/** The list of a grey picture: one entry to a colour for every place a colour can take. */
function greyPalette(): Buffer {
	const colours: Buffer = Buffer.alloc(1024, ALPHA);
	for (let index = 0; index < 256; index += 1) {
		colours[index * 4] = index;
		colours[index * 4 + 1] = index;
		colours[index * 4 + 2] = index;
	}
	return colours;
}
