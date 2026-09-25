// Port of GARbro "ArcFormats/MnoViolet/ImageDIF.cs" (tag "DIF/MnV", class `DifFormat`), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The picture is a **difference** against another one: its head names that picture without an extension, and
// the reference finds it by asking its own file system for every file that shares the stem beside the one it
// carries, taking the first of them as the base. The picture itself stands of a head of 0x7C places - the
// name of the base behind the mark, the counts of two packed streams at 0x68 and 0x70, the places of the
// difference at 0x74 and the count of its parts at 0x78 - and then of two walks of their own:
//
//   * the index, of the places of the difference, as pairs of a place within the picture and a count of
//     places behind that one;
//   * the difference itself, whose places stand of a count of the walk rather than of the picture.
//
// The base is taken of twenty four places of a colour, its rows turned over and every row padded to four
// places, and the places of the difference are copied into that picture at the places the index names,
// which is what makes it a difference of the base rather than a picture of its own.

import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { inflateLzss, inflateLzssAll } from "@garbro-mcp/codecs";
import { readBmpImage, writeBmp24 } from "../shared/bmp.js";
import { listCompanionFiles } from "../shared/companion.js";
import {
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readPngImage } from "../shared/png-image.js";

const SIGNATURE = Buffer.from("dif\0", "latin1");
const HEAD_SIZE = 0x7c;
const NAME_AT = 4;
const NAME_SIZE = 100;
const PACKED_INDEX_AT = 0x68;
const INDEX_SIZE_AT = 0x6c;
const PACKED_DIFF_AT = 0x70;
const DIFF_DATA_AT = 0x74;
const DIFF_COUNT_AT = 0x78;
const PART_SIZE = 8;
const PLACES_BGR = 3;
const PLACES_BGRA = 4;
const BITS_BGR = 24;
const BITS_BGRA = 32;
const PADDING = 3;

export interface DifHeader {
	/** The name of the base picture, without an extension. */
	baseName: string;
	/** The places of the packed index and of the places it turns out. */
	packedIndexSize: number;
	indexSize: number;
	/** The places of the packed difference and of the places it turns out. */
	packedDiffSize: number;
	diffDataSize: number;
	/** The count of the parts of the difference. */
	diffCount: number;
}

export interface DifBasePicture {
	width: number;
	height: number;
	/** The places of the base, turned over, of four places a row of a colour and of the padding behind it. */
	pixels: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** `DifFormat.ReadMetaData`: the name of the base picture and the counts of the picture. */
export function readDifHeader(data: Buffer): DifHeader | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const baseName = decodeCStringField(data, NAME_AT, NAME_SIZE);
	if (0 === baseName.length) return undefined;
	const packedIndexSize = data.readInt32LE(PACKED_INDEX_AT);
	const indexSize = data.readInt32LE(INDEX_SIZE_AT);
	const packedDiffSize = data.readInt32LE(PACKED_DIFF_AT);
	const diffDataSize = data.readInt32LE(DIFF_DATA_AT);
	const diffCount = data.readInt32LE(DIFF_COUNT_AT);
	// The two walks stand one behind the other from the end of the head, and the index names a part of the
	// difference for every place of it; the reference reads them as its own streams and would read past the
	// end of a file that stands short of them.
	if (packedIndexSize < 0 || indexSize < 0) return undefined;
	if (packedDiffSize < 0 || diffCount < 0) return undefined;
	if (HEAD_SIZE + packedIndexSize + packedDiffSize > data.length)
		return undefined;
	if (diffCount * PART_SIZE > indexSize) return undefined;
	return {
		baseName,
		packedIndexSize,
		indexSize,
		packedDiffSize,
		diffDataSize,
		diffCount,
	};
}

/**
 * The base picture of a difference, of the kinds this project reads on its own: a bitmap or a graphic of
 * its own, of twenty four places of a colour or of thirty two of them, of which the places of the alpha
 * are dropped. The reference hands the base to whichever format of its own reads it, which is a registry
 * this project keeps at its own front rather than within a format.
 */
export async function readDifBasePicture(
	path: string,
): Promise<DifBasePicture | undefined> {
	let file: Buffer;
	try {
		file = await readFile(path);
	} catch {
		return undefined;
	}
	const bitmap = readBmpImage(file);
	if (bitmap) {
		if (BITS_BGR !== bitmap.bitsPerPixel && BITS_BGRA !== bitmap.bitsPerPixel) {
			return undefined;
		}
		return flipDifBase(
			bitmap.width,
			bitmap.height,
			bitmap.pixels,
			BITS_BGRA === bitmap.bitsPerPixel ? PLACES_BGRA : PLACES_BGR,
		);
	}
	const png = await readPngImage(file);
	if (png) {
		return flipDifBase(
			png.width,
			png.height,
			png.pixels,
			BITS_BGRA === png.bitsPerPixel ? PLACES_BGRA : PLACES_BGR,
		);
	}
	return undefined;
}

