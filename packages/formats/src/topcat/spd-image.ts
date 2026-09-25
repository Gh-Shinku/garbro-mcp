// Format reference: GARbro "ArcFormats/TopCat/ImageSPD.cs", classes `SpdFormat`, `SpdMetaData` and the
// `SpdReader` beside them.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The marks of the picture, of the place of a colour of a place of it: `SPDC`, `SPD8` and `SPD7`. */
const MARK_SIZE = 4;
const HEAD_SIZE = 0x14;
const WALK_POSITION = 0x14;
const MARKS = ["SPDC", "SPD8", "SPD7"];
const TYPE_LZ_RLE = 0x00;
const TYPE_LZ = 0x01;
const TYPE_LZ_RLE_ALPHA = 0x02;
const TYPE_LZ_RLE_2 = 0x100;
const TYPE_SPDC = 0x101;
const TYPE_LZ_RLE_ALPHA_2 = 0x102;
const TYPE_JPEG = 0x103;
const BITS_24 = 24;
const BITS_32 = 32;
const MAX_SIDE = 0x8000;
const PLACES_32 = 4;
const WIDE_BITS = 5;
const RAW_PLACES = 0x1b;
const OFFSET_KINDS = 28;

export interface SpdLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	method: number;
	unpackedSize: number;
	spdType: string;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `SpdFormat.ReadMetaData`: the head of the picture, of the places of the file of the words of it. */
export function readSpdLayout(data: Buffer): SpdLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const mark = data.subarray(0, MARK_SIZE).toString("latin1");
	if (!MARKS.includes(mark)) return undefined;
	const size = data.readUInt32LE(16);
	// The words of the head of the picture stand of the places of the file of the count of the places of the
	// picture: the reference takes them off the word of the places of the picture itself.
	const height =
		(data.readUInt32LE(12) - (((size >>> 2) & 0xf731) >>> 0)) >>> 0;
	const width = (data.readUInt32LE(8) - (((size << 2) & 0x137f) >>> 0)) >>> 0;
	const method = (data.readUInt32LE(4) - (((size << 4) & 0xffff) >>> 0)) >>> 0;
	const bitsPerPixel = method >>> 16;
	if (0 === width || 0 === height) return undefined;
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		method: method & 0xffff,
		unpackedSize: size,
		spdType: mark[3] ?? "C",
	};
}

/** The three marks the reference registers as its signatures. */
export function spdSignatures(): readonly { bytes: Uint8Array }[] {
	return MARKS.map((mark) => ({ bytes: Buffer.from(mark, "latin1") }));
}

/** The places of the file of the walk of the engine, of the places of the file of a byte of them. */
class SpdBits {
	private cached = 0;
	private bits = 0;

	constructor(
		private readonly data: Buffer,
		private at: number,
	) {}

	/** `SpdReader.GetBits`: the places of the file of the walk, of the highest place of them first. */
	getBits(count: number, peek = false): number {
		while (this.cached < count) {
			if (this.at >= this.data.length) return 0;
			const value = this.data[this.at] ?? 0;
			this.at += 1;
			this.bits = (this.bits << 8) | value | 0;
			this.cached += 8;
		}
		const mask = (1 << count) - 1;
		const left = this.cached - count;
		if (!peek) this.cached = left;
		return (this.bits >> left) & mask;
	}
}

/** The places of the file of the walk of the places of the picture, of the places of a byte of them. */
function readPlaces(output: Buffer, at: number): number {
	if (at + 4 > output.length) {
		throw invalidPicture(
			"The walk of the picture stands short of the places of it",
		);
	}
	return output.readInt32LE(at);
}

