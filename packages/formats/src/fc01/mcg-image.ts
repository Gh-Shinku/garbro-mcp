// Port of GARbro "ArcFormats/FC01/ImageMCG.cs" (tag "MCG", class McgFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A picture of the engine of F&C of three walks of
// the places of the file, of the walks of the words of the `MrgDecoder` codec of it, of the places of the
// picture of the three places of a place of them.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { MrgDecoder } from "./mrg-decoder.js";

const HEAD_SIZE = 0x40;
/** The mark of the engine at 0 (`MCG `), of the places of the version of it at 4 and of the point of the
 * version of it at 5. */
const MARK = "MCG ";
const VERSION_POINT = 5;
const VERSION_BASE = 0x14d0;
/** The versions of the engine, of the walk of the places of the file of it. */
const VERSIONS = [200, 101, 100] as const;
/** The places of the picture of a place of the colour of it: the green, the blue and the red of it. */
const CHANNEL_ORDER = [1, 0, 2] as const;
/** The count of the walks of the places of the file of a picture of the engine. */
const PLANES = 3;
/** The count of the places of the file of a word of the masks of the channels of a picture. */
const MASK_SIZE = 4;
/** The lowest count of the places of the file a picture of the walk of the words of it stands of. */
const DECODER_HEAD_SIZE = 0x108;

