// Format reference: GARbro "Legacy/Aaru/ImageBM2.cs", classes `Bm2Format` and `Bm2Reader` (Aaru bitmap
// format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("BM2A", "latin1");
const HEADER_SIZE = 0x16;
const BPP_FIELD = 8;
const OFFSET_X_FIELD = 0xa;
const OFFSET_Y_FIELD = 0xc;
const WIDTH_FIELD = 0xe;
const HEIGHT_FIELD = 0x10;
/** The colour map of an eight bit picture, read the way the reference reads it: four bytes to an entry. */
const PALETTE_SIZE = 0x100 * 4;
const DEPTH_8 = 8;
const DEPTH_24 = 24;
/** Four bytes to a pixel, whatever the depth says, because that is what the reader takes. */
const BYTES_PER_PIXEL = 4;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface Bm2Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	offsetX: number;
	offsetY: number;
}

function isBm2Signature(data: Buffer): boolean {
	return data.subarray(0, 4).equals(SIGNATURE);
}

/**
 * `Bm2Format.ReadMetaData`: a depth of eight or twenty four bits and the measurements behind it, with the
 * place of the picture beside them. Nothing else is read, so a file whose pixels are cut short is claimed
 * here and refused when it is read.
 */
export function readBm2Layout(data: Buffer): Bm2Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!isBm2Signature(data)) return undefined;
	const bitsPerPixel = data.readUInt16LE(BPP_FIELD);
	if (bitsPerPixel !== DEPTH_8 && bitsPerPixel !== DEPTH_24) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	// The reference would build an empty image; nothing can be drawn from one.
	if (width === 0 || height === 0) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		offsetX: data.readInt16LE(OFFSET_X_FIELD),
		offsetY: data.readInt16LE(OFFSET_Y_FIELD),
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Bm2Reader.Unpack`: the pixels behind the header are **thirty two bit** either way — the reader always
 * builds `Bgra32` — and an eight bit picture keeps a colour map of its own in front of them. An eight bit
 * pixel takes **two** bytes, a transparency and then an index into that map; a twenty four bit pixel takes
 * four, turned so that the first of them is the transparency. The reference reads a whole four byte block for
 * such a pixel and keeps what the last block left in its buffer when the stream ends inside one, so the
 * pictures at the end of a cut short stream repeat the block before them rather than turning to nothing.
 */
export function unpackBm2(stored: Buffer, layout: Bm2Layout): Buffer {
	const count = layout.width * layout.height;
	if (
		!Number.isSafeInteger(count) ||
		count * BYTES_PER_PIXEL > MAXIMUM_PICTURE_BYTES
	) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Aaru bitmap of ${count * BYTES_PER_PIXEL} bytes is too large`,
		);
	}
	const output: Buffer = Buffer.alloc(count * BYTES_PER_PIXEL, 0x00);
	if (DEPTH_8 === layout.bitsPerPixel) {
		const pixels = HEADER_SIZE + PALETTE_SIZE;
		if (pixels + count * 2 > stored.length) {
			throw invalidPicture("Aaru bitmap is cut short of its pixels");
		}
		const palette = stored.subarray(HEADER_SIZE, HEADER_SIZE + PALETTE_SIZE);
		for (let index = 0; index < count; index += 1) {
			const alpha = stored[pixels + index * 2] ?? 0;
			const entry = (stored[pixels + index * 2 + 1] ?? 0) * 4;
			output[index * 4] = palette[entry] ?? 0;
			output[index * 4 + 1] = palette[entry + 1] ?? 0;
			output[index * 4 + 2] = palette[entry + 2] ?? 0;
			output[index * 4 + 3] = alpha;
		}
		return output;
	}
	const block: Buffer = Buffer.alloc(BYTES_PER_PIXEL, 0x00);
	for (let index = 0; index < count; index += 1) {
		const at = HEADER_SIZE + index * BYTES_PER_PIXEL;
		const available = Math.max(
			0,
			Math.min(BYTES_PER_PIXEL, stored.length - at),
		);
		if (available > 0) {
			stored.copy(block, 0, at, at + available);
		}
		output[index * 4] = block[1] ?? 0;
		output[index * 4 + 1] = block[2] ?? 0;
		output[index * 4 + 2] = block[3] ?? 0;
		output[index * 4 + 3] = block[0] ?? 0;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const aaruBm2ImageDescriptor: FormatDescriptor = {
	id: "aaru-bm2-image",
	name: "Aaru bitmap format",
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
			source: "Legacy/Aaru/ImageBM2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aaruBm2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aaruBm2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readBm2Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBm2Layout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not an Aaru bitmap");
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
						compressed: false,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							// The reader builds thirty two bit pixels whatever the depth of the file says.
							bitsPerPixel: 32,
							offsetX: layout.offsetX,
							offsetY: layout.offsetY,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readBm2Layout(stored);
		if (!layout) {
			throw invalidPicture("Not an Aaru bitmap");
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, unpackBm2(stored, layout)),
		]);
	},
});
