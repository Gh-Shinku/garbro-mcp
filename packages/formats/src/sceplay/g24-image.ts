// Format reference: GARbro "Legacy/Sceplay/ImageG24.cs", classes `G24AFormat`, `G2408Format`, `G24MetaData`
// and `G24Reader` (a Sceplayer picture behind a run walk or the engine's own LZSS, with the colour or the
// grey of every pixel standing as a step from the one before it). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'g24a' and 'g240', the words the two formats register. */
const G24A_SIGNATURE = Buffer.from("g24a", "latin1");
const G2408_SIGNATURE = Buffer.from("g240", "latin1");
const G24A_HEADER_SIZE = 0x10;
const G24A_STREAM_OFFSET = 0x2c;
const G24A_WIDTH_FIELD = 0x08;
const G24A_HEIGHT_FIELD = 0x0c;
const G2408_HEADER_SIZE = 0x14;
const G2408_STREAM_OFFSET = 0x30;
const G2408_KIND_FIELD = 0x05;
const G2408_WIDTH_FIELD = 0x0c;
const G2408_HEIGHT_FIELD = 0x10;
const G2408_KINDS = ["a", "b"];
/** The two walks the stream declares, as the word behind the head reads. */
const RUN_SIGNATURE = 0x6572; // 're'
const LZSS_SIGNATURE = 0x656c; // 'le'
const HEAD_SIZE = 8;
const RUN_MARK = 0xf0;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface G24Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The row of the picture, which is a whole number of pixels. */
	stride: number;
	/** Where the stream stands, which is the word and the size behind the head. */
	streamOffset: number;
	/** Which of the two kinds of the eight bit picture it is, `a` or `b`. */
	kind?: string;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The head of the twenty four bit picture: the mark `g24a`, the width at eight and the height at twelve. */
