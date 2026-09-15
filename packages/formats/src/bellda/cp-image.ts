// Format reference: GARbro "ArcFormats/BellDa/ImageCP.cs", classes `CpFormat` and `CpLzssDecompressor`
// (BELL-DA compressed bitmap: a bitmap behind a packed stream whose frame begins one byte in). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, readBmpMetaData, writeBmpImage } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The tag the reference checks, of which `'CP'` and `'BM'` stand apart. */
const MAGIC = Buffer.from("CP", "latin1");
const MAGIC_SIZE = 5;
/** The byte between the two parts of the tag, whose two high bits must be set. */
const MARKER_FIELD = 2;
const MARKER_MASK = 0xc0;
const MARKER = 0xc0;
const BITMAP_FIELD = 3;
/** The packed stream begins one byte behind the tag, so that byte is its first control byte. */
const STREAM_OFFSET = 2;
/** The frame of the stream is the usual four kilobytes, and it begins one byte in. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
const FRAME_START = 1;
/** The control bits of a byte are read from the highest down. */
const FIRST_BIT = 0x80;
/** A run copies from three to eighteen bytes — the low nibble of the second byte plus two. */
const RUN_BIAS = 2;
/** Guards against a hostile stream asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

/**
 * `CpLzssDecompressor.Unpack`: the control bits of every byte are read from the **highest down**, a set bit
 * meaning a literal byte and a clear one a run. The frame is filled with nothing and its place begins **one
 * byte in**, which is where the first literal stands. A run is written from a place the two bytes behind the
 * control say — the second byte holds eight bits of it in its high half and its count, from three to eighteen,
 * in the low half — and that place is stepped **forwards** as the run goes, so a run may read bytes it has just
 * written. Every place is held to the frame by its low twelve bits.
 */
export function cpUnpack(input: Buffer, cap: number): Buffer {
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	const output: Buffer = Buffer.alloc(Math.max(0, cap), 0x00);
	let framePosition = FRAME_START;
	let produced = 0;
	let position = 0;
	let done = false;
	while (!done && produced < output.length) {
		if (position >= input.length) break;
		const control = input[position] ?? 0;
		position += 1;
		for (
			let bit = FIRST_BIT;
			bit !== 0 && produced < output.length;
			bit >>= 1
		) {
			if (0 !== (control & bit)) {
				if (position >= input.length) {
					done = true;
					break;
				}
				const value = input[position] ?? 0;
				position += 1;
				frame[framePosition++ & FRAME_MASK] = value;
				output[produced] = value;
				produced += 1;
				continue;
			}
			if (position + 2 > input.length) {
				done = true;
				break;
			}
			const high = input[position] ?? 0;
			const low = input[position + 1] ?? 0;
			position += 2;
			let offset = ((high << 4) | (low >> 4)) & FRAME_MASK;
			let count = RUN_BIAS + (low & 0x0f);
			while (count > 0 && produced < output.length) {
				const value = frame[offset++ & FRAME_MASK] ?? 0;
				frame[framePosition++ & FRAME_MASK] = value;
				output[produced] = value;
				produced += 1;
				count -= 1;
			}
		}
	}
	// The stream is unfolded as lazily as the reference unfolds it, so the bytes no operation reached are not
	// part of what it holds.
	return output.subarray(0, produced);
}

interface CpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The length the bitmap's own header declares. */
	fileSize: number;
}

/**
 * `CpFormat.ReadMetaData`: the file says `'CP'`, a byte whose two high bits are set and `'BM'`, and behind it
 * the packed stream runs to the end of the file.
 */
async function readBitmap(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(MAGIC_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, MAGIC_SIZE));
		if (head.subarray(0, 2).toString("latin1") !== MAGIC.toString("latin1"))
			return undefined;
		if (((head[MARKER_FIELD] ?? 0) & MARKER_MASK) !== MARKER) return undefined;
		if (
			head.subarray(BITMAP_FIELD, BITMAP_FIELD + 2).toString("latin1") !== "BM"
		) {
			return undefined;
		}
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		return cpUnpack(stored, MAX_OUTPUT);
	} catch {
		return undefined;
	}
}

async function readLayout(source: ByteSource): Promise<CpLayout | undefined> {
	const bitmap = await readBitmap(source);
	if (!bitmap) return undefined;
	const meta = readBmpMetaData(bitmap);
	if (!meta) return undefined;
	return {
		width: meta.width,
		height: meta.height,
		bitsPerPixel: meta.bitsPerPixel,
		fileSize: meta.fileSize,
	};
}

export const bellDaCpImageDescriptor: FormatDescriptor = {
	id: "bell-da-cp-image",
	name: "BELL-DA compressed bitmap",
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
			source: "ArcFormats/BellDa/ImageCP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bellDaCpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bellDaCpImageDescriptor,
	// The reference registers the word of a whole tag beside one of nothing, so the format is a candidate for
	// every file — the tag inside the file is what tells it apart.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a BELL-DA bitmap");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(STREAM_OFFSET),
				size: source.size - BigInt(STREAM_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// The stream is packed, and the bitmap behind it is written out at the depth it was stored in.
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
			},
		};
	},
	async openEntry(source: ByteSource) {
		const bitmap = await readBitmap(source);
		if (!bitmap) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a BELL-DA bitmap");
		}
		// `Bmp.Read`: the reference takes the bitmap apart and hands the picture out, which the port mirrors by
		// reading it and writing it out again at the depth it was stored in.
		const image = readBmpImage(bitmap);
		if (!image) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a BELL-DA bitmap");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
