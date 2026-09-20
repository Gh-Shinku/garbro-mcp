// Format reference: GARbro "ArcFormats/Sas5/ImageIAR.cs", classes `IarFormat` and `IarMetaData` — a format the
// reference itself calls artificial, the picture the SAS5 engine hands around inside its own archives.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	writeBmp8,
	writeBmp8Palette,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The four letters of the signature, which include the nothing the reference packs into its word. */
const SIGNATURE = Buffer.from("IAR\0", "latin1");
/** The word behind them, which the reference checks itself. */
const TAG_WORD = Buffer.from("SAS5", "latin1");
const HEADER_SIZE = 0x28;
/** The largest colour map the reference takes the entries of a map out of. */
const PALETTE_ROOM = 0x400;
const PALETTE_ENTRIES = 0x100;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** What the depth and the colour map of a picture say it holds. */
export type IarKind = "bgra32" | "bgr24" | "grey" | "palette";

export interface IarLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** The depth the header declares, which is what the reference reports. */
	bitsPerPixel: number;
	/** How long a row of the stored pixels is, which the header says and the writer has to be handed tightly. */
	stride: number;
	paletteSize: number;
	imageSize: number;
	kind: IarKind;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `IarFormat.ReadMetaData`: the four letters, the word `SAS5`, the measurements, the place the picture stands
 * at — which the reference reports turned about, so the port does the same — the depth, the length of a row,
 * the size of the colour map and the size of the pixels. What the picture holds is decided by the depth and
 * the colour map together: thirty two bits is a picture of four channels, twenty four a picture of three, and
 * of the rest one with a colour map of nothing is a grey picture and one with a colour map is an indexed one.
 * A picture of no width or height, of no length of a row, or with a colour map or a pixel size below nothing
 * is turned away, since the .NET reader the reference hands them to would throw.
 */
export function readIarLayout(data: Buffer): IarLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!data.subarray(4, 4 + TAG_WORD.length).equals(TAG_WORD)) return undefined;
	const width = data.readUInt32LE(0x08);
	const height = data.readUInt32LE(0x0c);
	if (0 === width || 0 === height) return undefined;
	const offsetX = -data.readInt32LE(0x10);
	const offsetY = -data.readInt32LE(0x14);
	const bitsPerPixel = data.readInt32LE(0x18);
	const stride = data.readInt32LE(0x1c);
	const paletteSize = data.readInt32LE(0x20);
	const imageSize = data.readInt32LE(0x24);
	if (stride <= 0 || paletteSize < 0 || imageSize < 0) return undefined;
	let kind: IarKind;
	if (32 === bitsPerPixel) kind = "bgra32";
	else if (24 === bitsPerPixel) kind = "bgr24";
	else if (0 === paletteSize) kind = "grey";
	else kind = "palette";
	return {
		width,
		height,
		offsetX,
		offsetY,
		bitsPerPixel,
		stride,
		paletteSize,
		imageSize,
		kind,
	};
}

export function iarBytesPerPixel(layout: IarLayout): number {
	if ("bgra32" === layout.kind) return 4;
	if ("bgr24" === layout.kind) return 3;
	return 1;
}

/** The depth the port reports for a picture, which is the depth it writes out rather than the declared one. */
export function iarOutputDepth(layout: IarLayout): number {
	return iarBytesPerPixel(layout) * 8;
}

/**
 * `IarFormat.ReadPalette`: the entries of a colour map of three or four bytes, of which the reference takes
 * the first, second and third of every one as the blue, the green and the red. How long an entry is comes
 * from the size of the map itself, held to the largest map the reference takes entries out of: a map of
 * `0x300` bytes gives three byte entries, one of `0x400` gives four, and one shorter than `0x100` gives none
 * at all, which makes every entry the same one — the first three bytes of the map, which therefore have to be
 * there. The result stands ready for a bitmap: blue, green, red, nothing.
 */
export function readIarPalette(data: Buffer, paletteSize: number): Buffer {
	const entries: Buffer = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	const room = Math.min(PALETTE_ROOM, paletteSize);
	const colorSize = Math.trunc(room / PALETTE_ENTRIES);
	if (paletteSize < 3) {
		throw invalidPicture("SAS5 picture is cut short of its colour map");
	}
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		const source = index * colorSize;
		entries[index * 4] = data[source] ?? 0;
		entries[index * 4 + 1] = data[source + 1] ?? 0;
		entries[index * 4 + 2] = data[source + 2] ?? 0;
	}
	return entries;
}

export function packIarRows(
	data: Buffer,
	layout: IarLayout,
	bytesPerPixel: number,
): Buffer {
	const tight = layout.width * bytesPerPixel;
	const needed = layout.stride * layout.height;
	const available = Math.min(
		layout.imageSize,
		Math.max(0, data.length - HEADER_SIZE - layout.paletteSize),
	);
	if (available < needed) {
		throw invalidPicture("SAS5 picture is cut short of its pixels");
	}
	const out: Buffer = Buffer.alloc(tight * layout.height, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		const from = HEADER_SIZE + layout.paletteSize + row * layout.stride;
		data.copy(out, row * tight, from, from + tight);
	}
	return out;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const sas5IarImageDescriptor: FormatDescriptor = {
	id: "sas5-iar-image",
	name: "SAS5 engine compressed image format",
	extensions: [""],
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
			source: "ArcFormats/Sas5/ImageIAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sas5IarImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sas5IarImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readIarLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readIarLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a SAS5 picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: iarOutputDepth(layout),
							offsetX: layout.offsetX,
							offsetY: layout.offsetY,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: iarOutputDepth(layout),
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readIarLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a SAS5 picture");
		}
		const size = layout.width * layout.height * iarBytesPerPixel(layout);
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`SAS5 picture of ${size} bytes is too large`,
			);
		}
		const bytesPerPixel = iarBytesPerPixel(layout);
		// The colour map is read before the pixels, which is the order the reference reads them in; a file
		// that does not hold all of it is refused, which is where the reference's own reader throws.
		let palette: Buffer | undefined;
		if (layout.paletteSize > 0) {
			if (stored.length < HEADER_SIZE + layout.paletteSize) {
				throw invalidPicture("SAS5 picture is cut short of its colour map");
			}
			palette = readIarPalette(
				stored.subarray(HEADER_SIZE, HEADER_SIZE + layout.paletteSize),
				layout.paletteSize,
			);
		}
		const pixels = packIarRows(stored, layout, bytesPerPixel);
		if ("bgra32" === layout.kind) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, false),
			]);
		}
		if ("bgr24" === layout.kind) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, false),
			]);
		}
		if ("grey" === layout.kind) {
			return Readable.from([
				writeBmp8(layout.width, layout.height, pixels, false),
			]);
		}
		// The colour map of the picture is the one it brought along, read the way the reference reads it.
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				pixels,
				palette ?? readIarPalette(Buffer.alloc(0), layout.paletteSize),
				false,
			),
		]);
	},
});
