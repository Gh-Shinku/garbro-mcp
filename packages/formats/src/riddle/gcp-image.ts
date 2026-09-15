// Format reference: GARbro "ArcFormats/RiddleSoft/ImageGCP.cs", classes `GcpFormat`, `GcpMetaData` and
// `CmpReader` (Riddle Soft compressed bitmap). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, writeBmp24, writeBmpImage } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** `CMP1`, the word the reference registers the format under, and the two lengths behind it. */
const SIGNATURE: Buffer = Buffer.from("CMP1", "latin1");
const HEADER_SIZE = 12;
const DATA_SIZE_FIELD = 4;
const PACKED_SIZE_FIELD = 8;
/** The shortest bitmap the reference accepts, which is the length of its header. */
const MINIMUM_BITMAP_SIZE = 54;
/** How much the reference unpacks to read the measurements, and where it finds them. */
const METADATA_SIZE = 0x22;
const BITMAP_WIDTH_FIELD = 0x12;
const BITMAP_HEIGHT_FIELD = 0x16;
const BITMAP_DEPTH_FIELD = 0x1c;
const MAXIMUM_BITMAP_BYTES = 256 * 1024 * 1024;
/** The ring the decoder copies out of, and the place it starts writing at. */
const FRAME_SIZE = 0x800;
const FRAME_START = 0x7ef;
/** What the ring holds before anything is written into it, which is what a run reads there. */
const FRAME_FILL = 0x20;

/**
 * The reference's `CmpReader`: bits are read from the highest bit of the byte they are held in down, a set bit
 * is a literal byte, and a clear bit names a run by a **place in the ring** rather than by a distance back.
 * The ring starts at place `0x7EF` and holds spaces before it.
 *
 * `limit` is how many bytes of the stored stream may be read, which is the length the header declares.
 */
export function unpackGcp(
	stored: Buffer,
	start: number,
	packedSize: number,
	outputSize: number,
): Buffer {
	const output: Buffer = Buffer.alloc(outputSize, 0x00);
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, FRAME_FILL);
	// The reference stops filling the ring two places short of its end, so its last two bytes stay zero.
	frame.fill(0x00, FRAME_START);
	let held = 0;
	let heldBits = 0;
	let read = 0;
	let destination = 0;
	let framePosition = FRAME_START;
	const bits = (count: number): number => {
		while (heldBits < count) {
			if (read >= packedSize) return -1;
			read += 1;
			if (start + read - 1 >= stored.length) return -1;
			held = ((held << 8) | (stored[start + read - 1] ?? 0)) & 0xffffffff;
			heldBits += 8;
		}
		heldBits -= count;
		return (held >>> heldBits) & ((1 << count) - 1);
	};
	while (destination < output.length) {
		const bit = bits(1);
		if (-1 === bit) break;
		if (1 === bit) {
			const value = bits(8);
			if (-1 === value) break;
			output[destination] = value;
			destination += 1;
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & (FRAME_SIZE - 1);
			continue;
		}
		const offset = bits(11);
		if (-1 === offset) break;
		const length = bits(4);
		if (-1 === length) break;
		const count = length + 2;
		for (let i = 0; i < count; i += 1) {
			const value = frame[(offset + i) & (FRAME_SIZE - 1)] ?? 0;
			output[destination] = value;
			destination += 1;
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & (FRAME_SIZE - 1);
			if (destination === output.length) return output;
		}
	}
	return output;
}

export interface GcpLayout {
	dataSize: number;
	packedSize: number;
	width: number;
	height: number;
	/** The same measurement as the bitmap stores it, which is negative when its rows are the other way up. */
	signedHeight: number;
	bitsPerPixel: number;
}

/**
 * The reference's `GcpFormat.ReadMetaData`: the two lengths, then the measurements read out of the first
 * thirty four bytes of the picture.
 */
export async function readGcpLayout(
	source: ByteSource,
): Promise<GcpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const dataSize = header.readInt32LE(DATA_SIZE_FIELD);
	const packedSize = header.readInt32LE(PACKED_SIZE_FIELD);
	if (dataSize < MINIMUM_BITMAP_SIZE) return undefined;
	const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
	const prefix = unpackGcp(
		stored,
		HEADER_SIZE,
		packedSize,
		Math.min(METADATA_SIZE, dataSize),
	);
	if (prefix.subarray(0, 2).toString("latin1") !== "BM") return undefined;
	const width = prefix.readInt32LE(BITMAP_WIDTH_FIELD);
	// A height that is negative is a bitmap whose rows are stored the other way up; the reference reads the
	// word as it stands and lets the framework turn the picture over.
	const signedHeight = prefix.readInt32LE(BITMAP_HEIGHT_FIELD);
	const bitsPerPixel = prefix.readInt16LE(BITMAP_DEPTH_FIELD);
	if (width <= 0 || signedHeight === 0 || bitsPerPixel <= 0) return undefined;
	return {
		dataSize,
		packedSize,
		width,
		height: Math.abs(signedHeight),
		signedHeight,
		bitsPerPixel,
	};
}

export const riddleGcpImageDescriptor: FormatDescriptor = {
	id: "riddle-gcp-image",
	name: "Riddle Soft compressed bitmap",
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
			source: "ArcFormats/RiddleSoft/ImageGCP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const riddleGcpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: riddleGcpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readGcpLayout(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readGcpLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Riddle Soft picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(HEADER_SIZE),
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
							dataSize: layout.dataSize,
							packedSize: layout.packedSize,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "riddle-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const layout = await readGcpLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Riddle Soft picture");
		}
		if (layout.dataSize > MAXIMUM_BITMAP_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Riddle Soft picture of ${layout.dataSize} bytes is too large`,
			);
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const data = unpackGcp(
			stored,
			HEADER_SIZE,
			layout.packedSize,
			layout.dataSize,
		);
		// A bitmap of twenty four bits whose width is not a multiple of four may be stored without the
		// padding every other bitmap carries, and its rows the other way up.
		if (
			24 === layout.bitsPerPixel &&
			0 !== (layout.width & 3) &&
			layout.signedHeight * layout.width * 3 + MINIMUM_BITMAP_SIZE ===
				layout.dataSize
		) {
			const stride = layout.width * 3;
			const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
			for (let row = 0; row < layout.height; row += 1) {
				data.copy(
					pixels,
					(layout.height - 1 - row) * stride,
					MINIMUM_BITMAP_SIZE + row * stride,
					MINIMUM_BITMAP_SIZE + (row + 1) * stride,
				);
			}
			return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
		}
		const image = readBmpImage(data);
		if (!image) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Riddle Soft picture holds no bitmap",
			);
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
