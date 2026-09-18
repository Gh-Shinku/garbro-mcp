// Format reference: GARbro "ArcFormats/Cri/ImageXTX.cs", classes `XtxFormat`, `XtxMetaData` and `XtxReader`
// (a texture of the Xbox 360 kind: a head that may stand behind a size of its own and then the pixels in the
// order the two walks of the engine's tiling give). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { unpackDxt5 } from "../shared/dxt.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'xtx' with a nought of its own behind it, the word the reference registers. */
const MARK = Buffer.from([0x78, 0x74, 0x78, 0x00]);
const HEADER_SIZE = 0x20;
const MARK_FIELD = 0;
const KIND_FIELD = 0x04;
/** The two kinds of tiling the head may name, less the one the reference leaves unwritten. */
const KINDS = [0, 1, 2];
const ALIGNED_WIDTH_FIELD = 0x08;
const ALIGNED_HEIGHT_FIELD = 0x0c;
const WIDTH_FIELD = 0x10;
const HEIGHT_FIELD = 0x14;
const OFFSET_X_FIELD = 0x18;
const OFFSET_Y_FIELD = 0x1c;
/** The largest size a head may stand behind, past which a file of another kind would be read. */
const MAXIMUM_HEADER_SIZE = 0x1000;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface XtxLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	/** How many bits a pixel takes, which the reference always takes to be thirty two. */
	bitsPerPixel: number;
	/** The kind of tiling the head names. */
	kind: number;
	alignedWidth: number;
	alignedHeight: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `XtxFormat.ReadMetaData`: the file begins with the four bytes `xtx` and a nought — the word the reference
 * registers — or, where it does not, with a size of four bytes that stands at less than `0x1000` and the head
 * stands behind that many bytes. The kind of tiling stands at four and has to be two or less, the width and
 * the height the tiling stands on at eight and `0x0C` as words read the long way round and both standing above
 * nought, the width and the height of the picture at `0x10` and `0x14`, and the two places the picture stands
 * at within the tiling at `0x18` and `0x1C`.
 */
export function readXtxLayout(
	data: Buffer,
	fileLength = data.length,
): XtxLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	let headerAt = 0;
	if (!data.subarray(MARK_FIELD, MARK.length).equals(MARK)) {
		const headerSize = data.readUInt32LE(0);
		if (headerSize >= MAXIMUM_HEADER_SIZE) return undefined;
		if (headerSize + HEADER_SIZE > data.length) return undefined;
		headerAt = headerSize;
		if (!data.subarray(headerAt, headerAt + MARK.length).equals(MARK)) {
			return undefined;
		}
	}
	const kind = data[headerAt + KIND_FIELD] ?? 0;
	if (kind > 2) return undefined;
	const alignedWidth = data.readInt32BE(headerAt + ALIGNED_WIDTH_FIELD);
	const alignedHeight = data.readInt32BE(headerAt + ALIGNED_HEIGHT_FIELD);
	if (alignedWidth <= 0 || alignedHeight <= 0) return undefined;
	const width = data.readUInt32BE(headerAt + WIDTH_FIELD);
	const height = data.readUInt32BE(headerAt + HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (
		alignedWidth > LIMIT ||
		alignedHeight > LIMIT ||
		alignedWidth * alignedHeight > LIMIT
	) {
		return undefined;
	}
	const dataOffset = headerAt + HEADER_SIZE;
	if (dataOffset > fileLength) return undefined;
	return {
		width,
		height,
		offsetX: data.readInt32BE(headerAt + OFFSET_X_FIELD),
		offsetY: data.readInt32BE(headerAt + OFFSET_Y_FIELD),
		bitsPerPixel: 32,
		kind,
		alignedWidth,
		alignedHeight,
		dataOffset,
	};
}

/**
 * `XtxReader.GetY` and `GetX`: the two places a pixel of the tiling stands at, read from how far into the
 * tiling it stands and how wide the tiling is, at one of three steps of tiling. The walks are the ones the
 * reference took from the tooling of the engine itself and are kept here as they stand.
 */
export function tiledRow(at: number, width: number, level: number): number {
	const v1 = (level >> 2) + ((level >> 1) >> (level >> 2));
	const v2 = at << v1;
	const v3 = (v2 & 0x3f) + ((v2 >> 2) & 0x1c0) + ((v2 >> 3) & 0x1ffffe00);
	const single = (v3 >> 4) & 1;
	const low = v3 & ((level << 6) - 1) & -0x20;
	const middle = (((v2 & 0x3f) + ((v2 >> 2) & 0xc0)) & 0xf) << 1;
	const within = ((low + middle) >> (v1 + 3)) & -2;
	const beyond =
		(((v2 >> 10) & 2) +
			((v3 >> (v1 + 6)) & 1) +
			(Math.floor((v3 >> (v1 + 7)) / ((width + 31) >> 5)) << 2)) <<
		3;
	return single + within + beyond;
}

