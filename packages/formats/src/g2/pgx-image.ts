// Format reference: GARBro "ArcFormats/Glib2/ImagePGX.cs", class `PgxFormat` (tag `PGX`), whose own walk is
// the `GOpener.LzssUnpack` of the Glib engine. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { unpackGlibLzss } from "../glib/glib-lzss.js";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word every picture of this engine opens with. */
const MARK = Buffer.from("PGX\0", "latin1");
/** The head, and the place the picture's own run begins behind it. */
const HEADER_SIZE = 0x18;
const DATA_START = 0x20;
const WIDTH_AT = 8;
const HEIGHT_AT = 12;
const BITS_AT = 0x10;
const FLAGS_AT = 0x12;
const PACKED_SIZE_AT = 0x14;
/** The depth a picture is kept in, told by the lowest bit of its own field. */
const DEPTH_COLOURS = 24;
const DEPTH_CHANNELS = 32;
/** The feature that puts a block of the engine's own information in front of the picture. */
const INFO_FLAG = 0x1000;
const INFO_HEADER_SIZE = 0x10;
/** The four pairs of bytes the information block swaps about before it can be read. */
const INFO_SWAPS: ReadonlyArray<readonly [number, number]> = [
	[13, 9],
	[15, 11],
	[4, 8],
	[6, 10],
];
const INFO_UNPACKED_AT = 12;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface PgxLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	flags: number;
	packedSize: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `PgxFormat.ReadMetaData`: the head of the picture, whose depth stands in the lowest bit of its field. */
export function readPgxLayout(data: Buffer): PgxLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(MARK)) return undefined;
	const width = data.readUInt32LE(WIDTH_AT);
	const height = data.readUInt32LE(HEIGHT_AT);
	if (0 === width || 0 === height) return undefined;
	const total = width * height * 4;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	const field = data.readInt16LE(BITS_AT);
	return {
		width,
		height,
		bitsPerPixel: 0 === (field & 1) ? DEPTH_COLOURS : DEPTH_CHANNELS,
		flags: data.readUInt16LE(FLAGS_AT),
		packedSize: data.readInt32LE(PACKED_SIZE_AT),
	};
}

/** `PgxFormat.ReadGms`: the block of the engine's own information, which stands in front of the picture. */
export function readPgxInfo(data: Buffer, from: number): number {
	const end = from + INFO_HEADER_SIZE;
	if (end > data.length)
		throw invalid("The picture's own information reaches past the file");
	const header = Buffer.from(data.subarray(from, end));
	for (const [left, right] of INFO_SWAPS) {
		const swap = header[left] ?? 0;
		header[left] = header[right] ?? 0;
		header[right] = swap;
	}
	const unpacked = header.readInt32LE(INFO_UNPACKED_AT);
	if (unpacked < 0 || unpacked > LIMIT) {
		throw invalid("The picture's own information is larger than it may be");
	}
	// The information itself is not a picture: it is unpacked and stands aside, so the run behind it may
	// be read from the place it ends.
	return unpackGlibLzss(data, end, new Uint8Array(unpacked), unpacked);
}

/** `PgxFormat.Read`: the picture's own run, unpacked into four bytes a pixel. */
export function unpackPgxPicture(
	data: Buffer,
	layout: PgxLayout,
): { pixels: Buffer; stride: number } {
	let at = DATA_START;
	if (0 !== (layout.flags & INFO_FLAG)) at = readPgxInfo(data, at);
	const stride = layout.width * 4;
	const pixels = Buffer.alloc(stride * layout.height, 0x00);
	unpackGlibLzss(data, at, pixels, pixels.length);
	return { pixels, stride };
}

/** The word the table of the layers of the engine opens with, and the places of its head. */
const STX_MARK = "CDBD";
const STX_MARK_SIZE = 4;
const STX_COUNT_AT = 4;
const STX_INFO_TABLE_AT = 8;
const STX_HEAD_SIZE = 0x10;
const STX_ENTRY_SIZE = 0x18;
const STX_NAME_OFFSET_AT = 0x00;
const STX_PARENT_AT = 0x08;
const STX_ATTR_AT = 0x0c;
const STX_INFO_OFFSET_AT = 0x10;
const STX_INFO_SIZE_AT = 0x14;
/** The two fields of a layer this port reads: the picture the layer names and the place of it. */
const STX_FILENAME = "filename";
const STX_RECT = "rect";
const STX_RECT_SIZE = 0x14;
/** The name of the table of the layers of an archive of the engine, beside the pictures of it. */
export const STX_NAME = "info";

interface StxEntry {
	fullName: string;
	name: string;
	attr: number;
	infoOffset: number;
	infoSize: number;
}

/** The places of the file of a run of the table, up to the place of no place of it. */
function readStxString(data: Buffer, at: number, length: number): string {
	const end = Math.min(data.length, at + Math.max(0, length));
	let stop = at;
	while (stop < end && 0x00 !== data[stop]) stop += 1;
	return data.toString("latin1", at, stop);
}

