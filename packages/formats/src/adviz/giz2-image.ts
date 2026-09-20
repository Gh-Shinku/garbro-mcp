import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import {
	GIZ2_HEADER_SIZE,
	type Giz2Layout,
	unpackGiz2Picture,
} from "./giz2-reader.js";
import { readAdvizPalette } from "./palette.js";

const MARK = Buffer.from("GIZ2", "latin1");
const POSITION_FIELD = 4;
const WIDTH_FIELD = 6;
const HEIGHT_FIELD = 8;
const RLE_CODE_FIELD = 0xc;
const PLANE_MAP_FIELD = 0xe;
const PLACES_PER_STRIP = 8;
const PICTURE_PLACE_WIDTH = 0x50;
const PALETTE_PLACES = 16;
const PALETTE_PLACE_SIZE = 3;
const PALETTE_SIZE = PALETTE_PLACES * PALETTE_PLACE_SIZE;
const PLACE_STEP = 0x11;
const BITS_PER_PLACE = 4;

export interface Giz2PictureLayout extends Giz2Layout {}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readGiz2Layout(
	data: Buffer,
	fileLength = data.length,
): Giz2PictureLayout | undefined {
	if (fileLength < GIZ2_HEADER_SIZE || data.length < GIZ2_HEADER_SIZE)
		return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const position = data.readUInt16LE(POSITION_FIELD);
	const width = data.readUInt16LE(WIDTH_FIELD) * PLACES_PER_STRIP;
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width <= 0 || height <= 0 || width % PLACES_PER_STRIP !== 0)
		return undefined;
	return {
		width,
		height,
		offsetX: (position % PICTURE_PLACE_WIDTH) * PLACES_PER_STRIP,
		offsetY: Math.floor(position / PICTURE_PLACE_WIDTH),
		rleCode: data[RLE_CODE_FIELD] ?? 0,
		planeMap: data[PLANE_MAP_FIELD] ?? 0,
	};
}

export function readGiz2Palette(palette: Buffer, offset: number): Buffer {
	const colors = Buffer.alloc(PALETTE_PLACES * PALETTE_PLACE_SIZE);
	for (let at = 0; at < PALETTE_PLACES; at += 1) {
		const b = palette[offset + at * PALETTE_PLACE_SIZE] ?? 0;
		const r = palette[offset + at * PALETTE_PLACE_SIZE + 1] ?? 0;
		const g = palette[offset + at * PALETTE_PLACE_SIZE + 2] ?? 0;
		colors[at * 3] = (r * PLACE_STEP) & 0xff;
		colors[at * 3 + 1] = (g * PLACE_STEP) & 0xff;
		colors[at * 3 + 2] = (b * PLACE_STEP) & 0xff;
	}
	return colors;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The picture of the engine, with the palette of the game it stands beside. */
export async function decodeGiz2Picture(
	data: Buffer,
	layout: Giz2PictureLayout,
	sourcePath: string,
): Promise<Buffer> {
	const palette = await readAdvizPalette(
		sourcePath,
		PALETTE_SIZE,
		readGiz2Palette,
	);
	if (!palette)
		throw invalidPicture(
			"The palette of a picture of this kind stands beside the game it stands in, and no palette stands beside this picture",
		);
	return writeBmp4(
		layout.width,
		layout.height,
		unpackGiz2Picture(data, layout),
		palette.colors,
		false,
	);
}

export const advizGiz2ImageDescriptor: FormatDescriptor = {
	id: "adviz-giz2-image",
	name: "ADVIZ engine image format (GIZ2)",
	extensions: ["giz"],
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
			source: "Legacy/Adviz/ImageGIZ2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const advizGiz2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advizGiz2ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(GIZ2_HEADER_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, GIZ2_HEADER_SIZE));
			return readGiz2Layout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readGiz2Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(GIZ2_HEADER_SIZE),
					size: source.size - BigInt(GIZ2_HEADER_SIZE),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: BITS_PER_PLACE,
						offsetX: layout.offsetX,
						offsetY: layout.offsetY,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PLACE,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
				planeMap: layout.planeMap,
				rleCode: layout.rleCode,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath?: string) {
		const stored = await readStored(source);
		const layout = readGiz2Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return Readable.from([
			await decodeGiz2Picture(stored, layout, sourcePath ?? ""),
		]);
	},
});
