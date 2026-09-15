// Format reference: GARbro "Legacy/ProjectMyu/ImageGAM.cs", classes `GamFormat` and `GamDecompressor`
// (Project-μ compressed bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `GamFormat.Signature`, which the reference compares whole, NUL behind the three letters. */
const SIGNATURE = Buffer.from([0x47, 0x41, 0x4d, 0x00]);
/** The stream of the picture begins behind these, the four words the signature sits in being inert. */
const HEADER_SIZE = 8;
/** How many bytes of the picture the reference reads to see the length of its header. */
const HEADER_LENGTH_BYTES = 18;
const HEADER_SIZE_FIELD = 14;
const MINIMUM_DIB_HEADER = 12;
const MAXIMUM_DIB_HEADER = 0x1000;
/** The window a run reaches back into, which is all the memory the format keeps. */
const FRAME_SIZE = 0x100;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface GamLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Where the bitmap keeps its pixels, which the reference reads off the unfolded picture. */
	dataOffset: number;
}

function isGamSignature(data: Buffer): boolean {
	return data.subarray(0, 4).equals(SIGNATURE);
}

/**
 * `GamDecompressor.Unpack`: a stream of two byte control words, each governing sixteen ops, least significant
 * bit first, and behind every word the bytes its ops take. A bit of **nothing** is a byte of the picture, which
 * takes one byte of the stream and goes into the window as well. A bit of **ones** is a run, which takes two
 * bytes — a place and a count — and copies the count of bytes from the place back in the window, one at a
 * time, so a run that overlaps where it writes repeats what it has just written. The window is `0x100` bytes
 * round, and so a place of `0x100` reaches back exactly one window and lands on the slot it is about to write.
 *
 * The stream has no length of its own: the reference unfolds it on demand, for as long as whoever reads it
 * asks and the input lasts, so this unfolds up to the length asked and stops there, or where the input ends.
 */
export function unpackGam(data: Buffer, maximumOutput: number): Buffer {
	const output: Buffer = Buffer.alloc(maximumOutput, 0x00);
	if (data.length <= HEADER_SIZE) return output.subarray(0, 0);
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	let framePosition = 0;
	let written = 0;
	let position = HEADER_SIZE;
	let bits = 1;
	while (written < maximumOutput) {
		if (bits === 1) {
			// Two bytes of control word; the reference keeps a bit above them to know when they are spent.
			if (position + 2 > data.length) break;
			bits = (data[position] ?? 0) | ((data[position + 1] ?? 0) << 8) | 0x10000;
			position += 2;
		}
		if ((bits & 1) === 0) {
			if (position >= data.length) break;
			const byte = data[position++] ?? 0;
			frame[framePosition & 0xff] = byte;
			framePosition += 1;
			output[written++] = byte;
		} else {
			if (position + 2 > data.length) break;
			const offset = data[position++] ?? 0;
			const count = data[position++] ?? 0;
			for (let index = 0; index < count; index += 1) {
				const byte = frame[(framePosition - offset) & 0xff] ?? 0;
				frame[framePosition & 0xff] = byte;
				framePosition += 1;
				output[written++] = byte;
				if (written >= maximumOutput) break;
			}
		}
		bits >>= 1;
	}
	return output.subarray(0, written);
}

/**
 * `GamFormat.ReadMetaData`: the picture is a **bitmap** in full. The reference reads eighteen bytes of the
 * unfolded stream to see how long the header of that bitmap claims to be, and this unfolds as much as the
 * header it names takes, because the reader here wants the whole header rather than its first fields — a
 * stream cut short of that is declined where the reference would claim it and then fail to read it.
 */
export function readGamLayout(data: Buffer): GamLayout | undefined {
	if (data.length <= HEADER_SIZE) return undefined;
	if (!isGamSignature(data)) return undefined;
	const prefix = unpackGam(data, HEADER_LENGTH_BYTES);
	if (prefix.length < HEADER_LENGTH_BYTES) return undefined;
	const dibHeaderSize = prefix.readUInt32LE(HEADER_SIZE_FIELD);
	if (
		dibHeaderSize < MINIMUM_DIB_HEADER ||
		dibHeaderSize > MAXIMUM_DIB_HEADER
	) {
		return undefined;
	}
	const header = unpackGam(data, HEADER_SIZE_FIELD + dibHeaderSize);
	const fields = readBmpHeaderFields(header);
	if (!fields) return undefined;
	return { ...fields, dataOffset: header.readUInt32LE(10) };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const projectMyuGamImageDescriptor: FormatDescriptor = {
	id: "project-myu-gam-image",
	name: "Project-Myu compressed bitmap",
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
			source: "Legacy/ProjectMyu/ImageGAM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const projectMyuGamImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: projectMyuGamImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size <= BigInt(HEADER_SIZE)) return false;
		try {
			return readGamLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGamLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Project-Myu picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
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
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGamLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Project-Myu picture");
		}
		// The reference reads the pixels of the bitmap, and the colour map and masks beside them, straight out
		// of the unfolded stream, so the length it asks for is the one the bitmap needs.
		const rowBytes = Math.ceil((layout.width * layout.bitsPerPixel) / 8);
		const stride = (rowBytes + 3) & ~3;
		const needed = layout.dataOffset + stride * layout.height;
		if (!Number.isSafeInteger(needed) || needed > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Project-Myu picture of ${needed} bytes is too large`,
			);
		}
		const picture = unpackGam(stored, Math.max(needed, HEADER_LENGTH_BYTES));
		const image = readBmpImage(picture);
		if (!image) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Project-Myu picture holds no bitmap",
			);
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
