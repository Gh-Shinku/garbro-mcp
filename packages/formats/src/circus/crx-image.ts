// Format reference: GARbro "ArcFormats/Circus/ImageCRX.cs", classes `CrxFormat` and the `Reader` beside it
// (tag `CRX`, the picture of the Circus engine). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("CRXG", "latin1");
const HEAD_SIZE = 0x14;
const POSITION_X_FIELD = 4;
const POSITION_Y_FIELD = 6;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xa;
const COMPRESSION_FIELD = 0xc;
const FLAGS_FIELD = 0xe;
const DEPTH_FIELD = 0x10;
const MODE_FIELD = 0x12;
/** The kinds of packing of the places of a picture: 1 stands of its own walks, 2 and 3 of walks with a head. */
const WALK_COMPRESSION = 1;
const HEADED_COMPRESSION = 3;
/** The places of a picture of a colour map, of four places to a colour where the map names this many. */
const DEEP_COLOURS = 0x102;
const COLOURS = 0x100;
const DEEP_PLACE_SIZE = 4;
const PLACE_SIZE = 3;
const BITS_8 = 8;
const BITS_24 = 24;
const BITS_32 = 32;
const PLACE_BITS = 8;
/** The flag of the head whose set place means a word of the length of the packed places stands behind it. */
const SIZE_FLAG = 0x10;
/** The window of the walks of the engine. */
const WINDOW_SIZE = 0x10000;
const WINDOW_MASK = WINDOW_SIZE - 1;
const FLAG_BITS = 0x100;
const FLAG_TAIL = 0xff00;
/** The place a colour map of the engine stands of, of the places the engine means. */
const MAGENTA_BLUE = 0xff;
const MAGENTA_RED = 0xff;
/** The kind of a picture whose alpha stands as it stands. */
const MODE_ALPHA = 2;
const WALK_HEAD = 0xc0;
const WALK_SHORT = 0x80;
const WALK_LONG = 0x7f;
const LIMIT = 256 * 1024 * 1024;

export interface CrxLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	compression: number;
	flags: number;
	colors: number;
	mode: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `CrxFormat.ReadMetaData`: the head of the picture, of the places of it and of the kind it stands of. */
export function readCrxLayout(data: Buffer): CrxLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const compression = data.readUInt16LE(COMPRESSION_FIELD);
	if (compression < 1 || compression > HEADED_COMPRESSION) return undefined;
	const depth = data.readInt16LE(DEPTH_FIELD);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	// The places of a place of the picture stand of the depth of it: nothing, one, or a colour map.
	const bitsPerPixel = 0 === depth ? BITS_24 : 1 === depth ? BITS_32 : BITS_8;
	return {
		width,
		height,
		offsetX: data.readInt16LE(POSITION_X_FIELD),
		offsetY: data.readInt16LE(POSITION_Y_FIELD),
		bitsPerPixel,
		compression,
		flags: data.readUInt16LE(FLAGS_FIELD),
		colors: depth,
		mode: data.readUInt16LE(MODE_FIELD),
	};
}

/** `Reader.ReadPalette`: the colour map of a picture, of the places the head names, red first. */
export function readCrxPalette(data: Buffer, layout: CrxLayout): Buffer {
	const deep = DEEP_COLOURS === layout.colors;
	const placeSize = deep ? DEEP_PLACE_SIZE : PLACE_SIZE;
	const colors = Math.min(layout.colors, COLOURS);
	const length = colors * placeSize;
	if (HEAD_SIZE + length > data.length) {
		throw invalidPicture("The colour map of the picture stands outside it");
	}
	const palette: Buffer = Buffer.alloc(COLOURS * 4, 0x00);
	for (let colour = 0; colour < colors; colour += 1) {
		const red = data[HEAD_SIZE + colour * placeSize] ?? 0;
		let green = data[HEAD_SIZE + colour * placeSize + 1] ?? 0;
		const blue = data[HEAD_SIZE + colour * placeSize + 2] ?? 0;
		// A colour of the map standing of the places of a colour of its own stands of every place of it,
		// which is the reading of the reference.
		if (MAGENTA_BLUE === blue && 0 === green && MAGENTA_RED === red) {
			green = 0xff;
		}
		palette[colour * 4] = blue;
		palette[colour * 4 + 1] = green;
		palette[colour * 4 + 2] = red;
	}
	return palette;
}

