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

const HEAD_SIZE = 4;
const WIDTH_FIELD = 0;
const HEIGHT_FIELD = 2;
const PLACES_WORD = ".biz";
const WALK_START = 0x39;
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

export function readBizPalette(palette: Buffer, offset: number): Buffer {
	const colors = Buffer.alloc(PALETTE_PLACES * 4);
	for (let at = 0; at < PALETTE_PLACES; at += 1) {
		const r = palette[offset + at * PALETTE_PLACE_SIZE] ?? 0;
		const g = palette[offset + at * PALETTE_PLACE_SIZE + 1] ?? 0;
		const b = palette[offset + at * PALETTE_PLACE_SIZE + 2] ?? 0;
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
