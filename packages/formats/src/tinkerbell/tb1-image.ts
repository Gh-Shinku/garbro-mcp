// Format reference: GARbro "ArcFormats/Cyberworks/ImageTB1.cs", class `Tb1Format` (TinkerBell image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `LEAF`, the reference's word 0x4641454C. */
const MARKER: Buffer = Buffer.from("LEAF", "latin1");
/** The three byte variant string at offset four, which the reference also insists on. */
const VARIANT: Buffer = Buffer.from("64K", "latin1");
const VARIANT_OFFSET = 4;
const HEADER_SIZE = 0x14;
const WIDTH_FIELD = 0xc;
const HEIGHT_FIELD = 0xe;
const DEPTH_FIELD = 0x10;
/** The only depth the reference accepts. */
const DEPTH = 24;
const DATA_OFFSET = 0x18;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface Tb1Layout {
	width: number;
	height: number;
}

async function readLayout(source: ByteSource): Promise<Tb1Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		if (
			!header
				.subarray(VARIANT_OFFSET, VARIANT_OFFSET + VARIANT.length)
				.equals(VARIANT)
		) {
			return undefined;
		}
		if (header.readUInt16LE(DEPTH_FIELD) !== DEPTH) return undefined;
		const width = header.readUInt16LE(WIDTH_FIELD);
		const height = header.readUInt16LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height * (DEPTH / 8) > MAX_IMAGE_BYTES) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_INIT_POSITION = 0xfee;

/**
 * GARbro `Tb1Format.LzssUnpack`, the LZSS stream this format stores **inverted**: every byte the decoder takes
 * from the file is complemented before it is used, so the control byte, the literals and the sixteen bit match
 * words are all held one's complement. The rest is the classic shape — a 0x1000 byte window starting at
 * `0xFEE`, a control byte whose bits are read from the **most significant** one down, a set bit standing for a
 * literal and a clear one for a match whose low nibble counts `+ 3` bytes read from the window at the offsets
 * the high twelve bits name.
 *
 * The reference reads past the end of the stream rather than stopping there: its `ReadByte` answers `-1`, the
 * complement of which is zero, so a short body decodes into zeroes for as long as the output is short. The port
 * reproduces that, including the match that follows a missing control byte.
 */
export function unpackInvertedLzss(data: Buffer, outputLength: number): Buffer {
	const output: Buffer = Buffer.alloc(outputLength, 0x00);
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	let framePosition = FRAME_INIT_POSITION;
	let position = 0;
	let bits = 0;
	let mask = 0;
	let destination = 0;
	// Past the end every read answers -1, which is what makes the complement of it zero.
	const readRawByte = (): number => {
		const value = position < data.length ? (data[position] ?? 0) : -1;
		position += 1;
		return value;
	};
	const readRawWord = (): number => {
		const low = readRawByte();
		const high = readRawByte();
		return ((low & 0xff) | ((high & 0xff) << 8)) & 0xffff;
	};
	while (destination < output.length) {
		mask >>= 1;
		if (mask === 0) {
			bits = ~readRawByte() & 0xff;
			mask = 0x80;
		}
		if ((bits & mask) !== 0) {
			const value = ~readRawByte() & 0xff;
			frame[framePosition & FRAME_MASK] = value;
			framePosition += 1;
			output[destination] = value;
			destination += 1;
		} else {
			let offset = ~readRawWord() & 0xffff;
			// The count is clamped to what is left, which is how the reference avoids running past the end.
			const count = Math.min((offset & 0xf) + 3, output.length - destination);
			offset >>= 4;
			for (let index = 0; index < count; index += 1) {
				const value = frame[offset & FRAME_MASK] ?? 0;
				offset += 1;
				frame[framePosition & FRAME_MASK] = value;
				framePosition += 1;
				output[destination] = value;
				destination += 1;
			}
		}
	}
	return output;
}

export const tinkerbellTb1ImageDescriptor: FormatDescriptor = {
	id: "tinkerbell-tb1-image",
	name: "TinkerBell image",
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
			source: "ArcFormats/Cyberworks/ImageTB1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tinkerbellTb1ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tinkerbellTb1ImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TinkerBell image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: DEPTH,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "inverted-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: DEPTH,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TinkerBell image");
		const { width, height } = layout;
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const stride = width * (DEPTH / 8);
		const pixels = unpackInvertedLzss(
			file.subarray(DATA_OFFSET),
			stride * height,
		);
		// `ImageData.CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
		return Readable.from([writeBmp24(width, height, pixels, true)]);
	},
});