/** `Reader.UnpackV1`: the walks of the engine, of a window of 64K places standing over itself. */
function unpackCrxWalk(data: Buffer, output: Buffer, position: number): void {
	const window: Buffer = Buffer.alloc(WINDOW_SIZE, 0x00);
	const source = { at: position };
	const read = (): number => {
		if (source.at >= data.length) {
			throw invalidPicture("The places of the picture stand short of the file");
		}
		const value = data[source.at] ?? 0;
		source.at += 1;
		return value;
	};
	let flag = 0;
	let windowAt = 0;
	let destination = 0;
	while (destination < output.length) {
		flag >>= 1;
		if (0 === (flag & FLAG_BITS)) flag = read() | FLAG_TAIL;
		if (0 !== (flag & 1)) {
			const value = read();
			window[windowAt] = value;
			windowAt = (windowAt + 1) & WINDOW_MASK;
			output[destination] = value;
			destination += 1;
			continue;
		}
		const control = read();
		let count: number;
		let offset: number;
		if (control >= WALK_HEAD) {
			offset = ((control & 3) << PLACE_BITS) | read();
			count = 4 + ((control >> 2) & 0xf);
		} else if (0 !== (control & WALK_SHORT)) {
			offset = control & 0x1f;
			count = 2 + ((control >> 5) & 3);
			if (0 === offset) offset = read();
		} else if (WALK_LONG === control) {
			count = 2 + (read() | (read() << PLACE_BITS));
			offset = read() | (read() << PLACE_BITS);
		} else {
			offset = read() | (read() << PLACE_BITS);
			count = control + 4;
		}
		// The places a run stands of stand of the window itself, so a run reaching over the places it has
		// written repeats them.
		let at = (windowAt - offset) & 0xffff;
		for (
			let place = 0;
			place < count && destination < output.length;
			place += 1
		) {
			at &= WINDOW_MASK;
			const value = window[at] ?? 0;
			at += 1;
			window[windowAt] = value;
			windowAt = (windowAt + 1) & WINDOW_MASK;
			output[destination] = value;
			destination += 1;
		}
	}
}

/** `Reader.UnpackV2`: the walks of the engine, with a head naming the places of every row of the picture. */
async function unpackCrxHeaded(
	data: Buffer,
	layout: CrxLayout,
	output: Buffer,
	stride: number,
	position: number,
): Promise<void> {
	let raw: Buffer;
	try {
		raw = Buffer.from(await inflateZlibBuffer(data.subarray(position)));
	} catch {
		throw invalidPicture(
			"The places of the picture stand of no walks of their own",
		);
	}
	const source = { at: 0 };
	const read = (): number => {
		if (source.at >= raw.length) {
			throw invalidPicture(
				"The places of the picture stand short of the picture",
			);
		}
		const value = raw[source.at] ?? 0;
		source.at += 1;
		return value;
	};
	const placeSize = Math.trunc(layout.bitsPerPixel / PLACE_BITS);
	const rowBytes = layout.width * placeSize;
	if (layout.bitsPerPixel < BITS_24) {
		for (let row = 0; row < layout.height; row += 1) {
			for (let at = 0; at < rowBytes; at += 1) {
				output[row * stride + at] = read();
			}
		}
		return;
	}
	for (let row = 0; row < layout.height; row += 1) {
		const control = read();
		const at = row * stride;
		const above = at - stride;
		switch (control) {
			case 0: {
				output[at] = read();
				output[at + 1] = read();
				output[at + 2] = read();
				if (BITS_32 === layout.bitsPerPixel) output[at + 3] = read();
				for (let column = placeSize; column < rowBytes; column += 1) {
					output[at + column] =
						(read() + (output[at + column - placeSize] ?? 0)) & 0xff;
				}
				break;
			}
			case 1: {
				for (let column = 0; column < rowBytes; column += 1) {
					output[at + column] = (read() + (output[above + column] ?? 0)) & 0xff;
				}
				break;
			}
			case 2: {
				for (let place = 0; place < placeSize; place += 1) {
					output[at + place] = read();
				}
				for (let column = placeSize; column < rowBytes; column += 1) {
					output[at + column] =
						(read() + (output[above + column - placeSize] ?? 0)) & 0xff;
				}
				break;
			}
			case 3: {
				// The places of the row stand of the places of the row above them and to the right of them,
				// read from the left of the row.
				let destination = at;
				let upper = above + placeSize;
				for (let column = rowBytes - placeSize; column > 0; column -= 1) {
					output[destination] = (read() + (output[upper] ?? 0)) & 0xff;
					destination += 1;
					upper += 1;
				}
				for (let place = 0; place < placeSize; place += 1) {
					output[destination + place] = read();
				}
				break;
			}
			case 4: {
				// Every colour of the row stands of runs of its own: a place, and where the place behind it
				// stands of the same colour, how many places stand of it.
				for (let place = 0; place < placeSize; place += 1) {
					let destination = at + place;
					let left = layout.width;
					let value = read();
					while (left > 0) {
						output[destination] = value;
						destination += placeSize;
						left -= 1;
						if (0 === left) break;
						const next = read();
						if (value === next) {
							const count = read();
							for (let run = 0; run < count && left > 0; run += 1) {
								output[destination] = value;
								destination += placeSize;
								left -= 1;
							}
							if (left > 0) value = read();
						} else {
							value = next;
						}
					}
				}
				break;
			}
			default:
				break;
		}
	}
}

