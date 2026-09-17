// Format reference: GARbro "ArcFormats/Abel/ImageGPS.cs", class `GpsFormat` (a Windows bitmap behind one of
// four kinds of packing, of which two walk a run length code and one an LZSS stream). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss, inflateLzssAll } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'GPS' and 'GP2', the two words the reference registers. */
const SIGNATURE = Buffer.from("GPS", "latin1");
const SIGNATURE_GP2 = Buffer.from("GP2", "latin1");
/** The full head, and the shorter one the `0xCCCCCCCC` marker brings. */
const HEADER_SIZE = 0x29;
const SHORT_HEADER_SIZE = 0x19;
const MARKER_FIELD = 4;
const MARKER = 0xcccccccc;
const COMPRESSION_FIELD = 0x10;
const UNPACKED_SIZE_FIELD = 0x11;
const PACKED_SIZE_FIELD = 0x15;
const SHORT_UNPACKED_SIZE_FIELD = 0x9;
const SHORT_PACKED_SIZE_FIELD = 0xd;
/**
 * The reference reads the bitmap head through a stream that gives it a hundred and thirty two bytes, which is
 * more than the thirty its own bitmap reader wants; this port keeps a larger prefix so a bitmap carrying one
 * of the long device independent headers is read as well.
 */
const BITMAP_PREFIX = 0x100;
/** The three bytes of a run length unit. */
const RLE_UNIT = 3;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GpsHeader {
	/** Where the packed bitmap stands. */
	headerSize: number;
	compression: number;
	unpackedSize: number;
	packedSize: number;
}

export interface GpsLayout {
	header: GpsHeader;
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GpsFormat.ReadMetaData`: the file is signed `GPS`, or `GP2` for the second kind. A `GPS` file whose word
 * at four is `0xCCCCCCCC` keeps a short head of twenty five bytes where the size of the unpacked bitmap
 * stands at nine and its packed size at thirteen, and is always packed with the plain LZSS stream. Every
 * other file keeps the full head of forty one bytes: the kind of packing at `0x10`, the size at `0x11`, the
 * packed size at `0x15` and the measurements at `0x19` and `0x1D`. A `GP2` file holds its unpacked size
 * negated, so the reference turns it back over with `-1 - size`.
 */
export function readGpsHeader(data: Buffer): GpsHeader | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const isGp2 = data.subarray(0, 3).equals(SIGNATURE_GP2);
	if (!isGp2 && !data.subarray(0, 3).equals(SIGNATURE)) return undefined;
	if (!isGp2 && data.readUInt32LE(MARKER_FIELD) === MARKER) {
		return {
			headerSize: SHORT_HEADER_SIZE,
			compression: 2,
			unpackedSize: data.readInt32LE(SHORT_UNPACKED_SIZE_FIELD),
			packedSize: data.readInt32LE(SHORT_PACKED_SIZE_FIELD),
		};
	}
	const rawUnpacked = data.readInt32LE(UNPACKED_SIZE_FIELD);
	return {
		headerSize: HEADER_SIZE,
		compression: data[COMPRESSION_FIELD] ?? 0,
		unpackedSize: isGp2 ? -1 - rawUnpacked : rawUnpacked,
		packedSize: data.readInt32LE(PACKED_SIZE_FIELD),
	};
}

/**
 * `GpsFormat.UnpackRLE`: a run length code of whole three byte units. Every unit is three bytes that stand
 * in the stream themselves and a control byte behind them; a control above one says that many more units,
 * less one, are a copy of the whole unit just read, which may repeat itself as it goes. A stream that stops
 * inside a unit ends the walk.
 */
export function unpackGpsRle(input: Buffer, outputLength: number): Buffer {
	const output: Buffer = Buffer.alloc(Math.max(0, outputLength), 0x00);
	let position = 0;
	let dst = 0;
	while (dst < output.length) {
		const wanted = Math.min(RLE_UNIT, output.length - dst);
		const available = Math.min(wanted, input.length - position);
		for (let index = 0; index < available; index += 1) {
			output[dst + index] = input[position + index] ?? 0;
		}
		position += available;
		if (available < RLE_UNIT) break;
		if (position >= input.length) break;
		const control = input[position] ?? 0;
		position += 1;
		dst += RLE_UNIT;
		if (control > 1) {
			const run = Math.min((control - 1) * RLE_UNIT, output.length - dst);
			for (let index = 0; index < run; index += 1) {
				output[dst + index] = output[dst - RLE_UNIT + index] ?? 0;
			}
			dst += run;
		}
	}
	return output;
}

/** `GpsFormat.OpenGpsStream`: the four kinds of packing, told apart by the head. */
function unpackGpsPayload(input: Buffer, header: GpsHeader): Buffer {
	switch (header.compression) {
		case 0:
			return Buffer.from(input);
		case 1:
			return unpackGpsRle(input, header.unpackedSize);
		case 2:
			return inflateLzssAll(input, { maxOutputLength: LIMIT });
		case 3:
			return unpackGpsRle(
				inflateLzssAll(input, { maxOutputLength: LIMIT }),
				header.unpackedSize,
			);
		default:
			throw invalidPicture(
				`ADVEngine bitmap packing ${header.compression} is not supported`,
			);
	}
}

/** The same kinds, but only as far as the bitmap's own measurements need. */
function unpackGpsPrefix(input: Buffer, header: GpsHeader): Buffer | undefined {
	switch (header.compression) {
		case 0:
			return input.subarray(0, Math.min(BITMAP_PREFIX, input.length));
		case 1:
			return unpackGpsRle(input, BITMAP_PREFIX);
		case 2:
			return inflateLzss(input, { outputLength: BITMAP_PREFIX });
		case 3:
			return unpackGpsRle(
				inflateLzssAll(input, { maxOutputLength: LIMIT }),
				BITMAP_PREFIX,
			);
		default:
			return undefined;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<GpsLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = await readStored(source);
		const header = readGpsHeader(stored);
		if (!header) return undefined;
		if (header.headerSize > stored.length) return undefined;
		const packed = stored.subarray(header.headerSize);
		const prefix = unpackGpsPrefix(packed, header);
		if (!prefix) return undefined;
		const fields = readBmpHeaderFields(prefix);
		if (!fields) return undefined;
		return { header, ...fields };
	} catch {
		return undefined;
	}
}

export const abelGpsImageDescriptor: FormatDescriptor = {
	id: "abel-gps-image",
	name: "ADVEngine compressed bitmap",
	extensions: ["gps", "gp2", "cmp"],
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
			source: "ArcFormats/Abel/ImageGPS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const abelGpsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abelGpsImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }, { bytes: SIGNATURE_GP2 }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not an ADVEngine bitmap");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.header.headerSize),
				size: source.size - BigInt(layout.header.headerSize),
				compressed: layout.header.compression !== 0,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					compression: layout.header.compression,
				},
			}),
			// The bitmap is unfolded from one of the four kinds of packing.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: layout.header.compression === 0 ? "none" : "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				packing: layout.header.compression,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not an ADVEngine bitmap");
		}
		const stored = await readStored(source);
		const header = readGpsHeader(stored);
		if (!header) {
			throw invalidPicture("Not an ADVEngine bitmap");
		}
		const payload = unpackGpsPayload(
			stored.subarray(header.headerSize),
			header,
		);
		const image = readBmpImage(payload);
		if (!image) {
			throw invalidPicture("Not an ADVEngine bitmap");
		}
		// `Bmp.Read` hands the bitmap out, which the port writes again at the depth it was stored in.
		return Readable.from([writeBmpImage(image)]);
	},
});
