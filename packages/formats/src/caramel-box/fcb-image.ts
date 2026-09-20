import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped, unpackTz } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("fcb1", "latin1");
const HEAD_SIZE = 0x10;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
const METHOD_FIELD = 0xc;
const PACKED_HEAD_SIZE = 0x14;
const PACKED_SIZES_SIZE = 8;
const PACKED_WIDTH_FIELD = 0x14;
const METHOD_TZ = 0;
const METHOD_ZLIB = 1;
const PLACES_PER_PLACE = 4;
const BACKGROUND_PLACE = 0x80;
const BACKGROUND_ALPHA = 0xff;
const DELTA_PLACES = 4;
const WIDE_DELTA = 0x40;
const WIDER_DELTA = 0x20;
const WIDEST_DELTA = 0x10;
const WIDEST_DELTA_BYTE = 0xfe;
const LIMIT = 256 * 1024 * 1024;

export interface FcbLayout {
	width: number;
	height: number;
	method: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readFcbLayout(
	data: Buffer,
	fileLength = data.length,
): FcbLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const method = data.readInt32LE(METHOD_FIELD);
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	return { width, height, method, dataOffset: HEAD_SIZE };
}

export async function readFcbPlaces(
	data: Buffer,
	layout: FcbLayout,
): Promise<Buffer> {
	if (layout.method === METHOD_ZLIB) {
		if (layout.dataOffset + 0x14 > data.length)
			throw invalidPicture(
				"The words of the walk of a picture stand short of it",
			);
		const unpackedSize = data.readInt32BE(PACKED_WIDTH_FIELD);
		if (unpackedSize <= 0)
			throw invalidPicture("The places of the walk of a picture stand nowhere");
		const from = PACKED_HEAD_SIZE + PACKED_SIZES_SIZE;
		const places = await inflateZlibBufferCapped(
			data.subarray(from),
			unpackedSize,
		);
		if (places.length !== unpackedSize)
			throw invalidPicture(
				"The places of the walk of a picture stand short of the places of the picture",
			);
		return places;
	}
	if (layout.method === METHOD_TZ) {
		return unpackTz(data.subarray(layout.dataOffset));
	}
	throw invalidPicture(
		"The kind of the walk of the places of a picture stands unwritten",
	);
}

export function unpackFcbPicture(input: Buffer, layout: FcbLayout): Buffer {
	const { width, height } = layout;
	const output = Buffer.alloc(width * height * PLACES_PER_PLACE);
	const reference = [
		BACKGROUND_PLACE,
		BACKGROUND_PLACE,
		BACKGROUND_PLACE,
		BACKGROUND_ALPHA,
	];
	const pixel = new Array<number>(PLACES_PER_PLACE).fill(0);
	const delta = new Array<number>(DELTA_PLACES).fill(0);
	let src = 0;
	let dst = 0;
	for (let y = 0; y < height; y += 1) {
		for (let at = 0; at < PLACES_PER_PLACE; at += 1)
			pixel[at] = reference[at] ?? 0;
		for (let x = 0; x < width; x += 1) {
			if (src >= input.length)
				throw invalidPicture(
					"The places of the walk of a picture stand short of the places of the picture",
				);
			let code = input[src] ?? 0;
			src += 1;
			if ((code & 0x80) !== 0) {
				if ((code & WIDE_DELTA) !== 0) {
					if ((code & WIDER_DELTA) !== 0) {
						if ((code & WIDEST_DELTA) !== 0) {
							if ((code & 0x08) !== 0) {
								const long = code === WIDEST_DELTA_BYTE ? 3 : 4;
								for (let at = 0; at < long; at += 1) {
									delta[at] = (input[src] ?? 0) - 128;
									src += 1;
								}
								if (long === 3) delta[3] = 0;
							} else {
								code = (code << 8) | (input[src] ?? 0);
								src += 1;
								code = (code << 8) | (input[src] ?? 0);
								src += 1;
								code = (code << 8) | (input[src] ?? 0);
								src += 1;
								delta[0] = ((code >> 20) & 0x7f) - 64;
								delta[1] = ((code >> 14) & 0x3f) - 32;
								delta[2] = ((code >> 8) & 0x3f) - 32;
								delta[3] = (code & 0xff) - 128;
							}
						} else {
							code = (code << 8) | (input[src] ?? 0);
							src += 1;
							code = (code << 8) | (input[src] ?? 0);
							src += 1;
							delta[0] = ((code >> 14) & 0x3f) - 32;
							delta[1] = ((code >> 10) & 0x0f) - 8;
							delta[2] = ((code >> 6) & 0x0f) - 8;
							delta[3] = (code & 0x3f) - 32;
						}
					} else {
						code = (code << 8) | (input[src] ?? 0);
						src += 1;
						code = (code << 8) | (input[src] ?? 0);
						src += 1;
						delta[0] = ((code >> 13) & 0xff) - 128;
						delta[1] = ((code >> 7) & 0x3f) - 32;
						delta[2] = (code & 0x7f) - 64;
						delta[3] = 0;
					}
				} else {
					code = (code << 8) | (input[src] ?? 0);
					src += 1;
					delta[0] = ((code >> 8) & 0x3f) - 32;
					delta[1] = ((code >> 4) & 0x0f) - 8;
					delta[2] = (code & 0x0f) - 8;
					delta[3] = 0;
				}
			} else {
				delta[0] = ((code >> 4) & 7) - 4;
				delta[1] = ((code >> 2) & 3) - 2;
				delta[2] = (code & 3) - 2;
				delta[3] = 0;
			}
			pixel[0] = ((pixel[0] ?? 0) + ((delta[0] ?? 0) + (delta[1] ?? 0))) & 0xff;
			pixel[1] = ((pixel[1] ?? 0) + (delta[0] ?? 0)) & 0xff;
			pixel[2] = ((pixel[2] ?? 0) + ((delta[0] ?? 0) + (delta[2] ?? 0))) & 0xff;
			pixel[3] = ((pixel[3] ?? 0) + (delta[3] ?? 0)) & 0xff;
			for (let at = 0; at < PLACES_PER_PLACE; at += 1) {
				output[dst] = pixel[at] ?? 0;
				dst += 1;
			}
			if (x === 0) {
				for (let at = 0; at < PLACES_PER_PLACE; at += 1)
					reference[at] = pixel[at] ?? 0;
			}
		}
	}
	return output;
}

export const caramelBoxFcbImageDescriptor: FormatDescriptor = {
	id: "caramel-box-fcb-image",
	name: "Caramel BOX image format",
	extensions: ["fcb"],
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
			source: "ArcFormats/CaramelBox/ImageFCB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const caramelBoxFcbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: caramelBoxFcbImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readFcbLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readFcbLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(layout.dataOffset),
					size: source.size - BigInt(layout.dataOffset),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: 32,
						method: layout.method,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				method: layout.method,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readFcbLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		const places = await readFcbPlaces(stored, layout);
		return Readable.from([
			writeBmp32(
				layout.width,
				layout.height,
				unpackFcbPicture(places, layout),
				false,
			),
		]);
	},
});
