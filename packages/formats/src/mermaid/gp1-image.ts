// Format reference: GARbro "Legacy/Mermaid/ImageGP1.cs", class `Gp1Format`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "gp1";
const HEADER_SIZE = 8;
const WIDTH_FIELD = 0;
const HEIGHT_FIELD = 4;
/** The reference describes every one of its images as twenty four bits. */
const BITS_PER_PIXEL = 24;
const BYTES_PER_PIXEL = 3;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
/**
 * A count byte above this many bytes asks for that many **minus** this, written as one value repeated; a count
 * of this many or less asks for that many bytes as they stand.
 */
const RUN_LIMIT = 0x32;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

interface Gp1Layout {
	width: number;
	height: number;
}

/**
 * The reference reads its two measurements from eight bytes and asks for nothing else, but it only looks at a
 * file carrying the extension at all — there is no word to find — so the name is what a file is found by.
 */
async function readLayout(source: ByteSource): Promise<Gp1Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		const width = header.readUInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height > MAX_IMAGE_BYTES) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

/**
 * One channel of an image, run length packed on its own. A count byte asks for either that many bytes as they
 * stand or, past the limit, one value written that many **minus** the limit times. A channel that runs out of
 * bytes before it is filled keeps whichever zeros it was left with, and the file position is what the caller
 * carries on from.
 */
function unpackChannel(file: Buffer, position: number, output: Buffer): number {
	let at = position;
	let dst = 0;
	while (dst < output.length) {
		if (at >= file.length) break;
		const count = file[at] ?? 0;
		at += 1;
		if (count <= RUN_LIMIT) {
			// The reference writes this many bytes whether or not the file had them, and a count that would
			// run past the end of the channel is refused by the framework it writes through.
			if (count > 0 && dst + count > output.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Invalid Mermaid image channel",
				);
			}
			const available = Math.min(count, file.length - at);
			if (available > 0) file.copy(output, dst, at, at + available);
			at += available;
			dst += count;
		} else {
			const length = count - RUN_LIMIT;
			// Unlike the bytes of a run, the value it repeats is read without a check, so a file that ends
			// here stops with an error rather than a short channel.
			if (at >= file.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Invalid Mermaid image channel",
				);
			}
			const value = file[at] ?? 0;
			at += 1;
			if (dst + length > output.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Invalid Mermaid image channel",
				);
			}
			output.fill(value, dst, dst + length);
			dst += length;
		}
	}
	return at;
}

export const mermaidGp1ImageDescriptor: FormatDescriptor = {
	id: "mermaid-gp1-image",
	name: "Mermaid image",
	extensions: [EXTENSION],
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
			source: "Legacy/Mermaid/ImageGP1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mermaidGp1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mermaidGp1ImageDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		// A word of nothing is no word at all, so the reference finds these files by their name alone.
		if (!leafName(sourcePath).toLowerCase().endsWith(`.${EXTENSION}`))
			return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mermaid image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
				} as Record<string, unknown>,
			}),
			// The image is built out of the file rather than being a part of it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "run-length",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mermaid image");
		const { width, height } = layout;
		const planeSize = width * height;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The channels are stored one after another in the order blue, green and red, and are put back
		// together a pixel at a time.
		const blue: Buffer = Buffer.alloc(planeSize, 0x00);
		let position = unpackChannel(file, HEADER_SIZE, blue);
		const green: Buffer = Buffer.alloc(planeSize, 0x00);
		position = unpackChannel(file, position, green);
		const red: Buffer = Buffer.alloc(planeSize, 0x00);
		unpackChannel(file, position, red);
		const pixels: Buffer = Buffer.alloc(planeSize * BYTES_PER_PIXEL, 0x00);
		let dst = 0;
		for (let index = 0; index < planeSize; index += 1) {
			pixels[dst] = blue[index] ?? 0;
			pixels[dst + 1] = green[index] ?? 0;
			pixels[dst + 2] = red[index] ?? 0;
			dst += BYTES_PER_PIXEL;
		}
		return Readable.from([writeBmp24(width, height, pixels, false)]);
	},
});
