// Format reference: GARbro "Legacy/Zone/ImageBM_.cs", classes `Bm_Format` and `Bm_MetaData` (Zone
// compressed image). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The format is told apart by the name of its file, which the reference asks for and nothing else. */
const EXTENSION = ".bm_";
const HEADER_SIZE = 0x18;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
/** The colour map of two hundred and fifty six entries sits between the header and the flags. */
const PALETTE_SIZE = 0x100 * 4;
/** The byte the runs of the picture are told apart by, behind the colour map and eleven bytes more. */
const FLAG_OFFSET = HEADER_SIZE + PALETTE_SIZE + 12;
/** And the pixels behind that. */
const PIXELS_OFFSET = FLAG_OFFSET + 1;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface BmLayout {
	width: number;
	height: number;
	/** Whether the pixels are stored as runs rather than as they are. */
	isCompressed: boolean;
	/** The byte a run is written with, which is the one that tells a run from a pixel. */
	rleFlag: number;
}

function hasExtension(sourcePath: string): boolean {
	const fileName = sourcePath.replace(/^.*[/\\]/, "").toLowerCase();
	return fileName.endsWith(EXTENSION);
}

/**
 * The reference's `Bm_Format.ReadMetaData`: the first long word says whether the pixels are stored as runs,
 * the two behind it measure the picture, and the byte behind the colour map is the one runs are written with.
 * A file whose name does not end with `.bm_` is not one this format claims.
 */
export function readBmLayout(
	data: Buffer,
	sourcePath?: string,
): BmLayout | undefined {
	if (sourcePath !== undefined && !hasExtension(sourcePath)) return undefined;
	if (data.length < PIXELS_OFFSET) return undefined;
	if (data.length < HEADER_SIZE) return undefined;
	const signature = data.readInt32LE(0);
	if (0 !== signature && 1 !== signature) return undefined;
	return {
		width: data.readUInt32LE(WIDTH_FIELD),
		height: data.readUInt32LE(HEIGHT_FIELD),
		isCompressed: 0 !== signature,
		rleFlag: data[FLAG_OFFSET] ?? 0,
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The stream the runs are read from, with every read checked against the length of the file. */
class BmStream {
	#at: number;

	constructor(
		readonly data: Buffer,
		at: number,
	) {
		this.#at = at;
	}

	byte(): number {
		if (this.#at >= this.data.length) {
			throw invalidPicture("Unexpected end of Zone picture");
		}
		const value = this.data[this.#at] ?? 0;
		this.#at += 1;
		return value;
	}
}

/**
 * The reference's `Bm_Format.ReadRle`: a byte of the picture is either a pixel of its own, the byte runs are
 * written with, or the count of a run. A count of nothing behind the flag stands for the flag itself, and a
 * count that starts with ones carries on in the bytes behind them, of which the last one is followed by a byte
 * the run leaves behind.
 */
function unpackRle(stream: BmStream, output: Buffer, flag: number): void {
	let at = 0;
	while (at < output.length) {
		const first = stream.byte();
		if (flag !== first) {
			output[at] = first;
			at += 1;
			continue;
		}
		let count = stream.byte();
		if (0 === count) {
			output[at] = flag;
			at += 1;
			continue;
		}
		let total = 0;
		while (1 === count) {
			total += 0x100;
			count = stream.byte();
		}
		total += count;
		if (0 !== count) stream.byte();
		const value = stream.byte();
		if (at + total > output.length) {
			throw invalidPicture("Zone run reaches outside its picture");
		}
		output.fill(value, at, at + total);
		at += total;
	}
}

/** The pixels of a picture that is not stored as runs, which are kept from the bottom row up. */
function readPlainPixels(data: Buffer, layout: BmLayout): Buffer {
	const length = layout.width * layout.height;
	if (data.length < PIXELS_OFFSET + length) {
		throw invalidPicture("Zone picture is cut short of its pixels");
	}
	const pixels: Buffer = Buffer.alloc(length, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		data.copy(
			pixels,
			row * layout.width,
			PIXELS_OFFSET + (layout.height - 1 - row) * layout.width,
			PIXELS_OFFSET + (layout.height - row) * layout.width,
		);
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const zoneBmImageDescriptor: FormatDescriptor = {
	id: "zone-bm-image",
	name: "Zone compressed image",
	extensions: ["bm_"],
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
			source: "Legacy/Zone/ImageBM_.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const zoneBmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: zoneBmImageDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return readBmLayout(await readStored(source), sourcePath) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBmLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Zone picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Zone picture size ${layout.width}x${layout.height}`,
			);
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
						compressed: layout.isCompressed,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: 8,
							isCompressed: layout.isCompressed,
							rleFlag: layout.rleFlag,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: layout.isCompressed ? "zone-rle" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const stored = await readStored(source);
		const layout = readBmLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Zone picture");
		}
		if (layout.width <= 0 || layout.height <= 0) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unsupported Zone picture size ${layout.width}x${layout.height}`,
			);
		}
		const length = layout.width * layout.height;
		if (!Number.isSafeInteger(length) || length > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Zone picture of ${length} bytes is too large`,
			);
		}
		const palette = Buffer.from(
			stored.subarray(HEADER_SIZE, HEADER_SIZE + PALETTE_SIZE),
		);
		if (palette.length !== PALETTE_SIZE) {
			throw invalidPicture("Zone picture carries no colour map");
		}
		let pixels: Buffer;
		if (layout.isCompressed) {
			pixels = Buffer.alloc(length, 0x00);
			unpackRle(new BmStream(stored, PIXELS_OFFSET), pixels, layout.rleFlag);
		} else {
			pixels = readPlainPixels(stored, layout);
		}
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette),
		]);
	},
});