/**
 * `DifFormat.Read`: the places of the base turned over with an aligned row, which is what the reference
 * copies them into before it lays the difference over them.
 */
function flipDifBase(
	width: number,
	height: number,
	places: Buffer,
	placeSize: number,
): DifBasePicture {
	const sourceStride = width * placeSize;
	const stride = (sourceStride + PADDING) & ~PADDING;
	const pixels = Buffer.alloc(stride * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		for (let place = 0; place < width; place += 1) {
			const from = (row * width + place) * placeSize;
			const to = (height - 1 - row) * stride + place * PLACES_BGR;
			pixels[to] = places[from] ?? 0;
			pixels[to + 1] = places[from + 1] ?? 0;
			pixels[to + 2] = places[from + 2] ?? 0;
		}
	}
	return { width, height, pixels };
}

/** The places of the base of a picture with the difference of it laid over, of a tight row. */
export async function composeDifPicture(
	data: Buffer,
	header: DifHeader,
	base: DifBasePicture,
): Promise<Buffer> {
	const pixels = Buffer.from(base.pixels);
	// The index of the difference stands at the end of the head and the difference behind it: the reference
	// reads the index whole and would throw on a file that stands short of it, and the difference is read
	// for as long as it stands.
	const index = inflateLzss(
		data.subarray(HEAD_SIZE, HEAD_SIZE + header.packedIndexSize),
		{ outputLength: header.indexSize },
	);
	const diffAt = HEAD_SIZE + header.packedIndexSize;
	const difference = inflateLzssAll(
		data.subarray(diffAt, diffAt + header.packedDiffSize),
	);
	let from = 0;
	// The difference is read on, part after part, which is what the reference does with its own stream of
	// one: a part stands of the places behind the ones the part in front of it took.
	let taken = 0;
	for (let part = 0; part < header.diffCount; part += 1) {
		const offset = index.readInt32LE(from);
		const size = index.readInt32LE(from + 4);
		from += PART_SIZE;
		if (size < 0 || offset < 0 || offset + size > pixels.length) {
			throw invalidPicture(
				"The places of the difference stand past the picture",
			);
		}
		if (taken + size > difference.length) {
			throw invalidPicture(
				"The places of the difference stand short of the picture",
			);
		}
		difference.copy(pixels, offset, taken, taken + size);
		taken += size;
	}
	return pixels;
}

/** The places of the picture of a tight row, of the places of a row of the composition taken out of it. */
function tightDifRows(pixels: Buffer, header: DifBasePicture): Buffer {
	const stride = (header.width * PLACES_BGR + PADDING) & ~PADDING;
	const tight = header.width * PLACES_BGR;
	if (stride === tight) return pixels;
	const out = Buffer.alloc(tight * header.height, 0x00);
	for (let row = 0; row < header.height; row += 1) {
		pixels.copy(out, row * tight, row * stride, row * stride + tight);
	}
	return out;
}

export const mnoVioletDifImageDescriptor: FormatDescriptor = {
	id: "mnoviolet-dif-image",
	name: "M no Violet incremental image",
	extensions: ["dif"],
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
			source: "ArcFormats/MnoViolet/ImageDIF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mnoVioletDifImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mnoVioletDifImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const header = readDifHeader(await readStored(source));
			if (!header) return false;
			// The reference throws where no base picture stands beside the difference, so a difference of no
			// base is no picture of this engine either.
			return (await findDifBase(sourcePath, header)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const header = readDifHeader(data);
		if (!header) throw invalidPicture("Not a difference of a picture");
		const base = await findDifBase(sourcePath, header);
		if (!base)
			throw invalidPicture("The base picture of the difference stands nowhere");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					base: header.baseName,
					parts: header.diffCount,
					width: base.width,
					height: base.height,
					bitsPerPixel: BITS_BGR,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				base: header.baseName,
				parts: header.diffCount,
				width: base.width,
				height: base.height,
				bitsPerPixel: BITS_BGR,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		void entry;
		const data = await readStored(source);
		const header = readDifHeader(data);
		if (!header) throw invalidPicture("Not a difference of a picture");
		const base = await findDifBase(sourcePath, header);
		if (!base)
			throw invalidPicture("The base picture of the difference stands nowhere");
		const pixels = await composeDifPicture(data, header, base);
		// The places of the composition stand of the base turned over, which is what the reference hands over
		// as a picture of its own: a bitmap that stores its rows from the bottom up is the same picture.
		return Readable.from([
			writeBmp24(base.width, base.height, tightDifRows(pixels, base), true),
		]);
	},
});

/** The base picture of a difference, of the first file that shares its stem and this project reads. */
async function findDifBase(
	sourcePath: string,
	header: DifHeader,
): Promise<DifBasePicture | undefined> {
	const candidates = await listCompanionFiles(
		sourcePath,
		`${header.baseName}.dif`,
	);
	for (const candidate of candidates) {
		const base = await readDifBasePicture(candidate);
		if (base) return base;
	}
	return undefined;
}
