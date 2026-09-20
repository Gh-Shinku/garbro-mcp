// Format reference: GARbro "ArcFormats/ActiveSoft/ImageEDT.cs", classes `Ed8Format`, `Ed8MetaData` and
// `Ed8Format.Reader` (a picture of the Active Soft engine of the places of a picture of a palette of its own:
// the places of the picture stand as the places of the picture of the words of the walk of them, and the places
// of the picture of the walk of the picture stand beside the places of the picture of the walk of the picture of
// the count of them). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { EdBitReader } from "./ed-common.js";

/** The words a picture of this kind names itself with stand in the first places of the file, and the places of
 * the head of it stand behind them. */
const MARK = Buffer.from(".8Bit\x8d\x5d\x8c\xcb\x00", "latin1");
const HEAD_SIZE = 0x1a;
const WIDTH_FIELD = 0xe;
const HEIGHT_FIELD = 0x10;
const PALETTE_SIZE_FIELD = 0x12;
const COMP_SIZE_FIELD = 0x16;
/** The places of a palette of a picture of this kind stand as the places of a picture of the three places of a
 * place of the picture, and stand as the places of the picture of a picture of the places of a picture of the
 * engine of the places of a picture of a picture of two hundred and fifty-six places of it at the most. */
const PALETTE_PLACES = 0x100;
const PALETTE_PLACE_SIZE = 3;
const PLACES_PER_WALK = 8;
/** The places of the picture of the walk of a picture that stand beside the places of the picture of the places
 * behind the places of the walk of them stand as the places of the picture of the places of the picture of the
 * two places of their own, of the kinds of the places of the picture of the count of them: a place of the
 * picture of the places behind the places of the walk of the picture of its own and of the places of the
 * picture of the count of the places of the walk of the picture of the places of the picture of the kinds of
 * the places of the picture of the engine. */
const SHIFT_SIGNS: readonly number[] = [
	-0x10, 0x01, -0x20, -0x0f, 0x11, 0x02, -0x1f, 0x21, -0x1e, -0x0e, 0x12, 0x22,
	0x03, -0x0d,
];
/** The places of a walk of a picture of a count of two places of the picture stand for the places of the
 * picture of the count of them, so the count stands within the places of a picture of the count. */
const LEAST_COUNT = 2;

export interface Ed8Layout {
	width: number;
	height: number;
	paletteSize: number;
	compSize: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Ed8Format.ReadMetaData`: the words of the head of a picture of this kind name the words of the kind of the
 * picture, how wide and how tall the picture stands, how many places the palette of the picture stands for, and
 * how many places the walk of the places of the picture stands for.
 */
export function readEd8Layout(
	data: Buffer,
	fileLength = data.length,
): Ed8Layout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const paletteSize = data.readInt32LE(PALETTE_SIZE_FIELD);
	const compSize = data.readUInt32LE(COMP_SIZE_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	if (paletteSize <= 0 || paletteSize > PALETTE_PLACES) return undefined;
	// The places of the palette and the places of the walk of the picture stand behind the words of the head of
	// the picture, the places of the palette standing before the places of the walk of it.
	if (HEAD_SIZE + paletteSize * PALETTE_PLACE_SIZE > fileLength)
		return undefined;
	return {
		width,
		height,
		paletteSize,
		compSize,
		dataOffset: HEAD_SIZE,
	};
}

/**
 * `Ed8Format.Read`: the places of the picture, walked. Every place of the picture stands as the places of the
 * walk of the picture of the count of them, of the places of the picture of its own, or as the places of the
 * picture of the walk of the places of the picture behind it — the places of the picture of the walk of the
 * picture of the count of them standing beside the places of the picture of the count of the walk of them.
 */
export function unpackEd8Picture(
	data: Buffer,
	layout: Ed8Layout,
): { pixels: Buffer; palette: Buffer } {
	const paletteAt = layout.dataOffset;
	const palette = Buffer.alloc(layout.paletteSize * 4);
	// The places of the palette of a picture of this kind stand as the places of the picture of the words of a
	// picture of the engine, so the places of the picture stand behind the places of the picture of theirs.
	for (let at = 0; at < layout.paletteSize; at += 1) {
		const b = data[paletteAt + at * PALETTE_PLACE_SIZE] ?? 0;
		const g = data[paletteAt + at * PALETTE_PLACE_SIZE + 1] ?? 0;
		const r = data[paletteAt + at * PALETTE_PLACE_SIZE + 2] ?? 0;
		palette[at * 4] = b;
		palette[at * 4 + 1] = g;
		palette[at * 4 + 2] = r;
		palette[at * 4 + 3] = 0;
	}
	const walkAt = paletteAt + layout.paletteSize * PALETTE_PLACE_SIZE;
	const pixels = Buffer.alloc(layout.width * layout.height);
	const reader = new EdBitReader(data, walkAt);
	const shifts = SHIFT_SIGNS.map(
		(shift) => (shift >> 4) - (shift & 0xf) * layout.width,
	);
	let dst = 0;
	while (dst < pixels.length) {
		pixels[dst] = reader.readBits(0, PLACES_PER_WALK) & 0xff;
		dst += 1;
		if (pixels.length === dst) break;
		if (reader.nextBit() === 1) continue;
		let previous = -1;
		while (dst < pixels.length) {
			let code = 0;
			if (reader.nextBit() === 1) {
				if (reader.nextBit() === 1) code = reader.nextBit() + 1;
				code = (code << 1) + reader.nextBit() + 1;
			}
			code = (code << 1) + reader.nextBit();
			// The place of the walk of the picture that stands for the places of the picture of the walk of the
			// count of them stands as the place of the walk of the picture of the count of the places of the
			// picture of the walk of the picture behind it.
			if (code === previous) break;
			previous = code;
			let count = reader.countBits();
			if (previous >= LEAST_COUNT) count += 1;
			if (dst + count > pixels.length)
				throw invalidPicture(
					"The places of the walk of a picture stand past the places of the picture",
				);
			const offset = shifts[previous];
			if (offset === undefined)
				throw invalidPicture(
					"The place of the walk of a picture stands without the places of the picture of the count of them",
				);
			for (let at = 0; at < count; at += 1) {
				const from = dst + offset + at;
				if (from < 0)
					throw invalidPicture(
						"The places of the walk of a picture stand before the places of the picture",
					);
				pixels[dst + at] = pixels[from] ?? 0;
			}
			dst += count;
		}
	}
	return { pixels, palette };
}

export const activeSoftEd8ImageDescriptor: FormatDescriptor = {
	id: "active-soft-ed8-image",
	name: "Active Soft indexed image format",
	extensions: ["ed8", "sal"],
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
			source: "ArcFormats/ActiveSoft/ImageEDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const activeSoftEd8ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: activeSoftEd8ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readEd8Layout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readEd8Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(layout.dataOffset),
					size: source.size - BigInt(layout.dataOffset),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: 8,
						paletteSize: layout.paletteSize,
						packedSize: layout.compSize,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
				paletteSize: layout.paletteSize,
				packedSize: layout.compSize,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readEd8Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		const { pixels, palette } = unpackEd8Picture(stored, layout);
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette, false),
		]);
	},
});
