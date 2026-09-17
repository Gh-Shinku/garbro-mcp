// Format reference: GARbro "Legacy/Wing/ImageGEM.cs", classes `GemFormat`, `GemMetaData` and `GemReader` (a
// thirty two bit Wing picture behind an LZSS stream, whose pixels may be a differential walk and whose alpha
// channel may be turned over). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two words the reference registers, which carry the alpha channel in their third byte. */
const SIGNATURES = [
	Buffer.from([0x0a, 0x00, 0x14, 0x00]),
	Buffer.from([0x0a, 0x00, 0x32, 0x00]),
];
const HEADER_SIZE = 0x10;
const ALPHA_FIELD = 2;
const METHOD_FIELD = 4;
const DEPTH_FIELD = 6;
const HEIGHT_FIELD = 8;
const WIDTH_FIELD = 10;
/** The only depth the reference reads, and the two methods of the walk. */
const DEPTH = 32;
const DIFFERENTIAL = 0x64;
const PLAIN = 0xe6;
/** The alpha value that says the channel is there and turned over. */
const ALPHA_CHANNEL = 50;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GemLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	method: number;
	alpha: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GemFormat.ReadMetaData`: the third byte of the signature word is the alpha value, the word at four is the
 * method — of which `0x64` walks the pixels differentially and `0xE6` leaves them as they stand — the word at
 * six is the depth, of which only thirty two bits is read, and the height and the width stand at eight and
 * ten.
 */
export function readGemLayout(data: Buffer): GemLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!SIGNATURES.some((signature) => data.subarray(0, 4).equals(signature))) {
		return undefined;
	}
	const alpha = data.readInt16LE(ALPHA_FIELD);
	const method = data.readInt16LE(METHOD_FIELD);
	if (method !== DIFFERENTIAL && method !== PLAIN) return undefined;
	const bitsPerPixel = data.readInt16LE(DEPTH_FIELD);
	if (bitsPerPixel !== DEPTH) return undefined;
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const size = width * height * 4;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height, bitsPerPixel, method, alpha };
}

/**
 * `GemReader.Unpack`: the pixels are an LZSS stream of thirty two bit rows. The reference's own reader leaves
 * the rest of the picture at nothing when the stream holds less than it asks for. Method `0x64` then walks
 * the rows: every pixel behind the first of a row and the first row is the sum of itself, the pixel to its
 * left, the pixel above it and the pixel above left taken away, which is read from the pixels as they have
 * just been restored. The alpha channel, when the third byte of the signature says it is there, is turned
 * over with `0xFF` on every fourth byte.
 */
export function unpackGem(data: Buffer, layout: GemLayout): Buffer {
	const stride = layout.width * 4;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	const inflated = inflateLzss(data.subarray(HEADER_SIZE), {
		outputLength: output.length,
	});
	inflated.copy(output, 0, 0, Math.min(inflated.length, output.length));
	if (DIFFERENTIAL === layout.method) {
		for (let y = 1; y < layout.height; y += 1) {
			let dst = y * stride + 4;
			for (let x = 4; x < stride; x += 4, dst += 4) {
				output[dst] =
					((output[dst] ?? 0) +
						(((output[dst - 4] ?? 0) +
							(output[dst - stride] ?? 0) -
							(output[dst - stride - 4] ?? 0)) &
							0xff)) &
					0xff;
				output[dst + 1] =
					((output[dst + 1] ?? 0) +
						(((output[dst - 3] ?? 0) +
							(output[dst - stride + 1] ?? 0) -
							(output[dst - stride - 3] ?? 0)) &
							0xff)) &
					0xff;
				output[dst + 2] =
					((output[dst + 2] ?? 0) +
						(((output[dst - 2] ?? 0) +
							(output[dst - stride + 2] ?? 0) -
							(output[dst - stride - 2] ?? 0)) &
							0xff)) &
					0xff;
			}
		}
	}
	if (ALPHA_CHANNEL === layout.alpha) {
		for (let index = 3; index < output.length; index += 4) {
			output[index] = (output[index] ?? 0) ^ 0xff;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<GemLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readGemLayout(header);
	} catch {
		return undefined;
	}
}

export const wingGemImageDescriptor: FormatDescriptor = {
	id: "wing-gem-image",
	name: "Wing image format",
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
			source: "Legacy/Wing/ImageGEM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wingGemImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wingGemImageDescriptor,
	detection: {
		signatures: SIGNATURES.map((bytes) => ({ bytes })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Wing picture");
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
					alpha: layout.alpha,
				},
			}),
			// The pixels are unfolded from an LZSS stream and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				hasAlpha: ALPHA_CHANNEL === layout.alpha,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Wing picture");
		}
		const stored = await readStored(source);
		const pixels = unpackGem(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
