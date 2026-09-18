// Format reference: GARbro "ArcFormats/Cadath/ImageCGF.cs", classes `CgfFormat`, `CgfMetaData` and
// `CgfDecoder` (a Cadath picture of three or four planes, each behind a stream of its own, one of them
// scrambled with a key of the engine's own). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'CGF' with a nought of its own behind it, which is the word the reference registers. */
const SIGNATURE = Buffer.from([0x43, 0x47, 0x46, 0x1a]);
const HEADER_SIZE = 0x0a;
const METHOD_FIELD = 0x04;
const DEPTH_FIELD = 0x05;
const WIDTH_FIELD = 0x06;
const HEIGHT_FIELD = 0x08;
/** The three walks the head may name. */
const METHODS = [1, 2, 3];
const DEPTHS = [24, 32];
/** The word every scrambled stream begins from. */
const DECRYPT_SEED = 0x3977141b;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface CgfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	method: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `CgfFormat.ReadMetaData`: the file begins with the word `CGF` and a nought of its own, the walk stands at
 * four, the depth at five, and the width and the height at six and eight as words. Only the walks one, two
 * and three and the depths of twenty four and thirty two bits are read.
 */
export function readCgfLayout(
	data: Buffer,
	fileLength = data.length,
): CgfLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const method = data[METHOD_FIELD] ?? 0;
	if (!METHODS.includes(method)) return undefined;
	const bitsPerPixel = data[DEPTH_FIELD] ?? 0;
	if (!DEPTHS.includes(bitsPerPixel)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const plane = width * height;
	if (plane > LIMIT || plane * (bitsPerPixel >> 3) > LIMIT) return undefined;
	if (HEADER_SIZE >= fileLength) return undefined;
	return { width, height, bitsPerPixel, method };
}

/**
 * `CgfDecoder.Decrypt`: the stream is read as words and every one of them is exclusive ored with a key that
 * turns three places to the left before every word and then climbs by the seed again. The reference writes a
 * whole word at a time, which would reach past a stream whose length is not a multiple of four; the port
 * keeps exactly the bytes the stream holds (a documented deviation, and one a sane file never sees).
 */
export function decryptCgf(data: Buffer, length: number): void {
	if (length < 4) return;
	let key = DECRYPT_SEED;
	for (let at = 0; at < length; at += 4) {
		key = ((key << 3) | (key >>> 29)) >>> 0;
		const count = Math.min(4, length - at);
		for (let byte = 0; byte < count; byte += 1) {
			data[at + byte] = (data[at + byte] ?? 0) ^ ((key >>> (8 * byte)) & 0xff);
		}
		key = (key + DECRYPT_SEED) >>> 0;
	}
}

/**
 * `CgfDecoder.UnpackRle`: the size of the plane stands as a word at nought and the runs behind it. A byte
 * stands itself, and where it is the same as the byte before it a count stands behind it and the byte is
 * written once more for every step of that count.
 */
export function unpackCgfRle(input: Buffer, output: Buffer): void {
	const unpackedLength = input.readInt32LE(0);
	if (unpackedLength < 0 || unpackedLength > output.length) {
		throw invalidPicture(
			"Cadath picture declares a plane of an impossible size",
		);
	}
	let source = 4;
	let dst = 0;
	let previous = 0;
	while (dst < unpackedLength) {
		if (source >= input.length) {
			throw invalidPicture("Cadath picture is cut short of its runs");
		}
		const byte = input[source] ?? 0;
		source += 1;
		output[dst] = byte;
		dst += 1;
		if (byte === previous) {
			if (source >= input.length) {
				throw invalidPicture("Cadath picture is cut short of its runs");
			}
			const count = input[source] ?? 0;
			source += 1;
			if (dst + count > output.length) {
				throw invalidPicture("Cadath picture writes past its own plane");
			}
			output.fill(byte, dst, dst + count);
			dst += count;
		}
		previous = byte;
	}
}

/**
 * `CgfDecoder.Unpack`: the planes stand one behind another, every one of them behind a word that says how
 * many bytes it holds, and every one of them unfolded into a plane of its own before the planes are woven
 * together a pixel at a time — the first plane is the first byte of every pixel, the second the one behind
 * it, and so on. Three walks are read: a scrambled zlib stream, a walk of runs, and a zlib stream whose
 * bytes are exclusive ored one after another.
 */
export async function unpackCgf(
	stored: Buffer,
	layout: CgfLayout,
): Promise<Buffer> {
	const pixelSize = layout.bitsPerPixel >> 3;
	const planeSize = layout.width * layout.height;
	const output: Buffer = Buffer.alloc(planeSize * pixelSize, 0x00);
	let position = HEADER_SIZE;
	for (let channel = 0; channel < pixelSize; channel += 1) {
		if (position + 4 > stored.length) {
			throw invalidPicture("Cadath picture is cut short of its planes");
		}
		const length = stored.readInt32LE(position);
		position += 4;
		if (length < 0 || position + length > stored.length) {
			throw invalidPicture("Cadath picture is cut short of its planes");
		}
		const body = Buffer.from(stored.subarray(position, position + length));
		position += length;
		const plane: Buffer = Buffer.alloc(planeSize, 0x00);
		if (1 === layout.method) {
			decryptCgf(body, body.length);
			const inflated = await inflateZlibBuffer(body.subarray(4), planeSize);
			inflated.copy(plane, 0, 0, planeSize);
		} else if (2 === layout.method) {
			unpackCgfRle(body, plane);
		} else {
			const inflated = await inflateZlibBuffer(body.subarray(4), planeSize);
			let running = 0;
			for (let index = 0; index < planeSize; index += 1) {
				running = (running ^ (inflated[index] ?? 0)) & 0xff;
				plane[index] = running;
			}
		}
		let dst = channel;
		for (let index = 0; index < planeSize; index += 1) {
			output[dst] = plane[index] ?? 0;
			dst += pixelSize;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const cadathCgfImageDescriptor: FormatDescriptor = {
	id: "cadath-cgf-image",
	name: "Cadath image format",
	extensions: [],
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
			source: "ArcFormats/Cadath/ImageCGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cadathCgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cadathCgfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readCgfLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCgfLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Cadath picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				encrypted: 1 === layout.method,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					method: layout.method,
				},
			}),
			// The planes are unfolded and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: 2 === layout.method ? "runs" : "zlib",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCgfLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Cadath picture");
		}
		const pixels = await unpackCgf(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (24 === layout.bitsPerPixel) {
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
