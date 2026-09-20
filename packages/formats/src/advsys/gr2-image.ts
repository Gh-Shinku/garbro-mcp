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

const MARK = Buffer.from("GR2_", "latin1");
const HEAD_SIZE = 0x10;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const BITS_FIELD = 0xc;
const PLACES_OF_ROW_ALIGNMENT = 4;
export const BITS_PER_PLACE_16 = 16;
export const BITS_PER_PLACE_24 = 24;
export const BITS_PER_PLACE_32 = 32;
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
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

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

export function unpackGr2Picture(data: Buffer, layout: Gr2Layout): Buffer {
	const size = layout.stride * layout.height;
	if (HEAD_SIZE + size > data.length)
		throw invalidPicture(
			"Unexpected end of the places of a picture of this kind",
		);
	return Buffer.from(data.subarray(HEAD_SIZE, HEAD_SIZE + size));
}

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
