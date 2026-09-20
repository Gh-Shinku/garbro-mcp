// Format reference: GARbro "ArcFormats/AdvSys/ImageGR2.cs", class `Gr2Format` (an image of the AdvSys engine
// that stands as the places of a picture as they stand, behind a head of its own: the places of the picture of
// every row stand as many places as the places of a picture of a row stand for, standing padded to the places
// of four). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The words a picture of this kind names itself with stand in the first places of the file. */
const MARK = Buffer.from("GR2_", "latin1");
const HEAD_SIZE = 0x10;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const BITS_FIELD = 0xc;
/** The places of a picture of a kind stand in the places of a picture of a row, padded to the places of four. */
const PLACES_OF_ROW_ALIGNMENT = 4;
/** The kinds of the places of a picture the reference stands, of sixteen, of four and twenty and of two and
 * thirty places each. A picture of a kind of its own stands away with a word of its own. */
const BITS_PER_PLACE_16 = 16;
const BITS_PER_PLACE_24 = 24;
const BITS_PER_PLACE_32 = 32;
const BITS_PER_PLACE_KINDS: readonly number[] = [
	BITS_PER_PLACE_16,
	BITS_PER_PLACE_24,
	BITS_PER_PLACE_32,
];
const LIMIT = 256 * 1024 * 1024;

export interface Gr2Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** How many places the places of a row of the picture stand in. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Gr2Format.ReadMetaData` and `Gr2Format.GetStride`: the words of the head of a picture of this kind name how
 * wide and how tall it stands and how many places a place of it stands in, which the reference stands as the
 * places of a picture of a byte each.
 */
export function readGr2Layout(
	data: Buffer,
	fileLength = data.length,
): Gr2Layout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readInt16LE(BITS_FIELD) * 8;
	if (!BITS_PER_PLACE_KINDS.includes(bitsPerPixel)) return undefined;
	if (width <= 0 || height <= 0) return undefined;
	const stride =
		((width * (bitsPerPixel / 8) + PLACES_OF_ROW_ALIGNMENT - 1) &
			~(PLACES_OF_ROW_ALIGNMENT - 1)) >>>
		0;
	if (stride * height > LIMIT) return undefined;
	return { width, height, bitsPerPixel, stride };
}

/**
 * `Gr2Format.Read`: the places of the picture stand as they stand behind the words of the head of it, every
 * row standing as many places as the places of a row of the picture stand in.
 */
export function unpackGr2Picture(data: Buffer, layout: Gr2Layout): Buffer {
	const size = layout.stride * layout.height;
	if (HEAD_SIZE + size > data.length)
		throw invalidPicture(
			"Unexpected end of the places of a picture of this kind",
		);
	return Buffer.from(data.subarray(HEAD_SIZE, HEAD_SIZE + size));
}

/**
 * The places of a row of a picture of this kind stand padded to the places of four, and a picture of this
 * project stands the places of a row with no places behind them, so the places behind the places of a row
 * stand away.
 */
export function packGr2Rows(pixels: Buffer, layout: Gr2Layout): Buffer {
	const rowBytes = layout.width * (layout.bitsPerPixel / 8);
	if (layout.stride === rowBytes) return pixels;
	const packed = Buffer.alloc(rowBytes * layout.height);
	for (let row = 0; row < layout.height; row += 1) {
		pixels.copy(
			packed,
			row * rowBytes,
			row * layout.stride,
			row * layout.stride + rowBytes,
		);
	}
	return packed;
}

export const advsysGr2ImageDescriptor: FormatDescriptor = {
	id: "advsys-gr2-image",
	name: "AdvSys engine image format",
	extensions: ["gr2"],
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
			source: "ArcFormats/AdvSys/ImageGR2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const advsysGr2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advsysGr2ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readGr2Layout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readGr2Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(HEAD_SIZE),
					size: source.size - BigInt(HEAD_SIZE),
					compressed: false,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
						stride: layout.stride,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				stride: layout.stride,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readGr2Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		const pixels = packGr2Rows(unpackGr2Picture(stored, layout), layout);
		// The reference hands the places of a picture of this kind out in the kind of the places of a picture
		// the words of the head of it name, and this project stands them in a picture of its own.
		if (layout.bitsPerPixel === BITS_PER_PLACE_16)
			return Readable.from([
				writeBmp16(layout.width, layout.height, pixels, false),
			]);
		if (layout.bitsPerPixel === BITS_PER_PLACE_24)
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, false),
			]);
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
