import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const RIFF = "RIFF";
const HEADER_SIZE_FIELD = 0x04;
const HEADER_SIZE = 0x38;
const MARK_FIELD = 0x08;
const FORMAT_WORD_FIELD = 0x0c;
const PICTURE_WORD = "bmp ";
const PACKED_SIZE_FIELD = 0x3c;
const WIDTH_FIELD = 0x40;
const HEIGHT_FIELD = 0x42;
const BITS_FIELD = 0x50;
const COMPRESSED_FIELD = 0x52;
const PLACES_PER_PIXEL = 2;
const PICTURE_OFFSET = 0x58;
/** The one number of places a place of a picture this project reads stands in. */
const BITS_PER_PIXEL = 16;
const END_WORD = 0xff;
const RUN_WORD = 0xfe;
const LITERAL_LIMIT = 0x80;
const DELTA_LIMIT = 0x80;
const RED_PLACES = 10;
const GREEN_PLACES = 5;
const LOWEST_PLACES = 5;
const DELTA_CENTRE = 2;
const TRANSPARENCY_BIT = 0x80;
/** How many places of a row name how much of a place of the picture stands on the places beside it. */
const ROW_PLACES_PER_BYTE = 6;
const ROW_PLACE_BIT = 32;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface IphLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	compressed: boolean;
	packedSize: number;
	pictureOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readIphLayout(
	data: Buffer,
	fileLength = data.length,
): IphLayout | undefined {
	if (fileLength < HEADER_SIZE || data.length < HEADER_SIZE) return undefined;
	if (data.toString("latin1", 0, RIFF.length) !== RIFF) return undefined;
	if (data.readInt32LE(HEADER_SIZE_FIELD) !== HEADER_SIZE) return undefined;
	const mark = data.toString("latin1", MARK_FIELD, MARK_FIELD + 3);
	if (mark !== "IPH") return undefined;
	const word = data.readUInt8(MARK_FIELD + 3);
	if (word !== 0x20 && word !== 0x00) return undefined;
	if (
		data.toString("latin1", FORMAT_WORD_FIELD, FORMAT_WORD_FIELD + 4) !== "fmt "
	) {
		return undefined;
	}
	if (data.toString("latin1", HEADER_SIZE, HEADER_SIZE + 4) !== PICTURE_WORD) {
		return undefined;
	}
	const packedSize = data.readInt32LE(PACKED_SIZE_FIELD);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width * height > LIMIT) return undefined;
	const bitsPerPixel = data.readUInt16LE(BITS_FIELD);
	const compressed = data.readInt16LE(COMPRESSED_FIELD) !== 0;
	if (compressed && PICTURE_OFFSET + packedSize > fileLength) return undefined;
	if (
		!compressed &&
		PICTURE_OFFSET + width * height * PLACES_PER_PIXEL > fileLength
	) {
		return undefined;
	}
	return {
		width,
		height,
		bitsPerPixel,
		compressed,
		packedSize,
		pictureOffset: PICTURE_OFFSET,
	};
}

