// Format reference: GARbro "ArcFormats/Aoi/ImageAGF.cs", classes `AgfFormat`, `AgfMetaData` and the walk
// inside the format (an Aoi engine picture of four bytes a pixel whose pixels are written by five kinds of
// step, and which may stand on top of another picture of its own kind named by its head). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'AGF', the word the reference registers. */
const SIGNATURE = Buffer.from("AGF", "latin1");
const HEADER_SIZE = 0x80;
const VERSION_FIELD = 0x04;
const FIRST_DATA_OFFSET_FIELD = 0x0c;
const SECOND_DATA_OFFSET_FIELD = 0x10;
const WIDTH_FIELD = 0x1c;
const HEIGHT_FIELD = 0x20;
const FLAGS_FIELD = 0x54;
const BASE_NAME_OFFSET_FIELD = 0x6c;
/** The versions the reference reads. */
const VERSIONS = [1, 2];
/** How many bits a pixel takes, which the reference always takes to be thirty two. */
const BITS_PER_PIXEL = 32;
/** The place of the flags that says the picture stands on top of another one. */
const BASELINE_MASK = 0x10;
/** How deep a picture may stand on top of others before the port gives up, since a picture may name itself. */
const MAXIMUM_DEPTH = 8;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface AgfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	version: number;
	dataOffset: number;
	flags: number;
	baseNameOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AgfFormat.ReadMetaData`: the file begins with the word `AGF`, the version of the head stands at four and
 * has to be one or two, the width and the height stand at `0x1C` and `0x20` as words of four bytes, and the
 * place of the pixels is the word at `0x0C` for the first version and the one at `0x10` for the second. The
 * second version also carries flags at `0x54` and the place of the name of the picture it stands on at
 * `0x6C`.
 */
export function readAgfLayout(
	data: Buffer,
	fileLength = data.length,
): AgfLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const version = data.readInt32LE(VERSION_FIELD);
	if (!VERSIONS.includes(version)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	if (width * height * 4 > LIMIT) return undefined;
	const dataOffset =
		1 === version
			? data.readUInt32LE(FIRST_DATA_OFFSET_FIELD)
			: data.readUInt32LE(SECOND_DATA_OFFSET_FIELD);
	if (dataOffset >= fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel: BITS_PER_PIXEL,
		version,
		dataOffset,
		flags: 1 === version ? 0 : data.readUInt32LE(FLAGS_FIELD),
		baseNameOffset:
			1 === version ? 0 : data.readUInt32LE(BASE_NAME_OFFSET_FIELD),
	};
}

/**
 * `AgfFormat.ReadBaseName`: the name of the picture this one stands on stands behind the pixels, the place
 * of the head and the place the head gives taken together, and is a name of two byte letters that ends at a
 * letter of nought. Where the name does not stand inside the file the port answers with nothing, where the
 * reference would read past it.
 */
export function readAgfBaseName(
	stored: Buffer,
	layout: AgfLayout,
): string | undefined {
	const at = layout.dataOffset + layout.baseNameOffset;
	if (at >= stored.length) return undefined;
	let end = at;
	while (end + 1 < stored.length) {
		if (0 === stored[end] && 0 === stored[end + 1]) break;
		end += 2;
	}
	if (end + 1 >= stored.length) return undefined;
	return stored.subarray(at, end).toString("utf16le");
}

/** A byte at a time, which is what a run that reads the bytes it has just written needs. */
function copyOverlapped(
	buffer: Buffer,
	source: number,
	dst: number,
	count: number,
): void {
	if (source < 0) {
		throw invalidPicture(
			"Aoi engine picture copies from before its own beginning",
		);
	}
	for (let index = 0; index < count; index += 1) {
		buffer[dst + index] = buffer[source + index] ?? 0;
	}
}

export function unpackAgf(stored: Buffer, layout: AgfLayout): Buffer {
	const pixels: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let position = layout.dataOffset;
	let dst = 0;
	while (dst < pixels.length) {
		if (position + 4 > stored.length) {
			throw invalidPicture("Aoi engine picture is cut short of its pixels");
		}
		const op = stored.readUInt32LE(position);
		position += 4;
		let count = op >>> 8;
		switch (op & 0xff) {
			case 1: {
				count *= 4;
				const available = Math.min(
					count,
					pixels.length - dst,
					stored.length - position,
				);
				stored.copy(pixels, dst, position, position + available);
				position += available;
				break;
			}
			case 2: {
				if (position + 4 > stored.length) {
					throw invalidPicture("Aoi engine picture is cut short of its pixels");
				}
				stored.copy(pixels, dst, position, position + 4);
				position += 4;
				count *= 4;
				copyOverlapped(pixels, dst, dst + 4, count - 4);
				break;
			}
			case 3: {
				const chunk = (count >> 8) * 4;
				count = (count & 0xff) * chunk;
				if (position + chunk > stored.length) {
					throw invalidPicture("Aoi engine picture is cut short of its pixels");
				}
				stored.copy(pixels, dst, position, position + chunk);
				position += chunk;
				copyOverlapped(pixels, dst, dst + chunk, count - chunk);
				break;
			}
			case 4: {
				const offset = (count & 0xfff) * 4;
				count = (count >> 12) * 4;
				if (dst + count > pixels.length) {
					throw invalidPicture("Aoi engine picture writes past its own pixels");
				}
				copyOverlapped(pixels, dst - offset, dst, count);
				break;
			}
			case 5: {
				count = (count >> 8) & 0xff;
				position += (count - Math.floor(count / 4)) * 4;
				count *= 4;
				break;
			}
			default:
				throw invalidPicture(
					"Aoi engine picture is written by a step it does not know",
				);
		}
		if (dst + count > pixels.length) {
			throw invalidPicture("Aoi engine picture writes past its own pixels");
		}
		dst += count;
	}
	return pixels;
}

/**
 * `AgfFormat.BlendImage`: the picture this one stands on is written under it — every pixel of this one that
 * is nought in all four of its bytes takes the four bytes of the picture behind it. A picture behind it of
 * another size is left alone.
 */
export function blendAgf(overlay: Buffer, base: Buffer): void {
	if (overlay.length !== base.length) return;
	for (let at = 0; at + 4 <= overlay.length; at += 4) {
		const empty =
			(overlay[at] ?? 0) |
			(overlay[at + 1] ?? 0) |
			(overlay[at + 2] ?? 0) |
			(overlay[at + 3] ?? 0);
		if (0 !== empty) continue;
		overlay[at] = base[at] ?? 0;
		overlay[at + 1] = base[at + 1] ?? 0;
		overlay[at + 2] = base[at + 2] ?? 0;
		overlay[at + 3] = base[at + 3] ?? 0;
	}
}

/**
 * The picture itself: what the walk of its own pixels gives, with the picture it stands on written under it
 * where its head names one and that picture stands beside it. A picture that cannot be read — one that does
 * not stand there, or one that names a picture of its own that cannot be read — is left out, which is what
 * the reference's own catching of the failure does, and a picture that names itself is left out after a few
 * steps rather than walking into itself for ever.
 */
export async function readAgfImage(
	stored: Buffer,
	sourcePath: string,
	depth = 0,
): Promise<Buffer> {
	const layout = readAgfLayout(stored, stored.length);
	if (!layout) {
		throw invalidPicture("Not an Aoi engine picture");
	}
	const pixels = unpackAgf(stored, layout);
	if (0 === (layout.flags & BASELINE_MASK) || 0 === layout.baseNameOffset) {
		return pixels;
	}
	if (depth >= MAXIMUM_DEPTH) return pixels;
	const name = readAgfBaseName(stored, layout);
	if (undefined === name || "" === name) return pixels;
	const base = await readCompanionFile(sourcePath, name);
	if (!base) return pixels;
	try {
		const behind = await readAgfImage(base, sourcePath, depth + 1);
		blendAgf(pixels, behind);
	} catch {
		// The reference catches whatever the picture behind it answers with and keeps the pixels it has.
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const aoiAgfImageDescriptor: FormatDescriptor = {
	id: "aoi-agf-image",
	name: "Aoi engine image format",
	extensions: ["agf"],
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
			source: "ArcFormats/Aoi/ImageAGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aoiAgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aoiAgfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readAgfLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readAgfLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Aoi engine picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					version: layout.version,
				},
			}),
			// The pixels are unwrapped, any picture behind them is written under them, and a bitmap header is
			// written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "steps",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readAgfLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Aoi engine picture");
		}
		const pixels = await readAgfImage(stored, sourcePath);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