/**
 * `InfoReader.ParseInfo` and the walk behind it: the table of the layers of the engine names the pictures of
 * it, and the place of a picture stands of the `rect` of the layer that names it. The table stands of the
 * name `info` beside the picture, of the word `CDBD` at its head.
 */
export function readStxLayer(
	data: Buffer,
	pictureName: string,
): { offsetX: number; offsetY: number } | undefined {
	if (data.length < STX_HEAD_SIZE) return undefined;
	if (data.toString("latin1", 0, STX_MARK_SIZE) !== STX_MARK) return undefined;
	const count = data.readInt32LE(STX_COUNT_AT);
	if (count < 0 || STX_HEAD_SIZE + count * STX_ENTRY_SIZE > data.length) {
		return undefined;
	}
	const infoBase = STX_HEAD_SIZE + data.readUInt32LE(STX_INFO_TABLE_AT);
	const namesBase = STX_HEAD_SIZE + count * STX_ENTRY_SIZE;
	const entries: StxEntry[] = [];
	const layers = new Map<string, string>();
	for (let index = 0; index < count; index += 1) {
		const at = STX_HEAD_SIZE + index * STX_ENTRY_SIZE;
		const nameOffset = namesBase + data.readUInt32LE(at + STX_NAME_OFFSET_AT);
		const parent = data.readInt32LE(at + STX_PARENT_AT);
		const attr = data.readInt32LE(at + STX_ATTR_AT);
		const infoOffset = data.readUInt32LE(at + STX_INFO_OFFSET_AT);
		const infoSize = data.readUInt32LE(at + STX_INFO_SIZE_AT);
		const name = readStxString(data, nameOffset, infoBase - nameOffset);
		const parentEntry = parent >= 0 ? entries[parent] : undefined;
		const fullName = parentEntry ? `${parentEntry.fullName}\\${name}` : name;
		// The places of the file of a field of a layer stand behind the whole of the places of the table of
		// the layers themselves, of the mark of its own of every field that stands of a mark.
		const entry: StxEntry = {
			fullName,
			name,
			attr,
			infoOffset:
				-1 !== attr && 0 !== infoSize ? infoOffset + infoBase : infoOffset,
			infoSize,
		};
		entries.push(entry);
		if (STX_FILENAME === name && parent >= 0 && 0 !== infoSize) {
			const length = data.readUInt32LE(entry.infoOffset);
			const file = readStxString(data, entry.infoOffset + 4, length);
			if (parentEntry && 0 !== file.length) {
				layers.set(file, `${parentEntry.fullName}\\`);
			}
		}
	}
	const path = layers.get(pictureName);
	if (undefined === path) return undefined;
	let place: { offsetX: number; offsetY: number } | undefined;
	for (const entry of entries) {
		if (-1 === entry.attr || !entry.fullName.startsWith(path)) continue;
		if (STX_RECT !== entry.name || STX_RECT_SIZE !== entry.infoSize) continue;
		if (entry.infoOffset + STX_RECT_SIZE > data.length) continue;
		place = {
			offsetX: data.readInt32LE(entry.infoOffset + 4),
			offsetY: data.readInt32LE(entry.infoOffset + 8),
		};
	}
	return place;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const g2PgxImageDescriptor: FormatDescriptor = {
	id: "g2-pgx-image",
	name: "Glib2 engine image",
	extensions: ["pgx"],
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
			source: "ArcFormats/Glib2/ImagePGX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const g2PgxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: g2PgxImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readPgxLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readPgxLayout(await readStored(source));
		if (!layout) throw invalid("Not a Glib2 engine picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		// `InfoReader.GetInfo`: the table of the layers of the engine stands of the name `info` beside the
		// picture, and the place of the picture stands of the layer that names it.
		const info = await readCompanionFile(sourcePath, STX_NAME);
		const layer = info ? readStxLayer(info, fileName) : undefined;
		const entry: FixedEntry = {
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
					bitsPerPixel: layout.bitsPerPixel,
					...(layer ? { offsetX: layer.offsetX, offsetY: layer.offsetY } : {}),
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				packedSize: layout.packedSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPgxLayout(stored);
		if (!layout) throw invalid("Not a Glib2 engine picture");
		const { pixels, stride } = unpackPgxPicture(stored, layout);
		if (DEPTH_CHANNELS === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, false),
			]);
		}
		// A picture of three bytes a pixel is unpacked into four, so its rows are drawn together again.
		const packed = Buffer.alloc(layout.width * 3 * layout.height, 0x00);
		for (let y = 0; y < layout.height; y += 1) {
			for (let x = 0; x < layout.width; x += 1) {
				const from = y * stride + x * 4;
				const to = (y * layout.width + x) * 3;
				packed[to] = pixels[from] ?? 0;
				packed[to + 1] = pixels[from + 1] ?? 0;
				packed[to + 2] = pixels[from + 2] ?? 0;
			}
		}
		return Readable.from([
			writeBmp24(layout.width, layout.height, packed, false),
		]);
	},
});
