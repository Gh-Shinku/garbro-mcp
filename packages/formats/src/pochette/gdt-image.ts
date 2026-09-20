// Format reference: GARbro "Legacy/Pochette/ImageGDT.cs", classes `GdtFormat` and `GdtMetaData` (Pochette
// bitmap container). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError, decodeCp932 } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	toBgra32,
	writeBmp24,
	writeBmp32,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 16;
const BASE_LENGTH_OFFSET = 8;
const BASE_LINE_OFFSET = 9;
/** The name field is seven bytes long, which is all the reference ever expects of a base. */
const BASE_LINE_LENGTH = 7;
/** The name field is followed by the header of a bitmap. */
const BITMAP_OFFSET = 16;
/** How much of that bitmap header is read for the measurements, and how much of the file is read at most. */
const BITMAP_HEADER_SIZE = 64;

export interface PochetteGdtLayout {
	offsetX: number;
	offsetY: number;
	baseLine?: string;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * The reference's `GdtFormat.ReadMetaData`: the two offsets, the name of a base picture this one is drawn
 * over, and the header of the bitmap that begins right behind the container header.
 */
export function readPochetteGdtLayoutFrom(
	data: Buffer,
): PochetteGdtLayout | undefined {
	if (data.length < HEADER_SIZE + 18) return undefined;
	const baseLength = data[BASE_LENGTH_OFFSET] ?? 0;
	if (7 !== baseLength && 0 !== baseLength) return undefined;
	const fields = readBmpHeaderFields(
		data.subarray(BITMAP_OFFSET, BITMAP_OFFSET + BITMAP_HEADER_SIZE),
	);
	if (!fields) return undefined;
	let baseLine: string | undefined;
	if (0 !== baseLength) {
		const field = data.subarray(
			BASE_LINE_OFFSET,
			BASE_LINE_OFFSET + Math.min(baseLength, BASE_LINE_LENGTH),
		);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		).trim();
		if (name.length > 0) baseLine = name;
	}
	return {
		offsetX: data.readInt16LE(0),
		offsetY: data.readInt16LE(2),
		...(baseLine ? { baseLine } : {}),
		width: fields.width,
		height: fields.height,
		bitsPerPixel: fields.bitsPerPixel,
	};
}

export async function readPochetteGdtLayout(
	source: ByteSource,
): Promise<PochetteGdtLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE + 18)) return undefined;
	const prefix = Buffer.from(
		await source.readAt(
			0n,
			Math.min(Number(source.size), HEADER_SIZE + BITMAP_HEADER_SIZE),
		),
	);
	return readPochetteGdtLayoutFrom(prefix);
}

/** The base picture this one is drawn over, when the container names one and it can be read. */
async function readBase(
	sourcePath: string,
	baseLine: string,
): Promise<Buffer | undefined> {
	// The reference tries the name as it stands and then the same name with the extension of the format.
	return (
		(await readCompanionFile(sourcePath, baseLine)) ??
		(await readCompanionFile(sourcePath, `${baseLine}.gdt`))
	);
}

/** The picture over its base, or alone when there is no base to draw it over. */
function composeOver(
	base: Buffer,
	baseLayout: PochetteGdtLayout,
	overlayImage: Parameters<typeof writeBmpImage>[0],
	layout: PochetteGdtLayout,
): Buffer {
	const baseImage = readBmpImage(base.subarray(BITMAP_OFFSET));
	if (!baseImage)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Pochette base");
	// The reference works in one format for both pictures: the base becomes thirty two bits to a pixel when
	// its own depth is smaller than twenty four, and the picture over it follows.
	const depth = baseImage.bitsPerPixel < 24 ? 32 : baseImage.bitsPerPixel;
	const canvas = toBgra32(baseImage);
	const overlay = toBgra32(overlayImage);
	if (!canvas || !overlay) {
		throw new GarbroError("INVALID_ARCHIVE", "Unsupported Pochette depth");
	}
	const atX = layout.offsetX;
	const atY = layout.offsetY;
	if (
		atX < 0 ||
		atY < 0 ||
		atX + layout.width > baseLayout.width ||
		atY + layout.height > baseLayout.height
	) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`Pochette base of ${baseLayout.width}x${baseLayout.height} is too small for a picture at ${atX},${atY}`,
		);
	}
	// The reference copies the picture over the base byte for byte at the place the container names.
	for (let row = 0; row < layout.height; row += 1) {
		const from = row * layout.width * 4;
		const to = ((atY + row) * baseLayout.width + atX) * 4;
		overlay.copy(canvas, to, from, from + layout.width * 4);
	}
	if (32 === depth)
		return writeBmp32(baseLayout.width, baseLayout.height, canvas);
	const rgb: Buffer = Buffer.alloc(baseLayout.width * baseLayout.height * 3);
	for (let i = 0; i < baseLayout.width * baseLayout.height; i += 1) {
		rgb[i * 3] = canvas[i * 4] ?? 0;
		rgb[i * 3 + 1] = canvas[i * 4 + 1] ?? 0;
		rgb[i * 3 + 2] = canvas[i * 4 + 2] ?? 0;
	}
	return writeBmp24(baseLayout.width, baseLayout.height, rgb);
}

async function renderPochetteGdt(
	source: ByteSource,
	sourcePath: string,
	layout: PochetteGdtLayout,
): Promise<Buffer> {
	const data = Buffer.from(await source.readAt(0n, Number(source.size)));
	const overlay = readBmpImage(data.subarray(BITMAP_OFFSET));
	if (!overlay) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Pochette picture holds no bitmap",
		);
	}
	if (!layout.baseLine) return writeBmpImage(overlay);
	const base = await readBase(sourcePath, layout.baseLine);
	if (!base) return writeBmpImage(overlay);
	const baseLayout = readPochetteGdtLayoutFrom(base);
	if (!baseLayout) return writeBmpImage(overlay);
	return composeOver(base, baseLayout, overlay, layout);
}

export const pochetteGdtImageDescriptor: FormatDescriptor = {
	id: "pochette-gdt-image",
	name: "Pochette bitmap container",
	extensions: [],
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
			source: "Legacy/Pochette/ImageGDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pochetteGdtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pochetteGdtImageDescriptor,
	// The reference registers no signature: every file that reaches it is tried against the header walk.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readPochetteGdtLayout(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readPochetteGdtLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pochette picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(BITMAP_OFFSET),
						size: source.size - BigInt(BITMAP_OFFSET),
						compressed: false,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							bitmapOffset: BITMAP_OFFSET,
							offsetX: layout.offsetX,
							offsetY: layout.offsetY,
							...(layout.baseLine ? { baseLine: layout.baseLine } : {}),
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
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const layout = await readPochetteGdtLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pochette picture");
		}
		return Readable.from([await renderPochetteGdt(source, sourcePath, layout)]);
	},
});
