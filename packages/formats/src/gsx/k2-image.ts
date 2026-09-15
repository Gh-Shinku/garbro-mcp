// Format reference: GARbro "Legacy/Gsx/ImageK2.cs", class `K2Format` (Toyo GSX image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/**
 * The reference registers this format under seven words rather than one: `K2` and then a byte that differs
 * between them, with a NUL behind it. The word is compared whole, so the fourth byte counts as well.
 */
const MAGIC = Buffer.from("K2", "ascii");
const THIRD_BYTES = [0x18, 0x20, 0x10, 0x0f, 0x08, 0x04, 0x01];
const SIGNATURES = THIRD_BYTES.map((value) =>
	Buffer.from([0x4b, 0x32, value, 0x00]),
);
/** The length the picture unfolds to sits here; the offset of the stream sits further on. */
const UNPACKED_SIZE_FIELD = 6;
const DATA_POSITION_FIELD = 0x12;
/** Both the control bits and the stream are counted from the word of the length, the former by this much. */
const CONTROL_BASE = 0x10;
const HEADER_SIZE = 0x16;
/** How much of the picture the reference unfolds to read its header. */
const BMP_HEADER_SIZE = 0x36;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;

export interface K2Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
}

function isK2Signature(data: Buffer): boolean {
	if (!data.subarray(0, 2).equals(MAGIC)) return false;
	return THIRD_BYTES.includes(data[2] ?? -1) && data[3] === 0x00;
}

export const gsxK2ImageDescriptor: FormatDescriptor = {
	id: "gsx-k2-image",
	name: "Toyo GSX image",
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
			source: "Legacy/Gsx/ImageK2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Where the control plane and the stream of a file begin, and how much of the plane it holds. */
function streamPositions(
	data: Buffer,
	unpackedSize: number,
): { controlBits: number; controlOffset: number; streamOffset: number } {
	const dataPosition = data.readInt32LE(DATA_POSITION_FIELD);
	// The reference caps the control plane at one bit to a byte of the picture, and a plane that would start
	// behind its own stream holds nothing at all.
	const controlBits = Math.max(
		0,
		Math.min(dataPosition - CONTROL_BASE, Math.ceil(unpackedSize / 8)),
	);
	return {
		controlBits,
		controlOffset: HEADER_SIZE,
		streamOffset: UNPACKED_SIZE_FIELD + dataPosition,
	};
}

/**
 * `K2Format.Decompress`: the control bits and the stream of the picture are kept apart, the former in a plane
 * of its own and the latter behind it. A bit of ones is a byte of the picture; a bit of nothing is a run, and
 * the bit behind it says how wide its place and its length are written — a place of fourteen bits and a length
 * of four, three longer than the count, or a place of nine and a length of three, two longer. A stream that
 * ends leaves the rest of the picture as it was, and a run that reaches before the start of the picture is
 * refused here, where the reference's own copy would throw.
 */
export function unpackK2(data: Buffer, unpackedSize: number): Buffer {
	const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
	if (data.length < HEADER_SIZE) return output;
	const { controlBits, controlOffset, streamOffset } = streamPositions(
		data,
		unpackedSize,
	);
	const controls = new MsbBitReader(
		data.subarray(controlOffset, controlOffset + controlBits),
	);
	const stream = new MsbBitReader(data, streamOffset);
	let destination = 0;
	while (destination < unpackedSize) {
		const control = controls.tryReadBits(1);
		if (control === -1) break;
		if (control !== 0) {
			// A stream that has ended reads as ones, which is what the reference writes down.
			output[destination] = (stream.tryReadBits(8) ?? -1) & 0xff;
			destination += 1;
			continue;
		}
		let offset: number;
		let count: number;
		if (controls.tryReadBits(1) !== 0) {
			// A control bit of ones — and one that is missing, which the reference reads the same way.
			offset = stream.tryReadBits(14);
			count = (stream.tryReadBits(4) ?? -1) + 3;
		} else {
			offset = stream.tryReadBits(9);
			count = (stream.tryReadBits(3) ?? -1) + 2;
		}
		const length = Math.min(count, unpackedSize - destination);
		if (
			!copyOverlapped(output, destination - offset - 1, destination, length)
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Toyo GSX run reaches outside its picture",
			);
		}
		destination += length;
	}
	return output;
}

/**
 * `K2Format.ReadMetaData`: the picture is a **bitmap** in full, and the reference unfolds the first fifty four
 * bytes of it to read the header off them. A file that does not unfold to a bitmap header is not one this
 * format claims.
 */
export function readK2Layout(data: Buffer): K2Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!isK2Signature(data)) return undefined;
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize < BMP_HEADER_SIZE || unpackedSize > MAXIMUM_PICTURE_BYTES) {
		return undefined;
	}
	const header = unpackK2(data, BMP_HEADER_SIZE);
	const fields = readBmpHeaderFields(header);
	if (!fields) return undefined;
	return { ...fields, unpackedSize };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gsxK2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsxK2ImageDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readK2Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readK2Layout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Toyo GSX picture");
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
		const layout = readK2Layout(stored);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Toyo GSX picture");
		}
		const picture = unpackK2(stored, layout.unpackedSize);
		const image = readBmpImage(picture);
		if (!image) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Toyo GSX picture holds no bitmap",
			);
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