export function readG24aLayout(
	data: Buffer,
	fileLength = data.length,
): G24Layout | undefined {
	if (data.length < G24A_HEADER_SIZE) return undefined;
	if (!data.subarray(0, G24A_SIGNATURE.length).equals(G24A_SIGNATURE)) {
		return undefined;
	}
	const width = data.readUInt32LE(G24A_WIDTH_FIELD);
	const height = data.readUInt32LE(G24A_HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const stride = width * 3;
	if (stride * height > LIMIT) return undefined;
	if (G24A_STREAM_OFFSET + HEAD_SIZE > fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel: 24,
		stride,
		streamOffset: G24A_STREAM_OFFSET,
	};
}

/**
 * The head of the eight bit picture: the mark `g240`, the letter `a` or `b` at five, the width at twelve and
 * the height at sixteen. The letter also says whether the grey of every pixel stands as a step from the one
 * behind it.
 */
export function readG2408Layout(
	data: Buffer,
	fileLength = data.length,
): G24Layout | undefined {
	if (data.length < G2408_HEADER_SIZE) return undefined;
	if (!data.subarray(0, G2408_SIGNATURE.length).equals(G2408_SIGNATURE)) {
		return undefined;
	}
	const kind = String.fromCharCode(data[G2408_KIND_FIELD] ?? 0);
	if (!G2408_KINDS.includes(kind)) return undefined;
	const width = data.readUInt32LE(G2408_WIDTH_FIELD);
	const height = data.readUInt32LE(G2408_HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const stride = width;
	if (stride * height > LIMIT) return undefined;
	if (G2408_STREAM_OFFSET + HEAD_SIZE > fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel: 8,
		stride,
		streamOffset: G2408_STREAM_OFFSET,
		kind,
	};
}

/**
 * `G24Reader.UnpackRle`: a byte a step, with `0xF0` standing apart. A byte that is not `0xF0` stands itself;
 * `0xF0` is followed by a count, of which nought, one and two say that the byte itself stands once, once and
 * twice, and anything else that as many copies of the value behind the count follow.
 */
export function unpackG24Rle(
	stored: Buffer,
	offset: number,
	output: Buffer,
): void {
	let position = offset;
	const readByte = (): number | undefined => {
		if (position >= stored.length) return undefined;
		const value = stored[position] ?? 0;
		position += 1;
		return value;
	};
	let dst = 0;
	while (position < stored.length && dst < output.length) {
		const control = readByte();
		if (control === undefined) break;
		if (control !== RUN_MARK) {
			output[dst] = control;
			dst += 1;
			continue;
		}
		const count = readByte();
		if (count === undefined) {
			throw invalidPicture("Sceplayer picture is cut short of its runs");
		}
		if (0 === count) {
			output[dst] = RUN_MARK;
			dst += 1;
		} else if (1 === count) {
			output[dst] = RUN_MARK;
			dst += 1;
		} else if (2 === count) {
			if (dst + 2 > output.length) {
				throw invalidPicture("Sceplayer picture writes past its own end");
			}
			output[dst] = RUN_MARK;
			output[dst + 1] = RUN_MARK;
			dst += 2;
		} else {
			const value = readByte();
			if (value === undefined) {
				throw invalidPicture("Sceplayer picture is cut short of its runs");
			}
			if (dst + count > output.length) {
				throw invalidPicture("Sceplayer picture writes past its own end");
			}
			output.fill(value, dst, dst + count);
			dst += count;
		}
	}
}

/**
 * `G24Reader.Unpack`: the word behind the head says which walk the stream holds — `re` a run walk and `le`
 * the engine's own LZSS — and the word behind it says how many bytes the picture takes.
 */
export function unpackG24(stored: Buffer, layout: G24Layout): Buffer {
	const signature = stored.readInt32LE(layout.streamOffset);
	const unpackedSize = stored.readInt32LE(layout.streamOffset + 4);
	if (unpackedSize !== layout.stride * layout.height) {
		throw invalidPicture(
			"Sceplayer picture does not match its own measurements",
		);
	}
	const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
	if (RUN_SIGNATURE === signature) {
		unpackG24Rle(stored, layout.streamOffset + HEAD_SIZE, output);
		return output;
	}
	if (LZSS_SIGNATURE === signature) {
		return inflateLzss(stored.subarray(layout.streamOffset + HEAD_SIZE), {
			outputLength: unpackedSize,
		});
	}
	throw invalidPicture(
		"Sceplayer picture holds a walk this reader does not know",
	);
}

/**
 * `G24AFormat.Read`: the twenty four bit picture takes the colour of every pixel as a step from the one
 * before it, a byte a channel at a time, and is handed out **bottom up**, which is what
 * `ImageData.CreateFlipped` means.
 */
export function applyG24ColorDelta(pixels: Buffer): void {
	if (pixels.length < 3) return;
	let blue = pixels[0] ?? 0;
	let green = pixels[1] ?? 0;
	let red = pixels[2] ?? 0;
	for (let at = 3; at + 2 < pixels.length; at += 3) {
		blue = ((pixels[at] ?? 0) + blue) & 0xff;
		green = ((pixels[at + 1] ?? 0) + green) & 0xff;
		red = ((pixels[at + 2] ?? 0) + red) & 0xff;
		pixels[at] = blue;
		pixels[at + 1] = green;
		pixels[at + 2] = red;
	}
}

/**
 * `G2408Format.Read`: the eight bit picture of the kind `a` takes the grey of every pixel as a step from the
 * one behind it, walked from the last byte of the picture backwards.
 */
export function applyG2408Delta(pixels: Buffer): void {
	if (pixels.length === 0) return;
	let grey = pixels[pixels.length - 1] ?? 0;
	for (let at = pixels.length - 2; at >= 0; at -= 1) {
		grey = ((pixels[at] ?? 0) + grey) & 0xff;
		pixels[at] = grey;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function pictureEntry(layout: G24Layout, sourcePath: string): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(layout.streamOffset),
			size: BigInt(layout.stride * layout.height),
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				kind: layout.kind ?? "g24a",
			},
		}),
		// The pixels are unfolded from the walk and a bitmap header is written around them.
		sizeKnown: false,
	};
}

export const sceplayG24aImageDescriptor: FormatDescriptor = {
	id: "sceplay-g24a-image",
	name: "Sceplayer image format",
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
			source: "Legacy/Sceplay/ImageG24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sceplayG24aImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sceplayG24aImageDescriptor,
	detection: { signatures: [{ bytes: G24A_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(G24A_HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, G24A_HEADER_SIZE));
			return readG24aLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readG24aLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a Sceplayer picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath)],
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
		const layout = readG24aLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Sceplayer picture");
		}
		const pixels = unpackG24(stored, layout);
		applyG24ColorDelta(pixels);
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});

export const sceplayG2408ImageDescriptor: FormatDescriptor = {
	id: "sceplay-g2408-image",
	name: "Sceplayer bitmap format",
	extensions: ["g2408a", "g2408b"],
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
			source: "Legacy/Sceplay/ImageG24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sceplayG2408ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sceplayG2408ImageDescriptor,
	detection: { signatures: [{ bytes: G2408_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(G2408_HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, G2408_HEADER_SIZE));
			return readG2408Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readG2408Layout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a Sceplayer picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath)],
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
		const layout = readG2408Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Sceplayer picture");
		}
		const pixels = unpackG24(stored, layout);
		if ("a" === layout.kind) applyG2408Delta(pixels);
		return Readable.from([
			writeBmp8(layout.width, layout.height, pixels, true),
		]);
	},
});
