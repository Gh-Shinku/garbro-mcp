// Format reference: GARbro "Legacy/Mink/ImageDAT.cs", classes `DatFormat` and `MinkMetaData`
// (Mink compressed bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** A byte and the two lengths behind it; the lengths are turned into bits behind them. */
const HEADER_SIZE = 9;
const MARKER = 3;
/** The two counts of bits the stream carries, which the reference reads as plain bytes. */
const BIT_FIELD_OFFSET = HEADER_SIZE;
const BIT_FIELD_SIZE = 2;
/** How much of the picture the reference unfolds to read its header, always this much. */
const BMP_HEADER_SIZE = 56;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface MinkLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `DatFormat.Unpack`: a bit of ones means a byte of the picture is behind it; a bit of nothing means a run,
 * which carries the place it starts at and how long it is, both of as many bits as the two bytes at the head
 * of the stream say. The place is counted from the **start of the picture** rather than from where the writing
 * has come to, and the run is one longer than the count it carries. A stream that ends leaves the rest of the
 * picture as it was; a run that reaches outside it is refused here, where the reference's own copy would throw.
 */
export function unpackMink(data: Buffer, output: Buffer): void {
	const offsetBits = data[BIT_FIELD_OFFSET] ?? 0;
	const countBits = data[BIT_FIELD_OFFSET + 1] ?? 0;
	const bits = new MsbBitReader(data, BIT_FIELD_OFFSET + BIT_FIELD_SIZE);
	let written = 0;
	while (written < output.length) {
		const control = bits.tryReadBits(1);
		if (control === -1) break;
		if (control !== 0) {
			const value = bits.tryReadBits(8);
			if (value < 0) break;
			output[written] = value;
			written += 1;
		} else {
			const source = bits.tryReadBits(offsetBits);
			if (source < 0) break;
			const count = bits.tryReadBits(countBits);
			if (count < 0) break;
			const length = Math.min(output.length - written, count + 1);
			if (!copyOverlapped(output, source, written, length)) {
				throw invalidPicture("Mink run reaches outside its picture");
			}
			written += length;
		}
	}
}

/**
 * `DatFormat.ReadMetaData`: a marker byte, the length of the packed stream and the length the picture unfolds
 * to, the latter two having to agree with the stream that follows them. What the picture is comes from the
 * header of the bitmap it unfolds to, which the reference unfolds once and reads as a bitmap of its own.
 */
export function readDatLayout(data: Buffer): MinkLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data[0] !== MARKER) return undefined;
	const packedSize = data.readInt32LE(1);
	const unpackedSize = data.readInt32LE(5);
	if (packedSize !== data.length - HEADER_SIZE) return undefined;
	if (unpackedSize <= 0) return undefined;
	if (unpackedSize > MAXIMUM_PICTURE_BYTES) return undefined;
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	try {
		unpackMink(data, header);
	} catch {
		return undefined;
	}
	const fields = readBmpHeaderFields(header);
	if (!fields) return undefined;
	return { ...fields, unpackedSize };
}

export const minkDatImageDescriptor: FormatDescriptor = {
	id: "mink-dat-image",
	name: "Mink compressed bitmap",
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
			source: "Legacy/Mink/ImageDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const minkDatImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: minkDatImageDescriptor,
	// The reference registers this format under no word at all, so every file is offered to it.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE + BIT_FIELD_SIZE)) return false;
		return readDatLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readDatLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Mink picture");
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
							unpackedSize: layout.unpackedSize,
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
		const layout = readDatLayout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Mink picture");
		}
		if (layout.unpackedSize > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Mink picture of ${layout.unpackedSize} bytes is too large`,
			);
		}
		const picture: Buffer = Buffer.alloc(layout.unpackedSize, 0x00);
		unpackMink(stored, picture);
		const image = readBmpImage(picture);
		if (!image) {
			throw invalidPicture("Mink picture holds no bitmap");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
