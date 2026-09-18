// Format reference: GARbro "Legacy/RSystem/ImageRSG.cs", classes `RsgFormat`, `RsgMetaData` and `RsgReader` (a
// thirty two bit RSystem picture behind a count of chunks, each told apart by the high nibble of a control
// byte). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'RS', the two byte signature the reference registers. */
const SIGNATURE = Buffer.from("RS", "latin1");
const HEADER_SIZE = 12;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const CHUNK_COUNT_FIELD = 8;
/** The four kinds of chunk, told apart by the high nibble, and the depth the reference always reports. */
const CHUNK_PIXELS = 0x00;
const CHUNK_REPEAT = 0x10;
const CHUNK_COPY = 0x40;
const CHUNK_DELTA = 0x80;
const DEPTH = 32;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface RsgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	chunkCount: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `RsgFormat.ReadMetaData`: the width and the height stand at four and six as words and the count of chunks at
 * eight. The depth is always reported as thirty two bits.
 */
export function readRsgLayout(data: Buffer): RsgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const chunkCount = data.readInt32LE(CHUNK_COUNT_FIELD);
	if (width === 0 || height === 0 || chunkCount < 0) return undefined;
	const size = width * height * 4;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height, bitsPerPixel: DEPTH, chunkCount };
}

/**
 * `RsgReader.Unpack`: the pixels stand from the twelfth byte as a count of chunks. Every chunk begins with a
 * control byte whose low nibble plus one is how many pixels it holds and whose high nibble says what they
 * are:
 *
 * | high nibble | what it does |
 * | --- | --- |
 * | nothing | that many pixels stand in the stream themselves, three bytes each |
 * | one | one pixel stands in the stream and is repeated, that many times over |
 * | four | the word behind the control, times four, is a distance; one pixel that far behind is copied that many times |
 * | eight | the pixel before stands, and that many words behind it are steps of its three channels, five bits of blue, five of green and six of red, each a signed step of its own |
 *
 * A chunk whose high nibble is none of those is passed over without reading anything. The four blue, green
 * and red bytes of a pixel are read and written, so its fourth byte stands as it was left. A chunk, and the
 * walk of a delta, that reach outside the picture are refused, which the reference's own array reads and
 * writes answer with exceptions as well (documented deviations in the message only).
 */
export function unpackRsg(data: Buffer, layout: RsgLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let position = HEADER_SIZE;
	let dst = 0;
	let chunks = 0;
	const copyPixel = (from: number, to: number): void => {
		output[to] = output[from] ?? 0;
		output[to + 1] = output[from + 1] ?? 0;
		output[to + 2] = output[from + 2] ?? 0;
	};
	while (chunks < layout.chunkCount && position < data.length) {
		chunks += 1;
		const control = data[position] ?? 0;
		position += 1;
		const count = (control & 0x0f) + 1;
		switch (control & 0xf0) {
			case CHUNK_PIXELS: {
				for (let index = 0; index < count; index += 1) {
					if (dst + 4 > output.length) {
						throw invalidPicture("RSystem picture writes past its own end");
					}
					const available = Math.min(3, data.length - position);
					for (let byte = 0; byte < available; byte += 1) {
						output[dst + byte] = data[position + byte] ?? 0;
					}
					position += available;
					dst += 4;
				}
				break;
			}
			case CHUNK_REPEAT: {
				if (dst + count * 4 > output.length) {
					throw invalidPicture("RSystem picture writes past its own end");
				}
				const available = Math.min(3, data.length - position);
				for (let byte = 0; byte < available; byte += 1) {
					output[dst + byte] = data[position + byte] ?? 0;
				}
				position += available;
				// `Binary.CopyOverlapped` repeats the pixel it finds, a byte at a time.
				for (let byte = 0; byte < count * 4 - 4; byte += 1) {
					output[dst + 4 + byte] = output[dst + byte] ?? 0;
				}
				dst += count * 4;
				break;
			}
			case CHUNK_COPY: {
				if (position + 2 > data.length) {
					throw invalidPicture("RSystem picture is cut short of its stream");
				}
				const offset = data.readUInt16LE(position) * 4;
				position += 2;
				const source = dst - offset;
				if (source < 0) {
					throw invalidPicture(
						"RSystem picture copies from before its own start",
					);
				}
				for (let index = 0; index < count; index += 1) {
					if (dst + 4 > output.length) {
						throw invalidPicture("RSystem picture writes past its own end");
					}
					// The place copied from stands still, so every pixel of the chunk is the same one.
					copyPixel(source, dst);
					dst += 4;
				}
				break;
			}
			case CHUNK_DELTA: {
				if (dst < 4) {
					throw invalidPicture(
						"RSystem picture steps from before its own start",
					);
				}
				let blue = output[dst - 4] ?? 0;
				let green = output[dst - 3] ?? 0;
				let red = output[dst - 2] ?? 0;
				for (let index = 0; index < count; index += 1) {
					if (position + 2 > data.length) {
						throw invalidPicture("RSystem picture is cut short of its stream");
					}
					const diff = data.readUInt16LE(position);
					position += 2;
					let db = (diff >> 11) & 0x1f;
					if (0 !== (diff & 0x8000)) db -= 0x20;
					let dg = (diff >> 6) & 0x1f;
					if (0 !== (diff & 0x0400)) dg -= 0x20;
					let dr = diff & 0x3f;
					if (0 !== (diff & 0x20)) dr -= 0x40;
					blue = (blue + db) & 0xff;
					green = (green + dg) & 0xff;
					red = (red + dr) & 0xff;
					if (dst + 4 > output.length) {
						throw invalidPicture("RSystem picture writes past its own end");
					}
					output[dst] = blue;
					output[dst + 1] = green;
					output[dst + 2] = red;
					dst += 4;
				}
				break;
			}
			default:
				break;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<RsgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readRsgLayout(header);
	} catch {
		return undefined;
	}
}

export const rsystemRsgImageDescriptor: FormatDescriptor = {
	id: "rsystem-rsg-image",
	name: "RSystem engine image format",
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
			source: "Legacy/RSystem/ImageRSG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rsystemRsgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rsystemRsgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not an RSystem picture");
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
					chunkCount: layout.chunkCount,
				},
			}),
			// The pixels are unfolded from a walk of chunks and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not an RSystem picture");
		}
		const stored = await readStored(source);
		const pixels = unpackRsg(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