/** `SpdReader.UnpackLz`: the places of the picture, of the walks of the places of the file of it. */
function unpackLz(data: Buffer, output: Buffer): void {
	let dst = 0;
	let at = WALK_POSITION;
	while (dst < output.length) {
		if (at >= data.length) break;
		const control = data[at] ?? 0;
		at += 1;
		for (let bit = 1; 0x100 !== bit && dst < output.length; bit <<= 1) {
			if (0 !== (control & bit)) {
				if (at >= data.length) return;
				output[dst] = data[at] ?? 0;
				dst += 1;
				at += 1;
				continue;
			}
			if (at + 2 > data.length) return;
			const low = data[at] ?? 0;
			const high = data[at + 1] ?? 0;
			at += 2;
			const src = (low >> 4) | (high << 4);
			const count = Math.min(3 + (low & 0xf), output.length - dst);
			if (dst - src < 0) {
				throw invalidPicture(
					"The run of the walk stands of no places of the picture",
				);
			}
			copyOverlapped(output, dst - src, dst, count);
			dst += count;
		}
	}
}

/** `SpdReader.UnpackRle`: the places of a picture of four places of a colour, of the walks of the runs. */
function unpackRle(
	output: Buffer,
	rgb: Buffer,
	rgbPos: number,
	skipPos: number,
	ctlSrc: number,
): void {
	let src = readPlaces(output, rgbPos);
	if (src < 0)
		throw invalidPicture("The places of the colour of the picture stand short");
	let skip = 0 === readPlaces(output, skipPos);
	let dst = 0;
	let at = ctlSrc;
	while (dst < rgb.length) {
		const count = readPlaces(output, at);
		at += 4;
		if (skip) {
			if (count < 0 || dst + count * PLACES_32 > rgb.length) {
				throw invalidPicture(
					"The run of the walk stands past the places of the picture",
				);
			}
			dst += count * PLACES_32;
		} else {
			for (let place = 0; place < count; place += 1) {
				if (src + PLACES_32 > output.length || dst + PLACES_32 > rgb.length) {
					throw invalidPicture(
						"The run of the walk stands past the places of the picture",
					);
				}
				rgb[dst] = output[src] ?? 0;
				rgb[dst + 1] = output[src + 1] ?? 0;
				rgb[dst + 2] = output[src + 2] ?? 0;
				rgb[dst + 3] = 0xff;
				src += PLACES_32;
				dst += PLACES_32;
			}
		}
		skip = !skip;
	}
}

/** `SpdReader.UnpackRleAlpha`: the places of a picture, of the places of a colour and of the alpha of it. */
function unpackRleAlpha(output: Buffer, rgb: Buffer): void {
	let src = readPlaces(output, 0);
	if (src < 0)
		throw invalidPicture("The places of the colour of the picture stand short");
	let at = 8;
	let dst = 0;
	while (dst < rgb.length) {
		if (at + 2 > output.length) {
			throw invalidPicture(
				"The walk of the picture stands short of the places of it",
			);
		}
		let count = output.readUInt16LE(at);
		at += 2;
		const control = count >> 14;
		count &= 0x3fff;
		if (0 === control) {
			dst += PLACES_32 * count;
			continue;
		}
		for (let place = 0; place < count; place += 1) {
			if (dst + PLACES_32 > rgb.length || src + PLACES_32 > output.length) {
				throw invalidPicture(
					"The run of the walk stands past the places of the picture",
				);
			}
			rgb[dst] = output[src] ?? 0;
			rgb[dst + 1] = output[src + 1] ?? 0;
			rgb[dst + 2] = output[src + 2] ?? 0;
			rgb[dst + 3] = 1 === control ? 0xff : (output[at] ?? 0);
			if (1 !== control) at += 1;
			src += PLACES_32;
			dst += PLACES_32;
		}
	}
}