/** The place of a pixel along its row, which is the second of the two walks of the tiling. */
export function tiledColumn(at: number, width: number, level: number): number {
	const v1 = (level >> 2) + ((level >> 1) >> (level >> 2));
	const v2 = at << v1;
	const v3 = (v2 & 0x3f) + ((v2 >> 2) & 0x1c0) + ((v2 >> 3) & 0x1ffffe00);
	const within = ((level << 3) - 1) & ((v3 >> 1) ^ ((v3 ^ (v3 >> 1)) & 0xf));
	const beyond =
		((((v2 >> 6) & 0xff) + ((v3 >> (v1 + 5)) & 0xfe)) & 3) +
		(Math.floor((v3 >> (v1 + 7)) % ((width + 31) >> 5)) << 2);
	return (within >> v1) + (beyond << 3);
}

/** What the reference reads at the first kind of tiling: four bytes a pixel, turned back to front. */
function unpackTex0(stored: Buffer, layout: XtxLayout): Buffer {
	const stride = layout.width * 4;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const total = layout.alignedWidth * layout.alignedHeight;
	if (layout.dataOffset + total * 4 > stored.length) {
		throw invalidPicture("Xbox 360 texture is cut short of its pixels");
	}
	let src = layout.dataOffset;
	for (let index = 0; index < total; index += 1) {
		const y = tiledRow(index, layout.alignedWidth, 4);
		const x = tiledColumn(index, layout.alignedWidth, 4);
		if (y < layout.height && x < layout.width) {
			const dst = stride * y + x * 4;
			output[dst] = stored[src + 3] ?? 0;
			output[dst + 1] = stored[src + 2] ?? 0;
			output[dst + 2] = stored[src + 1] ?? 0;
			output[dst + 3] = stored[src] ?? 0;
		}
		src += 4;
	}
	return output;
}

/**
 * What the reference reads at the third kind of tiling: the blocks of the fifth kind of block, every block of
 * sixteen bytes standing where the tiling of the blocks says, every word of two bytes of it turned around.
 */
function unpackTex2(stored: Buffer, layout: XtxLayout): Buffer {
	const blocksWide = layout.alignedWidth >> 2;
	const total = blocksWide * (layout.alignedHeight >> 2);
	const needed = layout.alignedWidth * layout.alignedHeight;
	if (layout.dataOffset + needed > stored.length) {
		throw invalidPicture("Xbox 360 texture is cut short of its blocks");
	}
	const packed: Buffer = Buffer.alloc(needed, 0x00);
	let src = layout.dataOffset;
	for (let index = 0; index < total; index += 1) {
		const y = tiledRow(index, blocksWide, 0x10);
		const x = tiledColumn(index, blocksWide, 0x10);
		let dst = (x + y * blocksWide) * 16;
		for (let word = 0; word < 8; word += 1) {
			packed[dst] = stored[src + 1] ?? 0;
			packed[dst + 1] = stored[src] ?? 0;
			dst += 2;
			src += 2;
		}
	}
	return unpackDxt5(packed, layout.width, layout.height);
}

/**
 * `XtxReader.Unpack`: the first kind of tiling stands a pixel at every place, four bytes a pixel turned back
 * to front, and the third kind stands a block of the fifth kind of block at every place. The second kind is
 * read by the reference and then handed to its caller as an exception, so the port turns it away.
 */
export function unpackXtx(stored: Buffer, layout: XtxLayout): Buffer {
	if (0 === layout.kind) return unpackTex0(stored, layout);
	if (1 === layout.kind) {
		throw invalidPicture(
			"Xbox 360 texture of the second kind of tiling not supported",
		);
	}
	return unpackTex2(stored, layout);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const criXtxImageDescriptor: FormatDescriptor = {
	id: "cri-xtx-image",
	name: "Xbox 360 texture format",
	extensions: ["xtx"],
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
			source: "ArcFormats/Cri/ImageXTX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const criXtxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: criXtxImageDescriptor,
	// The reference registers the word `xtx` and, behind it, a format of no word at all — reached by the
	// extension, which is what a file whose head stands behind a size of its own needs.
	detection: {
		signatures: [{ bytes: MARK }],
		extensionFallback: true,
		priority: -1,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			// The head may stand behind a size of its own, so enough of the file is read to hold both the
			// largest size a head may stand behind and the head itself.
			const wanted = Number(
				source.size < BigInt(MAXIMUM_HEADER_SIZE + HEADER_SIZE)
					? source.size
					: BigInt(MAXIMUM_HEADER_SIZE + HEADER_SIZE),
			);
			const header = Buffer.from(await source.readAt(0n, wanted));
			return readXtxLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readXtxLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Xbox 360 texture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: 2 === layout.kind,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					alignedWidth: layout.alignedWidth,
					alignedHeight: layout.alignedHeight,
					kind: layout.kind,
				},
			}),
			// The pixels are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: 0 === layout.kind ? "none" : "dxt5",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readXtxLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an Xbox 360 texture");
		}
		const pixels = unpackXtx(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
