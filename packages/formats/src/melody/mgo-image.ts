// Format reference: GARbro "Legacy/Melody/ImageMGO.cs", classes `MgoFormat`, `MgoMetaData` and
// `LzssDecompressor` (Melody compressed bitmap). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** `MGOB`, the word the reference registers the format under. */
const SIGNATURE: Buffer = Buffer.from("MGOB", "latin1");
const HEADER_SIZE = 12;
/** The word at offset four that has to be five, and the length of the picture at offset eight. */
const FORMAT_VERSION = 5;
const UNPACKED_SIZE_FIELD = 8;
/** How much of the bitmap header the reference reads out of the unpacked stream. */
const BITMAP_HEADER_SIZE = 0x36;
const MAXIMUM_BITMAP_BYTES = 256 * 1024 * 1024;
/** How long a name the unpacked stream may start with. */
const MAXIMUM_NAME = 0x400;

/**
 * The reference's `LsbBitStream`: a stream of bits in which the next bit is the lowest bit of what is held, so
 * a field read from it is assembled from the least significant bit up. A field that runs past the end of the
 * stored data is reported as `-1`, which throws away the bits already gathered for it.
 */
class LsbBitReader {
	readonly #data: Buffer;
	#at = 0;
	#held = 0;
	#heldBits = 0;

	constructor(data: Buffer) {
		this.#data = data;
	}

	/** `LsbBitStream.GetNextBit`. */
	nextBit(): number {
		return this.bits(1);
	}

	/** `LsbBitStream.GetBits`. */
	bits(count: number): number {
		if (this.#heldBits >= count) {
			const mask = (1 << count) - 1;
			const value = this.#held & mask;
			this.#held >>>= count;
			this.#heldBits -= count;
			return value;
		}
		let value = this.#held & ((1 << this.#heldBits) - 1);
		count -= this.#heldBits;
		let shift = this.#heldBits;
		this.#heldBits = 0;
		while (count >= 8) {
			if (this.#at >= this.#data.length) return -1;
			value |= (this.#data[this.#at++] ?? 0) << shift;
			shift += 8;
			count -= 8;
		}
		if (count > 0) {
			if (this.#at >= this.#data.length) return -1;
			const byte = this.#data[this.#at++] ?? 0;
			value |= (byte & ((1 << count) - 1)) << shift;
			this.#held = byte >> count;
			this.#heldBits = 8 - count;
		}
		return value;
	}
}

/**
 * The reference's Melody `LzssDecompressor`, which is not the scheme of the same name elsewhere in the
 * reference: the control bits are read one at a time from a least significant bit first stream, a run is
 * named by a twelve bit **absolute** place in the ring rather than by a distance back from what is written,
 * and the ring starts empty one place in rather than holding spaces.
 *
 * `limit` is how much the caller asked for, which is what the reference's coroutine fills.
 */
export function inflateMelodyLzss(stored: Buffer, limit: number): Buffer {
	const frame: Buffer = Buffer.alloc(0x1000, 0x00);
	const reader = new LsbBitReader(stored);
	const output: Buffer = Buffer.alloc(limit, 0x00);
	let framePosition = 1;
	let written = 0;
	while (written < limit) {
		const control = reader.nextBit();
		if (-1 === control) break;
		if (0 !== control) {
			// A literal, which the reference casts to a byte even when the read ran past the end.
			const value = reader.bits(8) & 0xff;
			output[written] = value;
			written += 1;
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & 0xfff;
			continue;
		}
		let offset = reader.bits(12);
		if (-1 === offset) break;
		let count = reader.bits(4) + 2;
		while (count-- > 0) {
			const value = frame[offset & 0xfff] ?? 0;
			offset += 1;
			if (written < limit) {
				output[written] = value;
				written += 1;
			}
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & 0xfff;
		}
	}
	return written === limit ? output : output.subarray(0, written);
}

/** The length of the picture the header declares. */
function declaredSize(header: Buffer): number {
	return header.readInt32LE(UNPACKED_SIZE_FIELD);
}

/** What the unpacked stream says about the bitmap it carries. */
export interface MgoHeader {
	name: string;
	unpackedSize: number;
	bmpOffset: number;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * The reference's `MgoFormat.ReadMetaData`: a name, a table the reference walks past, and the header of the
 * bitmap behind it, all read out of the unpacked stream.
 */
export function readMgoHeader(
	unpacked: Buffer,
	unpackedSize: number,
): MgoHeader | undefined {
	let at = 0;
	const end = unpacked.indexOf(0, at);
	if (end < 0 || end - at > MAXIMUM_NAME) return undefined;
	const name = unpacked.toString("latin1", at, end);
	// The reference aligns the position behind the name to four bytes, counting its terminator.
	at = (((end - 1) & ~3) + 4) | 0;
	if (at + 4 > unpacked.length) return undefined;
	const count = unpacked.readInt32LE(at);
	at += 4 + count * 0x10;
	if (at < 0 || at + BITMAP_HEADER_SIZE > unpacked.length) return undefined;
	const bitmap = unpacked.subarray(at, at + BITMAP_HEADER_SIZE);
	if (!bitmap.subarray(0, 2).equals(Buffer.from("BM", "latin1"))) {
		return undefined;
	}
	const fields = readBmpHeaderFields(bitmap);
	if (!fields) return undefined;
	return {
		name,
		unpackedSize,
		bmpOffset: at,
		width: fields.width,
		height: fields.height,
		bitsPerPixel: fields.bitsPerPixel,
	};
}

/** The unpacked stream, or nothing when the file is not one this format claims. */
async function readMgo(
	source: ByteSource,
): Promise<{ header: MgoHeader; unpacked: Buffer } | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (header.readInt32LE(4) !== FORMAT_VERSION) return undefined;
	const unpackedSize = declaredSize(header);
	if (unpackedSize <= 0 || unpackedSize > MAXIMUM_BITMAP_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Melody picture of ${unpackedSize} bytes is too large`,
		);
	}
	const stored = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE), Number(source.size) - HEADER_SIZE),
	);
	const unpacked = inflateMelodyLzss(stored, unpackedSize);
	const fields = readMgoHeader(unpacked, unpackedSize);
	if (!fields) return undefined;
	return { header: fields, unpacked };
}

export const melodyMgoImageDescriptor: FormatDescriptor = {
	id: "melody-mgo-image",
	name: "Melody compressed bitmap",
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
			source: "Legacy/Melody/ImageMGO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const melodyMgoImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: melodyMgoImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readMgo(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const read = await readMgo(source);
		if (!read) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Melody picture");
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
							width: read.header.width,
							height: read.header.height,
							bitsPerPixel: read.header.bitsPerPixel,
							unpackedSize: read.header.unpackedSize,
							bmpOffset: read.header.bmpOffset,
							...(read.header.name ? { name: read.header.name } : {}),
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "melody-lzss",
				width: read.header.width,
				height: read.header.height,
				bitsPerPixel: read.header.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		const read = await readMgo(source);
		if (!read) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Melody picture");
		}
		const image = readBmpImage(read.unpacked.subarray(read.header.bmpOffset));
		if (!image) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Melody picture holds no bitmap",
			);
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
