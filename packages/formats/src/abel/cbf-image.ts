import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURES = [
	Buffer.from("CBF0", "latin1"),
	Buffer.from("CBF1", "latin1"),
	Buffer.from("CBF2", "latin1"),
	Buffer.from("CBF3", "latin1"),
];
const HEADER_SIZE = 0x18;
/** The word behind the head has to stand at one. */
const FLAG_FIELD = 0x10;
/** The three byte places of a picture and the blocks of eight places by eight its walk knows. */
const PLACES = 3;
const BLOCK = 8;
const BLOCK_PLACES = BLOCK * BLOCK;
/** Where a walk of the LZSS kind begins, and where a walk of runs behind one begins. */
const WALK_FIELD = 0x18;
const WALK_BEHIND_FIELD = 0x1c;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

const ZIGZAG_ORDER = new Uint8Array([
	0x00, 0x01, 0x08, 0x10, 0x09, 0x02, 0x03, 0x0a, 0x11, 0x18, 0x20, 0x19, 0x12,
	0x0b, 0x04, 0x05, 0x0c, 0x13, 0x1a, 0x21, 0x28, 0x30, 0x29, 0x22, 0x1b, 0x14,
	0x0d, 0x06, 0x07, 0x0e, 0x15, 0x1c, 0x23, 0x2a, 0x31, 0x38, 0x39, 0x32, 0x2b,
	0x24, 0x1d, 0x16, 0x0f, 0x17, 0x1e, 0x25, 0x2c, 0x33, 0x3a, 0x3b, 0x34, 0x2d,
	0x26, 0x1f, 0x27, 0x2e, 0x35, 0x3c, 0x3d, 0x36, 0x2f, 0x37, 0x3e, 0x3f,
]);

