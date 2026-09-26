// Port of GARbro "ArcFormats/Ivory/ImageSG.cs" (tag "SG", classes SgFormat, SgRgbReader), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The picture stands either of the places of the
// file itself or of a picture of a kind of its own, standing behind a key.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { decryptIvory } from "./pk.js";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("fSG ", "latin1");
const HEAD_SIZE = 8;
const BLOCK_SIZE = 0x24;
const RGB_KIND = "cRGB";
const JPG_KIND = "cJPG";
const MAX_COLORS = 0x100;

export interface SgLayout {
	kind: "rgb" | "jpeg";
	width: number;
	height: number;
	bitsPerPixel: number;
	offsetX: number;
	offsetY: number;
	dataOffset: number;
	dataSize: number;
	rgbMode: number;
	jpegKey: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `SgFormat.ReadMetaData`. */
export function readSgLayout(data: Buffer): SgLayout | undefined {
	if (data.length < HEAD_SIZE + BLOCK_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const at = HEAD_SIZE;
	const kind = data.subarray(at, at + 4).toString("latin1");
	const headerSize = data.readInt32LE(at + 8);
	const dataSize = data.readInt32LE(at + 0xc);
	const dataOffset = HEAD_SIZE + headerSize;
	if (dataOffset < HEAD_SIZE + BLOCK_SIZE || dataOffset > data.length) {
		return undefined;
	}
	if (RGB_KIND === kind) {
		return {
			kind: "rgb",
			width: data.readUInt16LE(at + 0x1c),
			height: data.readUInt16LE(at + 0x1e),
			bitsPerPixel: data.readUInt16LE(at + 0x22),
			offsetX: data.readInt16LE(at + 0x18),
			offsetY: data.readInt16LE(at + 0x1a),
			dataOffset,
			dataSize,
			rgbMode: data.readUInt16LE(at + 0x10),
			jpegKey: 0,
		};
	}
	if (JPG_KIND === kind) {
		return {
			kind: "jpeg",
			width: data.readUInt16LE(at + 0x18),
			height: data.readUInt16LE(at + 0x1a),
			bitsPerPixel: 24,
			offsetX: data.readInt16LE(at + 0x14),
			offsetY: data.readInt16LE(at + 0x16),
			dataOffset,
			dataSize,
			rgbMode: 0,
			jpegKey: data.readUInt32LE(at + 0x20),
		};
	}
	return undefined;
}

/** `LsbBitStream`: the walks of the bits of a row, of the lowest place of every place of the file first. */
class LsbBits {
	private position: number;

	constructor(
		private readonly data: Buffer,
		offset: number,
	) {
		this.position = offset * 8;
	}

	/** `LsbBitStream.GetBits`: `count` places, the first of them standing at the lowest place. */
	read(count: number): number {
		let value = 0;
		for (let bit = 0; bit < count; bit += 1) {
			const at = this.position >> 3;
			if (at >= this.data.length) {
				throw invalidPicture(
					"The walks of the picture stand short of the file",
				);
			}
			value |= (((this.data[at] ?? 0) >> (this.position & 7)) & 1) << bit;
			this.position += 1;
		}
		return value;
	}

	/** `LsbBitStream.Reset`: the walks of a row stand of the place of the row itself. */
	seek(offset: number): void {
		this.position = offset * 8;
	}
}

/** The places of a picture of the engine, of the walks of it. */
function unpackRgbPlaces(
	data: Buffer,
	layout: SgLayout,
): { pixels: Buffer; kind: "indexed" | "bgr" | "bgra" } {
	const { width, height, dataSize } = layout;
	const channels = layout.bitsPerPixel / 8;
	if (3 !== channels && 4 !== channels) {
		throw invalidPicture(
			"The picture stands of a depth of places this project does not read",
		);
	}
	if (layout.dataOffset + dataSize > data.length) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	switch (layout.rgbMode) {
		case 0: {
			// The places stand as they stand, of three or four places to a place.
			const stride = width * channels;
			if (layout.dataOffset + stride * height > data.length) {
				throw invalidPicture(
					"The places of the picture stand short of the file",
				);
			}
			return {
				pixels: Buffer.from(
					data.subarray(layout.dataOffset, layout.dataOffset + stride * height),
				),
				kind: 3 === channels ? "bgr" : "bgra",
			};
		}
		case 1:
			return {
				pixels: unpackV1(data, layout, channels),
				kind: 3 === channels ? "bgr" : "bgra",
			};
		case 2:
			return 4 === channels
				? { pixels: unpackV2Alpha(data, layout), kind: "bgra" }
				: { pixels: unpackV2(data, layout), kind: "indexed" };
		case 3:
			return {
				pixels: unpackV3(data, layout, channels),
				kind: 3 === channels ? "bgr" : "bgra",
			};
		default:
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"A picture of a kind of places this project reads none of",
			);
	}
}

/** `SgRgbReader.UnpackV1`: the places of the picture, of a run of the places of every colour of it. */
function unpackV1(data: Buffer, layout: SgLayout, channels: number): Buffer {
	const { width, height } = layout;
	const output: Buffer = Buffer.alloc(width * channels * height, 0x00);
	const line: Buffer = Buffer.alloc(width * channels, 0x00);
	let at = layout.dataOffset;
	const next = (): number => {
		const value = data[at] ?? -1;
		at += 1;
		return value;
	};
	let destination = 0;
	for (let row = 0; row < height; row += 1) {
		let place = 0;
		for (let channel = 0; channel < channels; channel += 1) {
			for (let left = width; left > 0; ) {
				const control = next();
				if (control < 0) {
					throw invalidPicture(
						"The places of the picture stand short of the file",
					);
				}
				let count = control & 0x3f;
				if (0 !== (control & 0x40)) {
					count = (count << 8) | Math.max(0, next());
				}
				if (0 !== (control & 0x80)) {
					const value = next();
					for (let step = 0; step < count; step += 1) {
						line[place + step] = value;
					}
				} else {
					if (at + count > data.length) {
						throw invalidPicture(
							"The places of the picture stand short of the file",
						);
					}
					data.copy(line, place, at, at + count);
					at += count;
				}
				place += count;
				left -= count;
			}
		}
		place = 0;
		for (let column = 0; column < width; column += 1) {
			output[destination] = line[place] ?? 0;
			output[destination + 1] = line[place + width] ?? 0;
			output[destination + 2] = line[place + width * 2] ?? 0;
			if (4 === channels) {
				output[destination + 3] = line[place + width * 3] ?? 0;
			}
			destination += channels;
			place += 1;
		}
	}
	return output;
}

/** The colour map of a picture of places standing of the colours of it. */
function readColorMap(
	data: Buffer,
	at: number,
): { palette: Buffer; at: number } {
	if (at + MAX_COLORS * 4 > data.length) {
		throw invalidPicture("The colours of the picture stand short of the file");
	}
	return {
		palette: Buffer.from(data.subarray(at, at + MAX_COLORS * 4)),
		at: at + MAX_COLORS * 4,
	};
}

/** The places of the rows of a picture, of the walks of every row of it. */
function readRowTable(data: Buffer, at: number, height: number): number[] {
	const rows: number[] = [];
	for (let row = 0; row < height; row += 1) {
		if (at + row * 4 + 4 > data.length) {
			throw invalidPicture("The rows of the picture stand short of the file");
		}
		rows.push(data.readInt32LE(at + row * 4));
	}
	return rows;
}

/** `SgRgbReader.UnpackV2`: the places of the picture, of the colours behind them. */
function unpackV2(data: Buffer, layout: SgLayout): Buffer {
	const { width, height } = layout;
	const map = readColorMap(data, layout.dataOffset);
	const rows = readRowTable(data, map.at, height);
	const table = map.at + height * 4;
	const output: Buffer = Buffer.alloc(width * height, 0x00);
	const palette: Buffer = Buffer.alloc(MAX_COLORS * 4, 0x00);
	map.palette.copy(palette);
	let destination = 0;
	let at = 0;
	for (let row = 0; row < height; row += 1) {
		at = table + (rows[row] ?? 0);
		for (let left = width; left > 0; ) {
			if (at + 1 > data.length)
				throw invalidPicture(
					"The places of the picture stand short of the file",
				);
			const control = data[at] ?? 0;
			at += 1;
			let count = control >> 2;
			if (0 !== (control & 2)) count |= Math.max(0, data[at] ?? 0) << 6;
			if (0 !== (control & 2)) at += 1;
			count = Math.min(count, left);
			left -= count;
			if (0 !== (control & 1)) {
				const value = data[at] ?? 0;
				at += 1;
				for (let step = 0; step < count; step += 1)
					output[destination + step] = value;
			} else {
				if (at + count > data.length)
					throw invalidPicture(
						"The places of the picture stand short of the file",
					);
				data.copy(output, destination, at, at + count);
				at += count;
			}
			destination += count;
		}
	}
	return writeBmp8Palette(width, height, output, palette);
}

/** `SgRgbReader.UnpackV2Alpha`: the places of the picture, of the colours and the alpha behind them. */
function unpackV2Alpha(data: Buffer, layout: SgLayout): Buffer {
	const { width, height } = layout;
	const map = readColorMap(data, layout.dataOffset);
	const rows = readRowTable(data, map.at, height);
	const table = map.at + height * 4;
	const output: Buffer = Buffer.alloc(width * 4 * height, 0x00);
	const bits = new LsbBits(data, table);
	let destination = 0;
	const extend = (value: number): number =>
		0 === value ? 0 : (value << 4) | 0xf;
	for (let row = 0; row < height; row += 1) {
		bits.seek(table + (rows[row] ?? 0));
		for (let left = width; left > 0; ) {
			const control = bits.read(2);
			let count = 0 !== (control & 2) ? bits.read(10) : bits.read(2);
			count = Math.min(count, left);
			left -= count;
			if (0 !== (control & 1)) {
				const alpha = extend(bits.read(4));
				const color = bits.read(8);
				const place = color * 4;
				for (let step = 0; step < count; step += 1) {
					output[destination] = map.palette[place] ?? 0;
					output[destination + 1] = map.palette[place + 1] ?? 0;
					output[destination + 2] = map.palette[place + 2] ?? 0;
					output[destination + 3] = alpha;
					destination += 4;
				}
			} else {
				for (let step = 0; step < count; step += 1) {
					const alpha = extend(bits.read(4));
					const color = bits.read(8);
					const place = color * 4;
					output[destination] = map.palette[place] ?? 0;
					output[destination + 1] = map.palette[place + 1] ?? 0;
					output[destination + 2] = map.palette[place + 2] ?? 0;
					output[destination + 3] = alpha;
					destination += 4;
				}
			}
		}
	}
	return output;
}

/** `SgRgbReader.UnpackV3`: the places of the picture, of the walks of every row of it. */
function unpackV3(data: Buffer, layout: SgLayout, channels: number): Buffer {
	const { width, height } = layout;
	const rows = readRowTable(data, layout.dataOffset, height);
	const table = layout.dataOffset + height * 4;
	const output: Buffer = Buffer.alloc(width * channels * height, 0x00);
	let destination = 0;
	let at = 0;
	for (let row = 0; row < height; row += 1) {
		at = table + (rows[row] ?? 0);
		for (let left = width; left > 0; ) {
			if (at + 1 > data.length)
				throw invalidPicture(
					"The places of the picture stand short of the file",
				);
			const control = data[at] ?? 0;
			at += 1;
			let count = control & 0x3f;
			if (0 !== (control & 0x40)) {
				count = (count << 8) | Math.max(0, data[at] ?? 0);
				at += 1;
			}
			left -= count;
			count *= channels;
			if (0 !== (control & 0x80)) {
				if (at + channels > data.length)
					throw invalidPicture(
						"The places of the picture stand short of the file",
					);
				for (let step = 0; step < channels; step += 1) {
					output[destination + step] = data[at + step] ?? 0;
				}
				at += channels;
				for (let step = channels; step < count; step += 1) {
					output[destination + step] =
						output[destination + step - channels] ?? 0;
				}
			} else {
				if (at + count > data.length)
					throw invalidPicture(
						"The places of the picture stand short of the file",
					);
				data.copy(output, destination, at, at + count);
				at += count;
			}
			destination += count;
		}
	}
	return output;
}

/**
 * `SgFormat.Read`: the picture of the file. A picture of a kind of its own stands behind a key and is read
 * as the JPEG interchange format the reference hands to the platform's decoder; the other kinds stand of
 * the walks of the engine of this project.
 */
export function unpackSgPicture(data: Buffer, layout: SgLayout): Buffer {
	if (0 === layout.width || 0 === layout.height) {
		throw invalidPicture("The picture stands of no places of its own");
	}
	if ("jpeg" === layout.kind) {
		if (layout.dataOffset + layout.dataSize > data.length) {
			throw invalidPicture("The places of the picture stand short of the file");
		}
		// `SgFormat.ReadJpeg` decrypts the picture and hands it to the platform's JPEG decoder. This port
		// reads it with its own reader of that format, and where the bytes are in no such format the
		// reference's decoder would fail as well; a stream of another picture format, which the platform
		// decoder would read there, is refused here instead.
		const picture = decryptIvory(
			Buffer.from(
				data.subarray(layout.dataOffset, layout.dataOffset + layout.dataSize),
			),
			layout.jpegKey,
		);
		if (!readJpegHeaderFields(picture)) {
			throw invalidPicture(
				"The places of the picture stand of no walks of the places of a picture",
			);
		}
		const image = readJpegImage(picture);
		return writeBmp32(image.width, image.height, image.pixels);
	}
	const places = unpackRgbPlaces(data, layout);
	if ("indexed" === places.kind) return places.pixels;
	if ("bgr" === places.kind) {
		return writeBmp24(layout.width, layout.height, places.pixels);
	}
	return writeBmp32(layout.width, layout.height, places.pixels);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ivorySgImageDescriptor: FormatDescriptor = {
	id: "ivory-sg-image",
	name: "Ivory image",
	extensions: ["sg"],
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
			source: "ArcFormats/Ivory/ImageSG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ivorySgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ivorySgImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE + BLOCK_SIZE)) return false;
		try {
			return readSgLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readSgLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Ivory engine");
		const jpeg = "jpeg" === layout.kind;
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				encrypted: jpeg,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					rgbMode: layout.rgbMode,
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
		const layout = readSgLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Ivory engine");
		return Readable.from([unpackSgPicture(data, layout)]);
	},
});
