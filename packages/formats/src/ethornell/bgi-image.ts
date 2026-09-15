// Format reference: GARbro "ArcFormats/Ethornell/ImageBGI.cs", classes `BgiFormat` and `BgiMetaData` (the
// picture format of the BGI/Ethornell engine). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x10;
/** The depths the reference takes, of which the smallest is a grey picture. */
const DEPTHS: readonly number[] = [8, 24, 32];
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface BgiLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Whether the pixels are stored as running sums over a walk that turns at every row. */
	scrambled: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BgiFormat.ReadMetaData`: four words of the engine — the measurements, the depth and a flag — and eight
 * bytes of nothing, which is where the pixels begin. A picture of no width or height, of another depth, or
 * with a flag other than nothing or one is turned away, as is one whose eight bytes are not nothing.
 */
export function readBgiLayout(data: Buffer): BgiLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const width = data.readInt16LE(0);
	const height = data.readInt16LE(2);
	if (width <= 0 || height <= 0) return undefined;
	const bitsPerPixel = data.readInt16LE(4);
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	const flag = data.readInt16LE(6);
	if (0 !== flag && 1 !== flag) return undefined;
	if (0n !== data.readBigInt64LE(8)) return undefined;
	return { width, height, bitsPerPixel, scrambled: 1 === flag };
}

/** How many bytes the pixels of a picture of these measurements take. */
export function bgiPixelBytes(layout: BgiLayout): number {
	return layout.width * (layout.bitsPerPixel >> 3) * layout.height;
}

/**
 * `BgiFormat.RestorePixels`: the planes of the picture stand one behind the other — the blue one first and
 * the grey one alone — and every plane is a walk of running sums that turns at the end of each row: a row is
 * read forwards, the next one backwards, and the sum runs on across the turn. A picture whose stream stops
 * before its pixels are all there is refused, since the .NET reader the reference uses throws there, as is a
 * walk that would reach outside the pixels of the picture.
 */
export function restoreBgiPixels(data: Buffer, layout: BgiLayout): Buffer {
	const bytesPerPixel = layout.bitsPerPixel >> 3;
	const stride = layout.width * bytesPerPixel;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let position = HEADER_SIZE;
	const readByte = (): number => {
		if (position >= data.length) {
			throw invalidPicture("BGI picture is cut short of its pixels");
		}
		const value = data[position] ?? 0;
		position += 1;
		return value;
	};
	for (let plane = 0; plane < bytesPerPixel; plane += 1) {
		let dst = plane;
		let incr = 0;
		let remaining = layout.height;
		while (remaining > 0) {
			for (let w = 0; w < layout.width; w += 1) {
				incr = (incr + readByte()) & 0xff;
				if (dst >= pixels.length) {
					throw invalidPicture("BGI picture writes past its own end");
				}
				pixels[dst] = incr;
				dst += bytesPerPixel;
			}
			remaining -= 1;
			if (0 === remaining) break;
			dst += stride;
			let pos = dst;
			for (let w = 0; w < layout.width; w += 1) {
				pos -= bytesPerPixel;
				incr = (incr + readByte()) & 0xff;
				if (pos < 0 || pos >= pixels.length) {
					throw invalidPicture("BGI picture writes past its own end");
				}
				pixels[pos] = incr;
			}
			remaining -= 1;
		}
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ethornellBgiImageDescriptor: FormatDescriptor = {
	id: "ethornell-bgi-image",
	name: "BGI/Ethornell image format",
	extensions: ["", "bgi", "_bg", "bg"],
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
			source: "ArcFormats/Ethornell/ImageBGI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ethornellBgiImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ethornellBgiImageDescriptor,
	// The reference registers the word of nothing and leans on the extension list, which holds nothing, `bgi`,
	// `_bg` and `bg` for the pictures of the engine.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readBgiLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBgiLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a BGI picture");
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
						compressed: layout.scrambled,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: layout.scrambled ? "delta" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readBgiLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a BGI picture");
		}
		const size = bgiPixelBytes(layout);
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`BGI picture of ${size} bytes is too large`,
			);
		}
		let pixels: Buffer;
		if (!layout.scrambled) {
			// The pixels stand as they are, and a picture that is shorter than its measurements say is refused,
			// which is what the reference's own length check does.
			if (HEADER_SIZE + size > stored.length) {
				throw invalidPicture("BGI picture is cut short of its pixels");
			}
			pixels = Buffer.from(stored.subarray(HEADER_SIZE, HEADER_SIZE + size));
		} else {
			pixels = restoreBgiPixels(stored, layout);
		}
		// The smallest depth of the reference is a grey picture, which is written out with a grey ramp.
		let bitmap: Buffer;
		if (8 === layout.bitsPerPixel) {
			bitmap = writeBmp8(layout.width, layout.height, pixels);
		} else if (32 === layout.bitsPerPixel) {
			bitmap = writeBmp32(layout.width, layout.height, pixels);
		} else {
			bitmap = writeBmp24(layout.width, layout.height, pixels);
		}
		return Readable.from([bitmap]);
	},
});
