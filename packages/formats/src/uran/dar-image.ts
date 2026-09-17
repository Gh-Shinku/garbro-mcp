// Format reference: GARbro "Legacy/Uran/ImageDAR.cs", classes `DarFormat`, `DarMetaData` and `DarReader` (a
// Uran picture whose rows are runs placed at an offset inside the row, each row a step of the row size).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'DAR:', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("DAR:", "latin1");
const HEADER_SIZE = 12;
/** The palette stands behind the head, and the frame head at four hundred and twelve bytes. */
const PALETTE_OFFSET = 0x0c;
const PALETTE_SIZE = 0x100 * 4;
const FRAME_HEAD_OFFSET = 0x40c;
/** The two bytes behind the tag that must say eight and a version. */
const MARKER_FIELD = 4;
const MARKER = 0x38;
const VERSION_FIELD = 5;
const FRAME_COUNT_FIELD = 6;
const MAX_VERSION = 1;
/** The head of a frame is at least eight bytes and may reach further through its own table. */
const FRAME_HEAD_SIZE = 8;
const TABLE_HEAD_SIZE = 14;
const TABLE_ENTRY_START = 16;
/** The depths the reader knows. */
const DEPTHS = [8, 24];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface DarLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	version: number;
	frameCount: number;
	/** Where the first row run stands, and how far apart the rows are. */
	frameOffset: number;
	rowSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `DarFormat.ReadMetaData`: the two bytes at four are `8` and a version, of which one or nothing is read, and
 * the count of frames at six must be at least one. The frame head stands at `0x40C`: a head size of its own
 * when the version is not nothing, then the width, the height, the size of a row and a word the reference
 * passes over. A head of fourteen bytes or more carries three more words behind them, and one of sixteen or
 * more a table whose own count says where the depth stands — eighteen bytes of the head and the count must
 * fit inside it. The rows themselves stand a head size behind the frame head.
 */
export function readDarLayout(data: Buffer): DarLayout | undefined {
	if (data.length < FRAME_HEAD_OFFSET + 2) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (data[MARKER_FIELD] !== MARKER) return undefined;
	const version = data[VERSION_FIELD] ?? 0;
	const frameCount = data.readUInt16LE(FRAME_COUNT_FIELD);
	if (version > MAX_VERSION || frameCount < 1) return undefined;
	let position = FRAME_HEAD_OFFSET;
	let headSize = FRAME_HEAD_SIZE;
	if (version !== 0) {
		if (position + 2 > data.length) return undefined;
		headSize = data.readUInt16LE(position);
		position += 2;
	}
	const frameHead = position;
	if (frameHead + FRAME_HEAD_SIZE > data.length) return undefined;
	const width = data.readUInt16LE(frameHead);
	const height = data.readUInt16LE(frameHead + 2);
	const rowSize = data.readUInt16LE(frameHead + 4);
	let bitsPerPixel = 8;
	if (headSize >= TABLE_HEAD_SIZE) {
		if (frameHead + TABLE_ENTRY_START > data.length) return undefined;
		const count = data[frameHead + TABLE_HEAD_SIZE] ?? 0;
		if (count + 18 <= headSize) {
			const at = frameHead + TABLE_HEAD_SIZE + count;
			if (at >= data.length) return undefined;
			bitsPerPixel = data[at] ?? 0;
		}
	}
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	const size = width * height * (bitsPerPixel / 8);
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		version,
		frameCount,
		frameOffset: frameHead + headSize,
		rowSize,
	};
}

/**
 * `DarReader.Unpack`: a picture of eight bits carries a colour map of two hundred and fifty six entries
 * behind its head. The rows stand **bottom up**, the first row of the stream becoming the last row of the
 * picture: at the place of every row a signed word says how far into the row its run begins and a word behind
 * it how many bytes the run holds, of which a count of nothing means the row holds nothing at all. The rows
 * are a step of the row size apart.
 */
export function unpackDar(data: Buffer, layout: DarLayout): Buffer {
	const depth = layout.bitsPerPixel / 8;
	const stride = layout.width * depth;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let rowPosition = layout.frameOffset;
	let dst = output.length - stride;
	while (dst >= 0) {
		if (rowPosition + 4 > data.length) {
			throw invalidPicture("Uran picture is cut short of its rows");
		}
		const x = data.readInt16LE(rowPosition);
		const rowLength = data.readUInt16LE(rowPosition + 2);
		if (rowLength !== 0) {
			const at = dst + x;
			if (at < 0 || at + rowLength > output.length) {
				throw invalidPicture("Uran picture writes past its own end");
			}
			const available = Math.min(rowLength, data.length - (rowPosition + 4));
			for (let index = 0; index < available; index += 1) {
				output[at + index] = data[rowPosition + 4 + index] ?? 0;
			}
		}
		rowPosition += layout.rowSize;
		dst -= stride;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<DarLayout | undefined> {
	if (source.size < BigInt(FRAME_HEAD_OFFSET + 2)) return undefined;
	try {
		const stored = await readStored(source);
		return readDarLayout(stored);
	} catch {
		return undefined;
	}
}

export const uranDarImageDescriptor: FormatDescriptor = {
	id: "uran-dar-image",
	name: "Uran image format",
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
			source: "Legacy/Uran/ImageDAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const uranDarImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: uranDarImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Uran picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.frameOffset),
				size: source.size - BigInt(layout.frameOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					version: layout.version,
					version2: layout.frameCount,
					rowSize: layout.rowSize,
				},
			}),
			// The rows are runs placed inside their own rows and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Uran picture");
		}
		const stored = await readStored(source);
		if (
			layout.bitsPerPixel === 8 &&
			PALETTE_OFFSET + PALETTE_SIZE > stored.length
		) {
			throw invalidPicture("Uran picture is cut short of its colour map");
		}
		const pixels = unpackDar(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (layout.bitsPerPixel === 8) {
			return Readable.from([
				writeBmp8Palette(
					layout.width,
					layout.height,
					pixels,
					stored.subarray(PALETTE_OFFSET, PALETTE_OFFSET + PALETTE_SIZE),
				),
			]);
		}
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
