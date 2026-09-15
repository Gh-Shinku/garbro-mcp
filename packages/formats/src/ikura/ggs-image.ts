// Format reference: GARbro "ArcFormats/Ikura/ImageGGS.cs", classes `GgsFormat` and `GgsReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
/** How long a side of a picture the reference is willing to read. */
const SIDE_LIMIT = 0x4000;
const BYTES_PER_PIXEL = 3;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GgsLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The reference reads the format only out of files named `.ggs`, since it declares no signature at all. */
function hasExtension(sourcePath: string): boolean {
	return sourcePath
		.replace(/^.*[/\\]/, "")
		.toLowerCase()
		.endsWith(".ggs");
}

/**
 * `GgsFormat.ReadMetaData`: the place the picture stands at — which this format reports as it stands, where
 * the sibling format of the same engine turns it about — then the measurements, both of which have to stand
 * above nothing and no further than `0x4000`.
 */
export function readGgsLayout(data: Buffer): GgsLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const offsetX = data.readInt16LE(0);
	const offsetY = data.readInt16LE(2);
	const width = data.readUInt16LE(4);
	const height = data.readUInt16LE(6);
	if (0 === width || 0 === height) return undefined;
	if (width > SIDE_LIMIT || height > SIDE_LIMIT) return undefined;
	if (offsetX < 0 || offsetY < 0) return undefined;
	return { width, height, offsetX, offsetY };
}

/**
 * `GgsReader.Unpack`: the pixels of the three colour channels are walked one channel at a time through the
 * same stream, each of them writing every third byte of the picture. A step is chosen by a control byte:
 *
 * | control | what it does |
 * | --- | --- |
 * | `0` | fills the next bytes with the byte behind the count, which stands behind the control |
 * | `1` | copies the next bytes from a place behind, counted in the stream of pixels, and no further than a byte away |
 * | `2` | the same, with a place two bytes long |
 * | `3` | steps over that many pixels, leaving them as they stand |
 * | `4` | the same, with a count two bytes long |
 * | five and above | that many bytes minus five stand in the stream themselves |
 *
 * A copy whose place reaches before the start of the picture is refused; a copy from no place at all reads the
 * byte it is about to write, which stands at nothing, exactly as the reference's own reader does.
 */
export function unpackGgs(data: Buffer, layout: GgsLayout): Buffer {
	const pixels: Buffer = Buffer.alloc(
		layout.width * layout.height * BYTES_PER_PIXEL,
		0x00,
	);
	let at = HEADER_SIZE;
	const readByte = (): number => {
		if (at >= data.length) {
			throw invalidPicture("D.O. picture is cut short of its stream");
		}
		const value = data[at] ?? 0;
		at += 1;
		return value;
	};
	const readWord = (): number => readByte() | (readByte() << 8);
	for (let channel = 0; channel < BYTES_PER_PIXEL; channel += 1) {
		let dst = channel;
		while (dst < pixels.length) {
			const control = readByte();
			if (0 === control) {
				let count = readByte();
				const value = readByte();
				while (count > 0) {
					writeGgsByte(pixels, dst, value);
					dst += BYTES_PER_PIXEL;
					count -= 1;
				}
			} else if (1 === control) {
				let count = readByte();
				const offset = readByte();
				while (count > 0) {
					copyGgsByte(pixels, dst, offset);
					dst += BYTES_PER_PIXEL;
					count -= 1;
				}
			} else if (2 === control) {
				let count = readByte();
				const offset = readWord();
				while (count > 0) {
					copyGgsByte(pixels, dst, offset);
					dst += BYTES_PER_PIXEL;
					count -= 1;
				}
			} else if (3 === control) {
				// The reference counts the steps over in bytes rather than in pixels.
				dst += readByte();
			} else if (4 === control) {
				dst += readWord();
			} else {
				let count = control - 5;
				while (count > 0) {
					writeGgsByte(pixels, dst, readByte());
					dst += BYTES_PER_PIXEL;
					count -= 1;
				}
			}
		}
	}
	return pixels;
}

function writeGgsByte(pixels: Buffer, dst: number, value: number): void {
	if (dst >= pixels.length) {
		throw invalidPicture("D.O. picture writes past its own end");
	}
	pixels[dst] = value;
}

function copyGgsByte(pixels: Buffer, dst: number, offset: number): void {
	const from = dst - offset;
	if (from < 0) {
		throw invalidPicture("D.O. picture copies from before its start");
	}
	writeGgsByte(pixels, dst, pixels[from] ?? 0);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ikuraGgsImageDescriptor: FormatDescriptor = {
	id: "ikura-ggs-image",
	name: "D.O. image format",
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
			source: "ArcFormats/Ikura/ImageGGS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikuraGgsImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikuraGgsImageDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		if (!hasExtension(sourcePath)) return false;
		return readGgsLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGgsLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a D.O. picture");
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
							bitsPerPixel: BYTES_PER_PIXEL * 8,
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
				bitsPerPixel: BYTES_PER_PIXEL * 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGgsLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a D.O. picture");
		}
		const size = layout.width * layout.height * BYTES_PER_PIXEL;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`D.O. picture of ${size} bytes is too large`,
			);
		}
		const pixels = unpackGgs(stored, layout);
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, false),
		]);
	},
});
