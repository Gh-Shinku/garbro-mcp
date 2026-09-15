// Format reference: GARbro "ArcFormats/Ikura/ImageYGP.cs", classes `YgpFormat` and `YgpMetaData`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The four bytes of the signature, which the reference packs into a word with a nothing in its last byte. */
const SIGNATURE = Buffer.from("YGP\0", "latin1");
/** How far into the header the measurements of the picture behind it stand. */
const HEADER_FIELDS = 8;
/** Where the place the picture stands at is kept, which the reference reads only when a flag asks for it. */
const PLACE_OFFSET = 0x14;
const FLAG_COMPRESSED = 0x01;
const FLAG_PLACE = 0x04;
const BYTES_PER_PIXEL = 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface YgpLayout {
	width: number;
	height: number;
	/** The kind of picture, which the reference only insists stands at one or two. */
	type: number;
	flags: number;
	headerSize: number;
	dataSize: number;
	dataOffset: number;
	offsetX: number | undefined;
	offsetY: number | undefined;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `YgpFormat.ReadMetaData`: two bytes at offset four that the reference reads and never looks at again, then
 * the kind of the picture — which has to stand at one or two — the flags, and the length of the header, which
 * is also where the size of the pixels, the measurements and the place of the picture behind it stand. The
 * place is read only when the flag for it is set; the depth is always four bytes to the pixel. A file whose
 * header or whose measurements do not stand wholly inside it is turned away rather than throwing the way the
 * reference's own reader would, as is a picture of no width or height.
 */
export function readYgpLayout(data: Buffer): YgpLayout | undefined {
	if (data.length < 0x0c) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const type = data[6] ?? 0;
	if (1 !== type && 2 !== type) return undefined;
	const flags = data[7] ?? 0;
	const headerSize = data.readInt32LE(8);
	if (headerSize < 0) return undefined;
	const dataOffset = headerSize + HEADER_FIELDS;
	if (dataOffset > data.length) return undefined;
	const dataSize = data.readInt32LE(headerSize);
	const width = data.readUInt16LE(headerSize + 4);
	const height = data.readUInt16LE(headerSize + 6);
	if (0 === width || 0 === height) return undefined;
	let offsetX: number | undefined;
	let offsetY: number | undefined;
	if (0 !== (flags & FLAG_PLACE)) {
		if (data.length < PLACE_OFFSET + 4) return undefined;
		offsetX = data.readInt16LE(PLACE_OFFSET);
		offsetY = data.readInt16LE(PLACE_OFFSET + 2);
	}
	return {
		width,
		height,
		type,
		flags,
		headerSize,
		dataSize,
		dataOffset,
		offsetX,
		offsetY,
	};
}

/**
 * `YgpFormat.Unpack`: the walk steps through a number of bytes the reference counts in its own stream rather
 * than in the picture, so a stream whose steps fill the picture before its count runs out is refused at the
 * step that would write past the end, and so is a step that copies from before the start of the picture. A
 * step of pixels that stand in the stream itself reads as many as the picture still holds room for, leaving
 * the rest as they stand, which is what the reference's own read does as well. A control byte of `0xC0` and
 * above — including the nothing a stream at its end reads as — steps over the rest of the stream without
 * moving the picture on at all.
 */
export function unpackYgp(data: Buffer, layout: YgpLayout): Buffer {
	const pixels: Buffer = Buffer.alloc(
		layout.width * layout.height * BYTES_PER_PIXEL,
		0x00,
	);
	let at = layout.dataOffset;
	let remaining = layout.dataSize;
	let dst = 0;
	// The reference reads a byte at the end of the stream as nothing at all, without moving the stream on.
	const readByte = (): number => (at < data.length ? (data[at++] ?? 0) : -1);
	const copyRun = (count: number, offset: number): void => {
		if (dst + count > pixels.length) {
			throw invalidPicture("Ikura picture writes past its own end");
		}
		if (dst - offset < 0) {
			throw invalidPicture("Ikura picture copies from before its start");
		}
		if (!copyOverlapped(pixels, dst - offset, dst, count)) {
			throw invalidPicture("Ikura picture writes past its own end");
		}
	};
	while (remaining > 0) {
		const control = readByte();
		remaining -= 1;
		if (0 === (control & 0xc0)) {
			const count = ((control & 0x3f) + 1) * BYTES_PER_PIXEL;
			if (dst + count > pixels.length) {
				throw invalidPicture("Ikura picture writes past its own end");
			}
			const room = Math.max(0, Math.min(count, data.length - at));
			data.copy(pixels, dst, at, at + room);
			at += room;
			remaining -= count;
			dst += count;
		} else if (0x40 === (control & 0xc0)) {
			// A run of the pixel before it, one pixel to a step.
			const count = ((control & 0x3f) + 1) * BYTES_PER_PIXEL;
			copyRun(count, BYTES_PER_PIXEL);
			dst += count;
		} else if (0x80 === (control & 0xe0)) {
			const count = ((control & 0x1f) + 1) * BYTES_PER_PIXEL;
			const offset = readByte();
			remaining -= 1;
			copyRun(count, offset * BYTES_PER_PIXEL);
			dst += count;
		} else if (0xa0 === (control & 0xe0)) {
			const count = ((control & 0x1f) + 1) * BYTES_PER_PIXEL;
			const offset = readByte() | (readByte() << 8);
			remaining -= 2;
			copyRun(count, offset * BYTES_PER_PIXEL);
			dst += count;
		}
		// Anything else steps over the rest of the stream without moving the picture on.
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ikuraYgpImageDescriptor: FormatDescriptor = {
	id: "ikura-ygp-image",
	name: "Ikura GDL image format",
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
			source: "ArcFormats/Ikura/ImageYGP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikuraYgpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikuraYgpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 0x0c) return false;
		return readYgpLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readYgpLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not an Ikura picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(layout.dataOffset),
						size: BigInt(layout.dataSize),
						compressed: 0 !== (layout.flags & FLAG_COMPRESSED),
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: BYTES_PER_PIXEL * 8,
							...(layout.offsetX !== undefined
								? { offsetX: layout.offsetX }
								: {}),
							...(layout.offsetY !== undefined
								? { offsetY: layout.offsetY }
								: {}),
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: 0 !== (layout.flags & FLAG_COMPRESSED) ? "lzss" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BYTES_PER_PIXEL * 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readYgpLayout(stored);
		if (!layout) {
			throw invalidPicture("Not an Ikura picture");
		}
		const size = layout.width * layout.height * BYTES_PER_PIXEL;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Ikura picture of ${size} bytes is too large`,
			);
		}
		if (0 !== (layout.flags & FLAG_COMPRESSED)) {
			return Readable.from([
				writeBmp32(
					layout.width,
					layout.height,
					unpackYgp(stored, layout),
					false,
				),
			]);
		}
		// The pixels stand in the stream as they are, of which the picture holds as many as are there.
		const pixels: Buffer = Buffer.alloc(size, 0x00);
		const room = Math.max(
			0,
			Math.min(pixels.length, stored.length - layout.dataOffset),
		);
		stored.copy(pixels, 0, layout.dataOffset, layout.dataOffset + room);
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
