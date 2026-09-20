// Format reference: GARbro "Legacy/Adviz/ImageBIZ.cs", class `BizFormat` ([970829][Ange] Coin: a picture of the
// ADVIZ engine that stands as the places of a picture of a palette, walked with a place that changes as the
// places of the picture are walked, and a palette that stands beside the game rather than within the picture).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { readAdvizPalette } from "./palette.js";

/** The words of the head of a picture of this kind stand in the first four places of the file. */
const HEAD_SIZE = 4;
const WIDTH_FIELD = 0;
const HEIGHT_FIELD = 2;
/** The places of the picture stand walked with a place that changes as they are walked, the place standing
 * behind the first place of the picture and the place behind the words of the head of it. */
const PLACES_WORD = ".biz";
const WALK_START = 0x39;
/** The palette of a picture of this kind holds two hundred and fifty-six places of three places each. */
const PALETTE_PLACES = 0x100;
const PALETTE_PLACE_SIZE = 3;
const PALETTE_SIZE = PALETTE_PLACES * PALETTE_PLACE_SIZE;
/** The places of a picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface BizLayout {
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BizFormat.ReadMetaData`: the words of the head of a picture of this kind name how wide and how tall the
 * picture stands, and the places of it stand behind them, one place for every place of the picture. The
 * reference refuses a picture that stands with places behind it that do not stand for such a picture.
 */
export function readBizLayout(
	data: Buffer,
	fileLength = data.length,
): BizLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width * height + HEAD_SIZE !== fileLength) return undefined;
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	return { width, height };
}

/**
 * `BizFormat.Read`: the places of the picture stand behind the head of it, every place standing beside the
 * place of the walk of it and the place of the walk changing as the places are walked.
 */
export function unpackBizPicture(data: Buffer, layout: BizLayout): Buffer {
	const places = Buffer.alloc(layout.width * layout.height);
	let walk = WALK_START;
	for (let at = 0; at < places.length; at += 1) {
		const place = (data[HEAD_SIZE + at] ?? 0) ^ walk;
		places[at] = place;
		walk = (walk + place) & 0xff;
	}
	return places;
}

/** `BizFormat.ReadPalette`: the palette of a picture of this kind stands in the table of palettes of the
 * engine, as the places of a picture of the kind the reference stands them in. */
export function readBizPalette(palette: Buffer, offset: number): Buffer {
	const colors = Buffer.alloc(PALETTE_PLACES * 4);
	for (let at = 0; at < PALETTE_PLACES; at += 1) {
		// The reference reads the places of the palette of a picture of this kind in the order of the places
		// of a picture rather than in the order of the words of a picture, so the first place of a place of
		// the palette stands for the places of the picture and the last one for the places behind it.
		const r = palette[offset + at * PALETTE_PLACE_SIZE] ?? 0;
		const g = palette[offset + at * PALETTE_PLACE_SIZE + 1] ?? 0;
		const b = palette[offset + at * PALETTE_PLACE_SIZE + 2] ?? 0;
		// The reference hands the places of a picture out as the places of the kind it stands them in, and
		// this project stands them beside the places of a picture of its own.
		colors[at * 4] = b;
		colors[at * 4 + 1] = g;
		colors[at * 4 + 2] = r;
		colors[at * 4 + 3] = 0;
	}
	return colors;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The picture of the engine, with the palette of the game it stands beside. */
export async function decodeBizPicture(
	data: Buffer,
	layout: BizLayout,
	sourcePath: string,
): Promise<Buffer> {
	const palette = await readAdvizPalette(
		sourcePath,
		PALETTE_SIZE,
		readBizPalette,
	);
	if (!palette)
		throw invalidPicture(
			"The palette of a picture of this kind stands beside the game it stands in, and no palette stands beside this picture",
		);
	const places = unpackBizPicture(data, layout);
	// The reference stands the places of a picture of this kind from the last place of it rather than from
	// the first, so the places of the picture stand from the foot of it upwards.
	return writeBmp8Palette(
		layout.width,
		layout.height,
		places,
		palette.colors,
		true,
	);
}

export const advizBizImageDescriptor: FormatDescriptor = {
	id: "adviz-biz-image",
	name: "ADVIZ engine image format",
	extensions: ["biz"],
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
			source: "Legacy/Adviz/ImageBIZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const advizBizImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advizBizImageDescriptor,
	// A picture of this kind names itself with the words of the file it stands in rather than with words of its
	// own, so the reference reads it only for a file that names the kind of the picture.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath?.toLowerCase().endsWith(PLACES_WORD)) return false;
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return (
				readBizLayout(data.subarray(0, HEAD_SIZE), Number(source.size)) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readBizLayout(stored, Number(source.size));
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
						bitsPerPixel: 8,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
				palettePlaces: PALETTE_PLACES,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath?: string) {
		const stored = await readStored(source);
		const layout = readBizLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return Readable.from([
			await decodeBizPicture(stored, layout, sourcePath ?? ""),
		]);
	},
});