export interface Fc01McgLayout {
	version: number;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	channelsCount: number;
	dataOffset: number;
	packedSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedPicture(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** `McgFormat.ReadMetaData`. */
export function readFc01McgLayout(data: Buffer): Fc01McgLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (data.toString("latin1", 0, MARK.length) !== MARK) return undefined;
	if (0x2e !== data[VERSION_POINT]) return undefined;
	const version =
		(data[4] ?? 0) * 100 + (data[6] ?? 0) * 10 + (data[7] ?? 0) - VERSION_BASE;
	if (!VERSIONS.includes(version as (typeof VERSIONS)[number]))
		return undefined;
	const width = data.readUInt32LE(0x1c);
	const height = data.readUInt32LE(0x20);
	const bitsPerPixel = data.readInt32LE(0x24);
	if (0 === width || 0 === height) return undefined;
	if (24 !== bitsPerPixel && 16 !== bitsPerPixel && 8 !== bitsPerPixel) {
		return undefined;
	}
	const dataOffset = data.readInt32LE(0x10);
	if (dataOffset < HEAD_SIZE) return undefined;
	return {
		version,
		width,
		height,
		offsetX: data.readInt32LE(0x14),
		offsetY: data.readInt32LE(0x18),
		bitsPerPixel,
		channelsCount: data.readInt32LE(0x34),
		dataOffset,
		packedSize: data.readInt32LE(0x38),
	};
}

/** `McgDecoder.Transform`: the places of the picture of the places of the file behind them. */
export function transformMcgPicture(
	pixels: Buffer,
	width: number,
	height: number,
): void {
	const stride = width * 3;
	// The places of the row of the file stand of the places of the row behind them, of the count of the
	// places of the three places of a place of them.
	let at = 0;
	for (let row = height - 1; row > 0; row -= 1) {
		for (let x = stride - 3; x > 0; x -= 1) {
			const base = pixels[at] ?? 0;
			let down = (pixels[at + stride] ?? 0) - base;
			let right = (pixels[at + 3] ?? 0) - base;
			const diagonal = Math.abs(right + down);
			down = Math.abs(down);
			right = Math.abs(right);
			let predicted: number;
			if (diagonal >= right && down >= right) {
				predicted = pixels[at + stride] ?? 0;
			} else if (diagonal < down) {
				predicted = pixels[at] ?? 0;
			} else {
				predicted = pixels[at + 3] ?? 0;
			}
			const target = at + stride + 3;
			pixels[target] =
				((pixels[target] ?? 0) + ((predicted + 0x80) & 0xff)) & 0xff;
			at += 1;
		}
		at += 3;
	}
	// The places of the picture stand of the three places of a place of them: the green of a place and
	// the blue and the red of it, of the count of the places of the blue and the red of it.
	const count = width * height;
	let place = 0;
	for (let i = 0; i < count; i += 1) {
		const blue = signedPlace(-128 + signedPlace(pixels[place] ?? 0));
		const red = signedPlace(-128 + signedPlace(pixels[place + 2] ?? 0));
		const green = (pixels[place + 1] ?? 0) - ((blue + red) >> 2);
		pixels[place] = (blue + green) & 0xff;
		pixels[place + 1] = green & 0xff;
		pixels[place + 2] = (red + green) & 0xff;
		place += 3;
	}
}

/** A place of the file of the engine of the places of the file of it. */
function signedPlace(value: number): number {
	return (value << 24) >> 24;
}

/** `McgDecoder.Unpack` of a picture of the places of the file of the walk of the words of them. */
export function unpackMcgPicture(data: Buffer, layout: Fc01McgLayout): Buffer {
	if (200 !== layout.version) {
		throw unsupportedPicture(
			"the places of the file of a picture of the engine of a version behind 2.00 stand of the password of the picture, of the medium of the engine",
		);
	}
	if (24 !== layout.bitsPerPixel) {
		throw unsupportedPicture(
			"a picture of the engine of a count of the places of a colour of its own of the version 2.00 stands of no walk of it",
		);
	}
	const end = 0 !== layout.packedSize ? layout.packedSize : data.length;
	let at = layout.dataOffset;
	let size = end - at;
	if (layout.channelsCount > 0) {
		// The masks of the channels of the picture stand behind the places of the head of it, of the
		// places of the file of them.
		at += layout.channelsCount * MASK_SIZE;
		size -= layout.channelsCount * MASK_SIZE;
	}
	if (size < 0 || at + size > data.length) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	if (size < DECODER_HEAD_SIZE) {
		throw invalidPicture(
			"The walk of the places of the picture stands short of the file",
		);
	}
	const payload = data.subarray(at, at + size);
	const count = layout.width * layout.height;
	const planes: Buffer[] = [];
	let key = -1;
	for (let attempt = 0; attempt <= 0xff; attempt += 1) {
		const decoder = new MrgDecoder(payload, 0, count);
		decoder.resetKey(attempt);
		const walked: Buffer[] = [];
		try {
			for (let plane = 0; plane < PLANES; plane += 1) {
				decoder.unpack();
				walked.push(Buffer.from(decoder.data));
			}
		} catch (error) {
			if (error instanceof GarbroError && "INVALID_ARCHIVE" === error.code)
				continue;
			throw error;
		}
		planes.push(...walked);
		key = attempt;
		break;
	}
	if (key < 0) {
		throw unsupportedPicture(
			"the password of the picture of the engine stands of the places of the file of it alone",
		);
	}
	const pixels: Buffer = Buffer.alloc(count * 3, 0x00);
	for (let plane = 0; plane < PLANES; plane += 1) {
		const source = planes[plane];
		if (!source) continue;
		let from = 0;
		for (let to = CHANNEL_ORDER[plane] ?? 0; to < pixels.length; to += 3) {
			pixels[to] = source[from] ?? 0;
			from += 1;
		}
	}
	transformMcgPicture(pixels, layout.width, layout.height);
	return writeBmp24(layout.width, layout.height, pixels);
}

export const fc01McgImageDescriptor: FormatDescriptor = {
	id: "fc01-mcg-image",
	name: "F&C Co. image",
	extensions: ["mcg"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/FC01/ImageMCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const fc01McgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fc01McgImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARK, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readFc01McgLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readFc01McgLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the F&C engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					version: layout.version,
					channelsCount: layout.channelsCount,
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
				version: layout.version,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readFc01McgLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the F&C engine");
		return Readable.from([unpackMcgPicture(data, layout)]);
	},
});