/** The places of a picture, with the places of a colour of it standing in the order of the picture. */
function unpadRows(
	pixels: Buffer,
	stride: number,
	rowBytes: number,
	height: number,
): Buffer {
	if (rowBytes === stride) return pixels;
	const packed: Buffer = Buffer.alloc(rowBytes * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(packed, row * rowBytes, row * stride, row * stride + rowBytes);
	}
	return packed;
}

/** `Reader.Unpack`: the places of the picture, read as the kind of it names them. */
export async function unpackCrxPicture(
	data: Buffer,
	layout: CrxLayout,
): Promise<Buffer> {
	const placeSize = Math.trunc(layout.bitsPerPixel / PLACE_BITS);
	const rowBytes = layout.width * placeSize;
	const stride = (rowBytes + 3) & ~3;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const palette =
		BITS_8 === layout.bitsPerPixel ? readCrxPalette(data, layout) : undefined;
	let position =
		HEAD_SIZE +
		(palette
			? Math.min(layout.colors, COLOURS) *
				(DEEP_COLOURS === layout.colors ? DEEP_PLACE_SIZE : PLACE_SIZE)
			: 0);
	if (layout.compression >= HEADED_COMPRESSION) {
		if (position + 4 > data.length) {
			throw invalidPicture("The places of the picture stand short of the file");
		}
		// A head of the picture names a table of its own standing in front of the walks of it.
		const count = data.readInt32LE(position);
		position += 4 + count * 0x10;
		if (position > data.length) {
			throw invalidPicture("The places of the picture stand short of the file");
		}
	}
	if (0 !== (layout.flags & SIZE_FLAG)) position += 4;
	if (position > data.length) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	if (WALK_COMPRESSION === layout.compression) {
		unpackCrxWalk(data, output, position);
	} else {
		await unpackCrxHeaded(data, layout, output, stride, position);
	}
	if (BITS_32 === layout.bitsPerPixel && 1 !== layout.mode) {
		// The places of a colour of a picture of four places stand in the order of the alpha, then the three
		// colours the other way round; the alpha stands of the places the kind of the picture names.
		const flip = MODE_ALPHA === layout.mode ? 0 : 0xff;
		for (let row = 0; row < layout.height; row += 1) {
			for (let column = 0; column < layout.width; column += 1) {
				const at = row * stride + column * 4;
				const alpha = output[at] ?? 0;
				output[at] = output[at + 1] ?? 0;
				output[at + 1] = output[at + 2] ?? 0;
				output[at + 2] = output[at + 3] ?? 0;
				output[at + 3] = (alpha ^ flip) & 0xff;
			}
		}
	}
	const pixels = unpadRows(output, stride, rowBytes, layout.height);
	if (BITS_8 === layout.bitsPerPixel) {
		return writeBmp8Palette(
			layout.width,
			layout.height,
			pixels,
			palette ?? Buffer.alloc(COLOURS * 4, 0x00),
		);
	}
	if (BITS_32 === layout.bitsPerPixel) {
		return writeBmp32(layout.width, layout.height, pixels);
	}
	return writeBmp24(layout.width, layout.height, pixels);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const crxImageDescriptor: FormatDescriptor = {
	id: "circus-crx-image",
	name: "Circus image",
	extensions: ["crx"],
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
			source: "ArcFormats/Circus/ImageCRX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const crxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crxImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readCrxLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCrxLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Circus engine");
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
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					compression: layout.compression,
					mode: layout.mode,
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
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readCrxLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Circus engine");
		return Readable.from([await unpackCrxPicture(data, layout)]);
	},
});
