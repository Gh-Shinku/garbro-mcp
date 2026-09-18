// Format reference: GARbro "ArcFormats/Mebius/ImageMCG.cs", classes `McgFormat`, `McgMetaData` and
// `McgReader` (a Mebius picture of seven kinds, most of them runs of a channel at a time). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'MCG', the three bytes every head of this format begins with. */
const MARK = "MCG";
const HEADER_SIZE = 0x10;
/** The byte behind the mark says which of the seven kinds the picture is. */
const METHOD_FIELD = 3;
const METHODS = [0, 1, 2, 3, 4, 5, 6, 7];
const OFFSET_X_FIELD = 0x08;
const OFFSET_Y_FIELD = 0x0a;
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x0e;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface McgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	method: number;
	offsetX: number;
	offsetY: number;
	/** The row of the picture, which is a whole number of pixels. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `McgFormat.ReadMetaData`: the head begins with `MCG` and the kind of the picture behind it, of which nought
 * through seven are read; the offsets stand at eight and ten and the width and the height at twelve and
 * fourteen, all of them as **big endian** words. The depth is eight bits of grey for the kinds four and five
 * and thirty two bits for the rest.
 */
export function readMcgLayout(
	data: Buffer,
	fileLength = data.length,
): McgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.subarray(0, MARK.length).toString("latin1") !== MARK) {
		return undefined;
	}
	const method = data[METHOD_FIELD] ?? 0;
	if (!METHODS.includes(method)) return undefined;
	const width = data.readUInt16BE(WIDTH_FIELD);
	const height = data.readUInt16BE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const bitsPerPixel = 4 === method || 5 === method ? 8 : 32;
	const stride = width * (bitsPerPixel >> 3);
	if (stride * height > LIMIT) return undefined;
	// The last two kinds describe their picture without carrying a stream at all.
	if (6 !== method && 7 !== method && HEADER_SIZE >= fileLength)
		return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		method,
		offsetX: data.readInt16BE(OFFSET_X_FIELD),
		offsetY: data.readInt16BE(OFFSET_Y_FIELD),
		stride,
	};
}

/** A cursor over the stream that refuses to walk past its end. */
class McgCursor {
	readonly #data: Buffer;
	#position: number;

	constructor(data: Buffer) {
		this.#data = data;
		this.#position = HEADER_SIZE;
	}

	readByte(): number {
		if (this.#position >= this.#data.length) {
			throw invalidPicture("Mebius picture is cut short of its stream");
		}
		const value = this.#data[this.#position] ?? 0;
		this.#position += 1;
		return value;
	}
}

/**
 * `McgReader`: the seven kinds of picture. The first is three planes a byte wide, laid into every fourth byte
 * of the row; the second and the fifth stand as they are, a row of the picture at a time; the third and the
 * fourth are runs of a byte a channel; the sixth and the seventh describe their picture as the zeros the
 * buffer begins with, which is exactly what the reference leaves there.
 */
export function unpackMcg(stored: Buffer, layout: McgLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.stride * layout.height, 0x00);
	const cursor = new McgCursor(stored);
	switch (layout.method) {
		case 0: {
			for (let channel = 0; channel < 3; channel += 1) {
				for (let at = channel; at < output.length; at += 4) {
					output[at] = cursor.readByte();
				}
			}
			break;
		}
		case 1:
		case 4: {
			for (let at = 0; at < output.length; at += 1) {
				output[at] = cursor.readByte();
			}
			break;
		}
		case 2:
		case 3: {
			const channels = 2 === layout.method ? 3 : 4;
			const runCode = cursor.readByte();
			for (let channel = 0; channel < channels; channel += 1) {
				let at = channel;
				while (at < output.length) {
					const code = cursor.readByte();
					if (code === runCode) {
						const count = cursor.readByte();
						const value = cursor.readByte();
						for (let index = 0; index < count; index += 1) {
							if (at >= output.length) {
								throw invalidPicture("Mebius picture writes past its own end");
							}
							output[at] = value;
							at += 4;
						}
					} else {
						output[at] = code;
						at += 4;
					}
				}
			}
			break;
		}
		case 5: {
			const runCode = cursor.readByte();
			let at = 0;
			while (at < output.length) {
				const code = cursor.readByte();
				if (code === runCode) {
					const count = cursor.readByte();
					const value = cursor.readByte();
					for (let index = 0; index < count; index += 1) {
						if (at >= output.length) {
							throw invalidPicture("Mebius picture writes past its own end");
						}
						output[at] = value;
						at += 1;
					}
				} else {
					output[at] = code;
					at += 1;
				}
			}
			break;
		}
		default:
			// The sixth and the seventh kinds carry no stream at all.
			break;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mebiusMcgImageDescriptor: FormatDescriptor = {
	id: "mebius-mcg-image",
	name: "Mebius image format",
	extensions: ["mcg", "msk"],
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
			source: "ArcFormats/Mebius/ImageMCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mebiusMcgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mebiusMcgImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARK, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readMcgLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMcgLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Mebius picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					method: layout.method,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The pixels are unfolded from the runs and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "runs",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readMcgLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Mebius picture");
		}
		const pixels = unpackMcg(stored, layout);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		if (8 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp8(layout.width, layout.height, pixels, true),
			]);
		}
		// The third kind is the only one that carries a fourth byte of its own; the others leave it at zero.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