/** `SpdReader.UnpackSpdAlpha`: the places of a picture, of the places of the alpha of it. */
function unpackSpdAlpha(output: Buffer, rgb: Buffer, ctlSrc: number): void {
	let src = readPlaces(output, 0);
	if (src < 0)
		throw invalidPicture("The places of the colour of the picture stand short");
	let at = ctlSrc;
	let dst = 0;
	while (dst < rgb.length) {
		if (at >= output.length) {
			throw invalidPicture(
				"The walk of the picture stands short of the places of it",
			);
		}
		const control = output[at] ?? 0;
		at += 1;
		if (0 === control) {
			dst += PLACES_32 * ((output[at] ?? 0) + 1);
			at += 1;
			continue;
		}
		if (1 === control) {
			const count = (output[at] ?? 0) + 1;
			at += 1;
			for (let place = 0; place < count; place += 1) {
				if (dst + PLACES_32 > rgb.length || src + PLACES_32 > output.length) {
					throw invalidPicture(
						"The run of the walk stands past the places of the picture",
					);
				}
				rgb[dst] = output[src] ?? 0;
				rgb[dst + 1] = output[src + 1] ?? 0;
				rgb[dst + 2] = output[src + 2] ?? 0;
				rgb[dst + 3] = 0xff;
				src += PLACES_32;
				dst += PLACES_32;
			}
			continue;
		}
		if (dst + PLACES_32 > rgb.length || src + 3 > output.length) {
			throw invalidPicture(
				"The run of the walk stands past the places of the picture",
			);
		}
		rgb[dst] = output[src] ?? 0;
		rgb[dst + 1] = output[src + 1] ?? 0;
		rgb[dst + 2] = output[src + 2] ?? 0;
		rgb[dst + 3] = -control & 0xff;
		src += 3;
		dst += PLACES_32;
	}
}

/** `SpdReader.UnpackSpdc`: the places of a picture of the walk of the places of the picture itself. */
function unpackSpdc(data: Buffer, layout: SpdLayout, output: Buffer): void {
	const pixelSize = layout.bitsPerPixel / 8;
	const stride = pixelSize * layout.width;
	const offsets: number[] = [];
	for (let at = 0; at < OFFSET_KINDS; at += 1) {
		if (at < 16) offsets.push(-pixelSize);
		else if (at < 24) offsets.push(-stride);
		else if (at < 26) offsets.push(-stride - pixelSize);
		else offsets.push(-stride + pixelSize);
	}
	const bits = new SpdBits(data, WALK_POSITION);
	let dst = 0;
	for (let at = 0; at < pixelSize; at += 1) {
		output[dst] = bits.getBits(8);
		dst += 1;
	}
	while (dst < output.length) {
		const kind = bits.getBits(WIDE_BITS, true);
		if (kind > RAW_PLACES) {
			bits.getBits(3);
			output[dst + 2] = bits.getBits(8);
			output[dst + 1] = bits.getBits(8);
			output[dst] = bits.getBits(8);
		} else {
			const src = dst + (offsets[kind] ?? 0);
			if (src < 0 || dst + 3 > output.length) {
				throw invalidPicture(
					"The run of the walk stands of no places of the picture",
				);
			}
			output[dst] = output[src] ?? 0;
			output[dst + 1] = output[src + 1] ?? 0;
			output[dst + 2] = output[src + 2] ?? 0;
			bits.getBits((DIFF_PREFIX[kind] ?? 0) >> 1);
			if (0 !== ((DIFF_PREFIX[kind] ?? 0) & 1)) {
				const first = bits.getBits(8, true);
				const firstLength = DIFF_LENGTHS[first] ?? 0;
				const second = bits.getBits(8 + firstLength, true) & 0xff;
				const secondLength = DIFF_LENGTHS[second] ?? 0;
				const third = bits.getBits(8 + firstLength + secondLength, true) & 0xff;
				const thirdLength = DIFF_LENGTHS[third] ?? 0;
				output[dst] = ((output[dst] ?? 0) + (DIFF_TABLE[first] ?? 0)) & 0xff;
				output[dst + 1] =
					((output[dst + 1] ?? 0) +
						(((DIFF_TABLE[first] ?? 0) + (DIFF_TABLE[second] ?? 0)) & 0xff)) &
					0xff;
				output[dst + 2] =
					((output[dst + 2] ?? 0) +
						(((DIFF_TABLE[first] ?? 0) + (DIFF_TABLE[third] ?? 0)) & 0xff)) &
					0xff;
				bits.getBits(firstLength + secondLength + thirdLength);
			}
		}
		dst += pixelSize;
	}
}