export interface CbfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	compression: number;
	/** How many bytes stand in a row of the picture. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readCbfLayout(
	data: Buffer,
	fileLength = data.length,
): CbfLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const word = data.subarray(0, 4);
	if (!SIGNATURES.some((signature) => word.equals(signature))) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	if (1 !== data.readInt32LE(FLAG_FIELD)) return undefined;
	const compression = (data[3] ?? 0) - 0x30;
	if (compression < 0 || compression > 3) return undefined;
	const width = data.readUInt32LE(4);
	const height = data.readUInt32LE(8);
	const bitsPerPixel = data.readInt32LE(12);
	if (width <= 0 || height <= 0) return undefined;
	if (width * height * PLACES > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		compression,
		stride: PLACES * width,
	};
}

function unpackCbfLzss(input: Buffer, layout: CbfLayout): Buffer {
	const size = layout.stride * layout.height;
	const places = inflateLzss(input, { outputLength: size });
	for (let at = PLACES; at < places.length; at += 1) {
		places[at] = ((places[at] ?? 0) + (places[at - PLACES] ?? 0)) & 0xff;
	}
	const pixels: Buffer = Buffer.alloc(size, 0x00);
	let src = 0;
	for (let y = 0; y < layout.height; y += BLOCK) {
		for (let x = 0; x < layout.stride; x += BLOCK * PLACES) {
			const dst = x + y * layout.stride;
			for (let place = 0; place < BLOCK_PLACES; place += 1) {
				const order = ZIGZAG_ORDER[place] ?? 0;
				const at = dst + (order & 7) * PLACES + (order >> 3) * layout.stride;
				if (at + PLACES > pixels.length || src + PLACES > places.length) {
					throw invalidPicture("Abel picture walks beyond its own places");
				}
				pixels[at] = places[src] ?? 0;
				pixels[at + 1] = places[src + 1] ?? 0;
				pixels[at + 2] = places[src + 2] ?? 0;
				src += PLACES;
			}
		}
	}
	return pixels;
}

function unpackCbfRle(input: Buffer, size: number): Buffer {
	const pixels: Buffer = Buffer.alloc(size, 0x00);
	let dst = 0;
	let at = 0;
	while (dst < pixels.length) {
		if (at + PLACES > input.length) break;
		pixels[dst] = input[at] ?? 0;
		pixels[dst + 1] = input[at + 1] ?? 0;
		pixels[dst + 2] = input[at + 2] ?? 0;
		at += PLACES;
		const count = input[at] ?? 0;
		at += 1;
		if (count > 0) {
			const run = count * PLACES;
			if (!copyOverlapped(pixels, dst, dst + PLACES, run - PLACES)) {
				throw invalidPicture("Abel picture walks beyond its own places");
			}
			dst += run;
		} else {
			dst += PLACES;
		}
	}
	return pixels;
}

export function decodeCbf(data: Buffer, layout: CbfLayout): Buffer {
	const size = layout.stride * layout.height;
	if (0 === layout.compression) {
		if (WALK_FIELD + size > data.length) {
			throw invalidPicture("Abel picture is cut short of its places");
		}
		return Buffer.from(data.subarray(WALK_FIELD, WALK_FIELD + size));
	}
	if (1 === layout.compression) {
		if (WALK_FIELD >= data.length) {
			throw invalidPicture("Abel picture is cut short of its walk");
		}
		return unpackCbfLzss(data.subarray(WALK_FIELD), layout);
	}
	if (2 === layout.compression) {
		if (WALK_FIELD >= data.length) {
			throw invalidPicture("Abel picture is cut short of its walk");
		}
		return unpackCbfRle(data.subarray(WALK_FIELD), size);
	}
	if (WALK_BEHIND_FIELD >= data.length) {
		throw invalidPicture("Abel picture is cut short of its walk");
	}
	const unpacked = inflateLzss(data.subarray(WALK_BEHIND_FIELD), {
		outputLength: size,
	});
	return unpackCbfRle(unpacked, size);
}

export function readCbfAlpha(data: Buffer): Buffer | undefined {
	if (data.length < 0x10) return undefined;
	if (!data.subarray(0, 4).equals(Buffer.from("ALP1", "latin1")))
		return undefined;
	const size = data.readInt32LE(8);
	if (size <= 0 || size > LIMIT) return undefined;
	const alpha: Buffer = Buffer.alloc(size, 0x00);
	let dst = 0;
	let at = 0x10;
	while (dst < alpha.length) {
		if (at + 2 > data.length) break;
		const value = data[at] ?? 0;
		const count = data[at + 1] ?? 0;
		at += 2;
		for (let index = 0; index < count && dst < alpha.length; index += 1) {
			alpha[dst] = value;
			dst += 1;
		}
	}
	return alpha;
}

export function mergeCbfAlpha(
	pixels: Buffer,
	layout: CbfLayout,
	alpha: Buffer,
): Buffer {
	const merged: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let src = 0;
	for (let dst = 0; dst < merged.length; dst += 4) {
		merged[dst] = pixels[src] ?? 0;
		merged[dst + 1] = pixels[src + 1] ?? 0;
		merged[dst + 2] = pixels[src + 2] ?? 0;
		merged[dst + 3] = alpha[src / PLACES] ?? 0;
		src += PLACES;
	}
	return merged;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readCompanionAlpha(
	sourcePath: string,
): Promise<Buffer | undefined> {
	const name = changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "alp");
	const stored = await readCompanionFile(sourcePath, name);
	if (!stored) return undefined;
	try {
		return readCbfAlpha(stored);
	} catch {
		// The reference lets a shape that does not stand there be and hands the picture out without it.
		return undefined;
	}
}

/** The picture of the file, with the shape of its places where that stands beside it. */
async function readCbfImage(
	stored: Buffer,
	layout: CbfLayout,
	sourcePath: string,
): Promise<Buffer> {
	const pixels = decodeCbf(stored, layout);
	const alpha = sourcePath ? await readCompanionAlpha(sourcePath) : undefined;
	if (!alpha) return writeBmp24(layout.width, layout.height, pixels);
	return writeBmp32(
		layout.width,
		layout.height,
		mergeCbfAlpha(pixels, layout, alpha),
	);
}

export const abelCbfImageDescriptor: FormatDescriptor = {
	id: "abel-cbf-image",
	name: "Abel image format",
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
			source: "ArcFormats/Abel/ImageCBF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const abelCbfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abelCbfImageDescriptor,
	// The reference registers the four words `CBF0` to `CBF3` and no name at all.
	detection: {
		signatures: SIGNATURES.map((bytes) => ({ bytes })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readCbfLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readCbfLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Abel picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(WALK_FIELD),
				size: source.size - BigInt(WALK_FIELD),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 24,
				},
			}),
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: 24 },
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readCbfLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Abel picture");
		return Readable.from([await readCbfImage(stored, layout, sourcePath)]);
	},
});
