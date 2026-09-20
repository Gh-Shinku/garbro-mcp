// Format reference: GARbro "ArcFormats/StudioJikkenshitsu/ImageGRC.cs", classes `GrcFormat` and `GrcReader`
// (a Studio Jikkenshitsu picture of eight bits: every step of four places of a row stands behind the places of
// the row and of the row before it, the places of the step naming which of them every place stands behind).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// A picture of this kind may stand under the standard cipher; the key of such a picture stands in the settings
// of the reference, which names a key for every title it knows, and this project carries no such settings. A
// picture whose places stand under the cipher is therefore refused with a message.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { paletteTriples, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference registers the place `08` and the word `0x8008`, which begin with it, and the name `grc`. */
const SIGNATURE = 0x08;
const HEADER_SIZE = 0x20;
/** The places of a colour of the picture stand in the place at `0x00` and the highest place of the place
 * behind it names whether the places stand under the cipher. */
const BITS_FIELD = 0x00;
const FLAGS_FIELD = 0x01;
const ENCRYPTED_FLAG = 0x80;
const WIDTH_FIELD = 0x04;
const HEIGHT_FIELD = 0x06;
/** Where the places the walk names stand, and where the places of the picture that stand as they stand do. */
const BITS_OFFSET_FIELD = 0x08;
const BITS_LENGTH_FIELD = 0x0c;
const DATA_OFFSET_FIELD = 0x10;
const DATA_LENGTH_FIELD = 0x14;
/** The places of a shape of the picture, which the reference keeps and does not read. */
const ALPHA_OFFSET_FIELD = 0x18;
const ALPHA_LENGTH_FIELD = 0x1c;
/** The places of a colour stand behind the head, the places of a row of the walk behind them. */
const PALETTE_OFFSET = 0x20;
const PALETTE_COLORS = 0x100;
const PALETTE_SIZE = PALETTE_COLORS * 4;
const ROWS_OFFSET = PALETTE_OFFSET + PALETTE_SIZE;
/** The places of a colour the reference knows, and how many places of a row a step of the walk holds. */
const BITS_8 = 8;
const STEP_PLACES = 4;
const PLACES_PER_BYTE = 4;
const STEP_BITS = 2;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GrcLayout {
	width: number;
	height: number;
	stride: number;
	encrypted: boolean;
	bitsOffset: number;
	bitsLength: number;
	dataOffset: number;
	dataLength: number;
	alphaOffset: number;
	alphaLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GrcFormat.ReadMetaData`: the places of a colour of the picture stand in the place at the front of the head,
 * the highest place of the place behind it names whether the places of the picture stand under the cipher, the
 * width of the picture stands in the words at `0x04` and its height in the words at `0x06`. Where the places
 * the walk names stand, where the places of the picture that stand as they stand do, and where the places of a
 * shape of the picture stand all stand in the words behind those. The reference reads a picture of eight bits
 * and no other.
 */
export function readGrcLayout(
	data: Buffer,
	fileLength = data.length,
): GrcLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	if (SIGNATURE !== data[BITS_FIELD]) return undefined;
	if (BITS_8 !== data[BITS_FIELD]) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (0 !== width % PLACES_PER_BYTE) return undefined;
	if (width * height > LIMIT) return undefined;
	const bitsOffset = data.readInt32LE(BITS_OFFSET_FIELD);
	const bitsLength = data.readInt32LE(BITS_LENGTH_FIELD);
	const dataOffset = data.readInt32LE(DATA_OFFSET_FIELD);
	const dataLength = data.readInt32LE(DATA_LENGTH_FIELD);
	if (bitsOffset < HEADER_SIZE || bitsLength < 0) return undefined;
	if (dataOffset < HEADER_SIZE || dataLength < 0) return undefined;
	if (bitsOffset + bitsLength > fileLength) return undefined;
	if (dataOffset > fileLength) return undefined;
	if (ROWS_OFFSET + height > fileLength) return undefined;
	// The key of an encrypted picture stands in the reference's own settings, which this project does not
	// carry.
	if (0 !== ((data[FLAGS_FIELD] ?? 0) & ENCRYPTED_FLAG)) return undefined;
	return {
		width,
		height,
		stride: width,
		encrypted: false,
		bitsOffset,
		bitsLength,
		dataOffset,
		dataLength,
		alphaOffset: data.readInt32LE(ALPHA_OFFSET_FIELD),
		alphaLength: data.readInt32LE(ALPHA_LENGTH_FIELD),
	};
}

/**
 * `GrcReader.Unpack`: a row of the picture stands behind one place of the walk of rows, which names which of
 * four ways the steps of the row stand:
 *
 * | the place of the row | the places a step of the row stands behind |
 * | -------------------- | ------------------------------------------ |
 * | nought | the place before the step, the places of the row before at the place of the step and before it, in that order |
 * | one | the three places before the step, in that order |
 * | two | the places of the row before, three rows at the place of the step |
 * | three | the places of the row before at the place of the step, before it and behind it |
 *
 * Every step of four places stands behind one place of the walk of the steps, the four places of a step
 * standing four pairs of places of it, the highest pair first: a pair that stands at nought names a place of
 * the picture as it stands, which stands behind the places of the picture that stand as they stand, and every
 * other pair names which of the places above the place stands in it.
 */
export function decodeGrc(data: Buffer, layout: GrcLayout): Buffer {
	const pixels: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	const palette = paletteTriples(
		Buffer.from(data.subarray(PALETTE_OFFSET, ROWS_OFFSET)),
	);
	const rows: Buffer = Buffer.from(
		data.subarray(ROWS_OFFSET, ROWS_OFFSET + layout.height),
	);
	const ctlBits: Buffer = Buffer.from(
		data.subarray(layout.bitsOffset, layout.bitsOffset + layout.bitsLength),
	);
	const stride = layout.stride;
	const behind = [
		[0, -1, -stride, -stride - 1],
		[0, -1, -2, -3],
		[0, -stride, -2 * stride, -3 * stride],
		[0, -stride - 1, -stride, -stride + 1],
	];
	let bits = 0;
	let source = layout.dataOffset;
	let dst = 0;
	for (let row = 0; row < layout.height; row += 1) {
		const way = rows[row] ?? 0;
		const places = behind[way];
		if (!places) {
			throw invalidPicture("GRC picture takes a way its walk does not know");
		}
		for (let block = 0; block < layout.width / STEP_PLACES; block += 1) {
			if (bits >= ctlBits.length) {
				throw invalidPicture("GRC picture stands short of its own walk");
			}
			const control = ctlBits[bits] ?? 0;
			bits += 1;
			for (let pair = 6; pair >= 0; pair -= STEP_BITS) {
				const which = (control >> pair) & 0x03;
				let place: number;
				if (0 !== which) {
					const offset = places[which] ?? 0;
					place = dst + offset;
					if (place < 0 || place >= dst) {
						throw invalidPicture("GRC picture stands short of its own places");
					}
				} else {
					if (source >= data.length) {
						throw invalidPicture("GRC picture stands short of its own places");
					}
					place = source;
					source += 1;
				}
				if (dst >= pixels.length) {
					throw invalidPicture("GRC picture stands beyond its own places");
				}
				pixels[dst] = 0 !== which ? (pixels[place] ?? 0) : (data[place] ?? 0);
				dst += 1;
			}
		}
	}
	return writeBmp8Palette(layout.width, layout.height, pixels, palette, true);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readGrc(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readGrcLayout(stored, Number(source.size));
	if (!layout) throw invalidPicture("Not a GRC picture");
	return { stored, layout };
}

export const studioJikkenshitsuGrcImageDescriptor: FormatDescriptor = {
	id: "studio-jikkenshitsu-grc-image",
	name: "Studio Jikkenshitsu picture of the kind its own places stand as",
	extensions: ["grc"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/StudioJikkenshitsu/ImageGRC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The reference reads a picture of this kind only where its name stands as the name of such a picture. */
function hasGrcName(sourcePath: string): boolean {
	return /\.grc$/i.test(sourcePath);
}

export const studioJikkenshitsuGrcImageFormat: ArchiveFormat =
	defineFixedArchive({
		descriptor: studioJikkenshitsuGrcImageDescriptor,
		// The reference registers the place `08` and the word `0x8008`, which begins with it, and reads a picture
		// only where its name stands as the name of one.
		detection: { signatures: [], priority: -1, extensionFallback: true },
		async detect(source: ByteSource, sourcePath?: string) {
			if (!sourcePath || !hasGrcName(sourcePath)) return false;
			if (source.size < BigInt(HEADER_SIZE)) return false;
			try {
				const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
				return readGrcLayout(header, Number(source.size)) !== undefined;
			} catch {
				return false;
			}
		},
		async read(source: ByteSource, sourcePath: string) {
			const { layout } = await readGrc(source);
			const fileName = sourcePath.replace(/^.*[/\\]/, "");
			const entry: FixedEntry = createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(PALETTE_OFFSET),
				size: source.size - BigInt(PALETTE_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_8,
				},
			});
			return {
				entries: [entry],
				metadata: { image: "bmp", bitsPerPixel: BITS_8 },
			};
		},
		async openEntry(source: ByteSource) {
			const { stored, layout } = await readGrc(source);
			// The places of the picture stand as a bitmap of eight bits.
			return Readable.from([decodeGrc(stored, layout)]);
		},
	});
