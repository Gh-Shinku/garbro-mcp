// Format reference: GARbro "ArcFormats/Lilim/ArcABM.cs", class `AbmOpener` (the frame listing; the
// `AbmReader` image decoder is out of scope).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARKER = Buffer.from("BM", "ascii");
/** The frame counter and the first frame offset. */
const TYPE_OFFSET = 0x1c;
const WIDTH_OFFSET = 0x12;
const HEIGHT_OFFSET = 0x16;
const COUNT_OFFSET = 0x3a;
const FIRST_OFFSET_OFFSET = 0x42;
/** Offsets of the later frames follow the first one as a chain of words. */
const FRAME_TABLE_OFFSET = 0x46;
const HEADER_SIZE = FRAME_TABLE_OFFSET;
/** The bitmap header that precedes the pixel data of a frame. */
const BITMAP_HEADER_SIZE = 0x12;
/** Only these two modes are accepted; mode two stores a fourth channel. */
const GRAYSCALE_MODE = 1;
const COLOR_MODE = 2;

interface AbmFrame {
	name: string;
	offset: bigint;
	size: bigint;
	index: number;
}

interface AbmLayout {
	frames: AbmFrame[];
	width: number;
	height: number;
	pixelSize: number;
	mode: number;
	/** `0x12 + width*height*pixelSize`, computed with the reference's 32 bit wrap. */
	bitmapSize: number;
}

/** GARbro `AbmOpener.TryOpen`: a multi-frame bitmap whose frames are chained by offset words. */
async function readAbmLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<AbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!head.subarray(0, 2).equals(MARKER)) return undefined;
	const mode = head.readInt8(TYPE_OFFSET);
	if (mode !== GRAYSCALE_MODE && mode !== COLOR_MODE) return undefined;
	const count = head.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const width = head.readUInt32LE(WIDTH_OFFSET);
	const height = head.readUInt32LE(HEIGHT_OFFSET);
	const pixelSize = mode === COLOR_MODE ? 4 : 3;
	// The reference multiplies in 32 bits, so the unpacked size wraps the same way.
	const bitmapSize = Math.imul(Math.imul(width, height), pixelSize) >>> 0;
	// Frames are named after the archive.
	const baseName = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");
	const firstOffset = head.readUInt32LE(FIRST_OFFSET_OFFSET);
	// The later offsets are stored behind the fixed header, one word per remaining frame.
	const chainLength = (count - 1) * 4;
	if (BigInt(FRAME_TABLE_OFFSET) + BigInt(chainLength) > source.size)
		return undefined;
	const chain =
		chainLength > 0
			? Buffer.from(
					await source.readAt(BigInt(FRAME_TABLE_OFFSET), chainLength),
				)
			: Buffer.alloc(0);
	const frames: AbmFrame[] = [];
	let nextOffset = BigInt(firstOffset);
	let tablePosition = 0;
	for (let index = 0; index < count; index += 1) {
		const offset = nextOffset;
		if (index + 1 !== count) {
			nextOffset = BigInt(chain.readUInt32LE(tablePosition));
			tablePosition += 4;
		} else {
			// The Reference ends the last frame at the end of the file.
			nextOffset = source.size;
		}
		if (nextOffset <= offset) return undefined;
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		frames.push({
			name: `${baseName}#${String(index).padStart(4, "0")}`,
			offset,
			size,
			index,
		});
	}
	return { frames, width, height, pixelSize, mode, bitmapSize };
}

export const abmDescriptor: FormatDescriptor = {
	id: "lilim-abm",
	name: "LiLiM/Le.Chocolat multi-frame bitmap",
	extensions: ["abm"],
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
			source: "ArcFormats/Lilim/ArcABM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const abmFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abmDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAbmLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readAbmLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LiLiM ABM layout");
		const unpackedSize = (BITMAP_HEADER_SIZE + layout.bitmapSize) >>> 0;
		const entries: FixedEntry[] = layout.frames.map((frame) =>
			createFixedEntry({
				id: frame.index,
				path: frame.name,
				offset: frame.offset,
				size: frame.size,
				packedSize: frame.size,
				compressed: false,
				metadata: {
					type: "image",
					unpackedSize,
					frameIndex: frame.index,
				} as Record<string, unknown>,
			}),
		);
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				width: layout.width,
				height: layout.height,
				bpp: layout.pixelSize * 8,
				mode: layout.mode,
				baseOffset: Number(layout.frames[0]?.offset ?? 0n),
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		// The frame stays encoded: reading it back is the job of the image decoder.
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