/** The places of the file of the walk of the places of a picture of the engine, of the places of it. */
const DIFF_PREFIX: readonly number[] = [
	0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x4, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5, 0x5,
	0x5, 0x6, 0x6, 0x6, 0x6, 0x7, 0x7, 0x7, 0x7, 0xa, 0xb, 0xa, 0xb,
];

const DIFF_LENGTHS: readonly number[] = [
	8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
	7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
	5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3,
	3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
	3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3,
];

const DIFF_TABLE: readonly number[] = [
	0x10, 0x0f, 0x0e, 0x0d, 0x0c, 0x0b, 0x0a, 0x09, 0xf7, 0xf6, 0xf5, 0xf4, 0xf3,
	0xf2, 0xf1, 0xf0, 0x08, 0x08, 0x07, 0x07, 0x06, 0x06, 0x05, 0x05, 0xfb, 0xfb,
	0xfa, 0xfa, 0xf9, 0xf9, 0xf8, 0xf8, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04,
	0x04, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0xfd, 0xfd, 0xfd, 0xfd,
	0xfd, 0xfd, 0xfd, 0xfd, 0xfc, 0xfc, 0xfc, 0xfc, 0xfc, 0xfc, 0xfc, 0xfc, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x02,
	0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02,
	0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02,
	0x02, 0x02, 0x02, 0x02, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
	0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
	0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
	0xff, 0xff, 0xff, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe,
	0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe,
	0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe, 0xfe,
];

/** `SpdFormat.Read`: the picture of the walk of the engine, handed over as a bitmap. */
export function unpackSpdPicture(data: Buffer, layout: SpdLayout): Buffer {
	if (TYPE_JPEG === layout.method) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"the places of a picture of the walk of the engine stand of the walks of the places of a JPEG of their own",
		);
	}
	if (BITS_24 !== layout.bitsPerPixel && BITS_32 !== layout.bitsPerPixel) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`the places of a colour of a place of the picture stand of no walk of the engine: ${layout.bitsPerPixel}`,
		);
	}
	const output: Buffer = Buffer.alloc(layout.unpackedSize, 0x00);
	if (TYPE_SPDC === layout.method) {
		unpackSpdc(data, layout, output);
	} else if (TYPE_LZ === layout.method) {
		unpackLz(data, output);
	} else if (
		TYPE_LZ_RLE === layout.method ||
		TYPE_LZ_RLE_2 === layout.method ||
		TYPE_LZ_RLE_ALPHA === layout.method ||
		TYPE_LZ_RLE_ALPHA_2 === layout.method
	) {
		unpackLz(data, output);
		const rgb: Buffer = Buffer.alloc(
			layout.height * layout.width * PLACES_32,
			0x00,
		);
		if (TYPE_LZ_RLE === layout.method || TYPE_LZ_RLE_2 === layout.method) {
			if ("7" === layout.spdType) unpackRle(output, rgb, 4, 0, 8);
			else unpackRle(output, rgb, 0, 8, 12);
		} else if ("8" === layout.spdType) unpackSpdAlpha(output, rgb, 8);
		else if ("7" === layout.spdType) unpackSpdAlpha(output, rgb, 4);
		else unpackRleAlpha(output, rgb);
		return writeBmp32(layout.width, layout.height, rgb);
	} else {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`the places of the picture stand of no walk of the engine: ${layout.method}`,
		);
	}
	if (BITS_24 === layout.bitsPerPixel) {
		return writeBmp24(layout.width, layout.height, output);
	}
	return writeBmp32(layout.width, layout.height, output);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const spdImageDescriptor: FormatDescriptor = {
	id: "topcat-spd-image",
	name: "TopCat compressed image",
	extensions: ["spd"],
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
			source: "ArcFormats/TopCat/ImageSPD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const spdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: spdImageDescriptor,
	detection: { signatures: spdSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readSpdLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readSpdLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the TopCat engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					method: layout.method,
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
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readSpdLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the TopCat engine");
		return Readable.from([unpackSpdPicture(data, layout)]);
	},
});
