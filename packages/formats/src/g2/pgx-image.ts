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
import { changeExtension } from "../shared/companion.js";
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