export function unpackIph(data: Buffer, layout: IphLayout): Buffer {
	const width = layout.width;
	const height = layout.height;
	const output: Buffer = Buffer.alloc(width * height * PLACES_PER_PIXEL, 0x00);
	const stride = width * PLACES_PER_PIXEL;
	let at = layout.pictureOffset;
	if (!layout.compressed) {
		if (at + output.length > data.length) {
			throw invalidPicture("TechnoBrain picture is cut short of its places");
		}
		data.copy(output, 0, at, at + output.length);
		return output;
	}
	const extra = new Uint8Array(stride);
	for (let y = 0; y < height; y += 1) {
		const row = stride * y;
		let control = data[at++] ?? 0;
		if (control !== 0) {
			let dst = row;
			let pixel = 0;
			while (dst < output.length) {
				control = data[at++] ?? END_WORD;
				if (END_WORD === control) break;
				if (RUN_WORD === control) {
					const count = (data[at++] ?? 0) + 1;
					pixel = data.readUInt16LE(at);
					at += 2;
					for (let place = 0; place < count; place += 1) {
						if (dst + 2 > output.length) {
							throw invalidPicture(
								"TechnoBrain picture is cut short of its places",
							);
						}
						output.writeUInt16LE(pixel & 0xffff, dst);
						dst += 2;
					}
				} else if (control < LITERAL_LIMIT) {
					if (dst + 2 > output.length) {
						throw invalidPicture(
							"TechnoBrain picture is cut short of its places",
						);
					}
					const low = data[at++] ?? 0;
					output[dst] = low;
					output[dst + 1] = control;
					pixel = (control << 8) | low;
					dst += 2;
				} else {
					if (dst + 2 > output.length) {
						throw invalidPicture(
							"TechnoBrain picture is cut short of its places",
						);
					}
					const step = control & 0x7f;
					const r = (pixel >> RED_PLACES) & 0x1f;
					const g = (pixel >> GREEN_PLACES) & 0x1f;
					const b = pixel & 0x1f;
					pixel =
						(b + (Math.floor(step / 25) % LOWEST_PLACES) - DELTA_CENTRE) |
						((g + (Math.floor(step / 5) % LOWEST_PLACES) - DELTA_CENTRE) <<
							GREEN_PLACES) |
						((r + (step % LOWEST_PLACES) - DELTA_CENTRE) << RED_PLACES);
					output.writeUInt16LE(pixel & 0xffff, dst);
					dst += 2;
				}
			}
		} else {
			if (at + stride > data.length) {
				throw invalidPicture("TechnoBrain picture is cut short of its places");
			}
			data.copy(output, row, at, at + stride);
			at += stride;
			at += 1;
		}
		control = data[at++] ?? 0;
		if (control !== 0) {
			let dst = 0;
			for (;;) {
				control = data[at++] ?? END_WORD;
				if (END_WORD === control) break;
				if (control >= DELTA_LIMIT) {
					const value = control & 0x7f;
					const count = (data[at++] ?? 0) + 1;
					for (let place = 0; place < count; place += 1) {
						if (dst < extra.length) extra[dst] = value;
						dst += 1;
					}
				} else {
					if (dst < extra.length) extra[dst] = control;
					dst += 1;
				}
			}
			let place = row + 1;
			for (let x = 0; x < width; x += 1) {
				const value = extra[Math.floor(x / ROW_PLACES_PER_BYTE)] ?? 0;
				if (0 !== ((ROW_PLACE_BIT >> (x % ROW_PLACES_PER_BYTE)) & value)) {
					if (place < output.length) {
						output[place] = (output[place] ?? 0) | TRANSPARENCY_BIT;
					}
				}
				place += 2;
			}
		} else {
			// The reference reads one place of the file and stands as it stands.
			at += 1;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const technoBrainIphImageDescriptor: FormatDescriptor = {
	id: "techno-brain-iph-image",
	name: "TechnoBrain Inteligent Picture Format",
	extensions: ["iph"],
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
			source: "ArcFormats/TechnoBrain/ImageIPH.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const technoBrainIphImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: technoBrainIphImageDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const layout = readIphLayout(
				await readStored(source),
				Number(source.size),
			);
			return undefined !== layout && layout.bitsPerPixel === BITS_PER_PIXEL;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readIphLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a TechnoBrain picture");
		if (layout.bitsPerPixel !== BITS_PER_PIXEL) {
			throw invalidPicture(
				"TechnoBrain picture of the places of a picture this project does not read",
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: BigInt(layout.pictureOffset),
					size: source.size - BigInt(layout.pictureOffset),
					compressed: layout.compressed,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				compressed: layout.compressed,
				packedSize: layout.packedSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readIphLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a TechnoBrain picture");
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp16(layout.width, layout.height, unpackIph(stored, layout), false),
		]);
	},
});
