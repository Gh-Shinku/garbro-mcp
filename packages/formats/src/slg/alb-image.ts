// Format reference: GARbro "ArcFormats/Slg/ImageALB.cs", class `AlbFormat` with the `AlbStream` it unwraps
// through. The picture inside is a PNG, a DDS or a JPEG, which this project reads through the formats it
// already carries rather than here. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readDdsLayout, readDdsPicture } from "../directdraw/dds-image.js";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readPngImage } from "../shared/png-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { readPngHeaderFields } from "../shared/png.js";

/** 'ALB1', and the size the stream unfolds to behind it. */
const SIGNATURE = Buffer.from("ALB1", "latin1");
const UNPACKED_SIZE_FIELD = 8;
const HEADER_SIZE = 0x10;
/** The three kinds of picture the unwrapped bytes can be. The reference falls back to JPEG. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const DDS_SIGNATURE = Buffer.from("DDS ", "latin1");
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
/** How much of the stream is unwrapped to tell what is inside it. */
const HEAD_SIZE = 8;
/**
 * How much of it is unwrapped to read the header of the picture, which the reference does while it unwraps
 * only as far as its own reader asks. A header that lies further in than this is left unread.
 */
const FIELDS_SIZE = 0x1000;
/** The dictionary walk. */
const BLOCK_TAG = 0x4850;
/** The tag, the size of the dictionary, the count of symbols, and the two bytes the coding is named with. */
const BLOCK_HEADER_SIZE = 8;
const DICTIONARY_SIZE = 0x100;
const ENTRY_SIZE = 2;
const STACK_SIZE = 0x100;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export type AlbKind = "png" | "dds" | "jpeg";

export interface AlbLayout {
	kind: AlbKind;
	/** The size the stream declares, which is the size of the picture inside it. */
	unpackedSize: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The kind of picture a stream that opens with this much of itself holds. */
function innerKind(head: Buffer): AlbKind | undefined {
	if (
		head.length >= PNG_SIGNATURE.length &&
		head.subarray(0, 4).equals(PNG_SIGNATURE)
	) {
		return "png";
	}
	if (
		head.length >= DDS_SIGNATURE.length &&
		head.subarray(0, 4).equals(DDS_SIGNATURE)
	) {
		return "dds";
	}
	if (
		head.length >= JPEG_SIGNATURE.length &&
		head.subarray(0, 2).equals(JPEG_SIGNATURE)
	) {
		return "jpeg";
	}
	return undefined;
}

/**
 * `AlbStream.ReadSeq` with `UnpackDict`: the stream behind the header is a run of blocks, and a block opens
 * with the word `PH`, the size of its dictionary -- which the reference reads and never uses -- the number of
 * bytes its symbols take, a byte saying whether the dictionary is run length coded, and the marker that
 * coding uses.
 *
 * A dictionary entry is two bytes, and an entry whose first byte is its own index stands for itself; every
 * other entry stands for its two bytes, the first of the pair first, which the reference expands by pushing
 * them on a stack. The symbols behind the dictionary are read until the count in the head runs out, and every
 * symbol that does not stand for itself is expanded, so a block ends up a stream of bytes.
 *
 * The reference lets a dictionary that runs past itself, or one that nests deeper than its stack, throw, and
 * stops only when its reader has what it asked for; this port refuses the first two and stops at the size it
 * was given, so a picture that unfolds to less than it declares is seen to be short.
 */
export function unpackAlb(data: Buffer, size: number): Buffer {
	const output: Buffer = Buffer.alloc(size, 0x00);
	const dictionary: Buffer = Buffer.alloc(DICTIONARY_SIZE * ENTRY_SIZE, 0x00);
	const stack = new Uint8Array(STACK_SIZE);
	let source = 0;
	let target = 0;
	while (source < data.length && target < output.length) {
		if (source + BLOCK_HEADER_SIZE > data.length) {
			throw invalidImage("The dictionary of the picture is cut short");
		}
		if (data.readUInt16LE(source) !== BLOCK_TAG) {
			throw invalidImage("The dictionary of the picture is missing");
		}
		source += 2;
		source += 2;
		const packedSize = data.readUInt16LE(source);
		source += 2;
		const isPacked = 0 !== data[source];
		source += 1;
		const marker = data[source] ?? 0;
		source += 1;
		if (isPacked) {
			let index = 0;
			while (index < DICTIONARY_SIZE) {
				if (source >= data.length) {
					throw invalidImage("The dictionary of the picture is cut short");
				}
				const value = data[source] ?? 0;
				source += 1;
				if (value === marker) {
					if (source >= data.length) {
						throw invalidImage("The dictionary of the picture is cut short");
					}
					const count = data[source] ?? 0;
					source += 1;
					if (index + count > DICTIONARY_SIZE) {
						throw invalidImage(
							"The dictionary of the picture runs past itself",
						);
					}
					for (let run = 0; run < count; run += 1) {
						dictionary[index * ENTRY_SIZE] = index;
						dictionary[index * ENTRY_SIZE + 1] = 0;
						index += 1;
					}
				} else {
					if (source >= data.length) {
						throw invalidImage("The dictionary of the picture is cut short");
					}
					dictionary[index * ENTRY_SIZE] = value;
					dictionary[index * ENTRY_SIZE + 1] = data[source] ?? 0;
					source += 1;
					index += 1;
				}
			}
		} else {
			if (source + DICTIONARY_SIZE * ENTRY_SIZE > data.length) {
				throw invalidImage("The dictionary of the picture is cut short");
			}
			data.copy(dictionary, 0, source, source + DICTIONARY_SIZE * ENTRY_SIZE);
			source += DICTIONARY_SIZE * ENTRY_SIZE;
		}
		let depth = 0;
		let symbols = 0;
		for (;;) {
			let symbol: number;
			if (depth > 0) {
				depth -= 1;
				symbol = stack[depth] ?? 0;
			} else if (symbols < packedSize && source < data.length) {
				symbol = data[source] ?? 0;
				source += 1;
				symbols += 1;
			} else {
				break;
			}
			const first = dictionary[symbol * ENTRY_SIZE] ?? 0;
			if (first === symbol) {
				output[target] = symbol;
				target += 1;
				if (target >= output.length) break;
			} else {
				if (depth + 2 > STACK_SIZE) {
					throw invalidImage("The dictionary of the picture nests too deeply");
				}
				stack[depth] = dictionary[symbol * ENTRY_SIZE + 1] ?? 0;
				depth += 1;
				stack[depth] = first;
				depth += 1;
			}
		}
	}
	return output.subarray(0, target);
}

/**
 * `AlbFormat.ReadMetaData`: the header says how long the stream behind it unfolds to, and what unfolds out of
 * the front of it is a picture of one of three kinds. The reference hands that picture to whichever format
 * reads it; this port tells the kind apart and leaves the picture to the reader that already carries it.
 */
export function readAlbLayout(data: Buffer): AlbLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize <= 0 || unpackedSize > LIMIT) return undefined;
	let head: Buffer;
	try {
		head = unpackAlb(data.subarray(HEADER_SIZE), HEAD_SIZE);
	} catch {
		return undefined;
	}
	const kind = innerKind(head);
	if (undefined === kind) return undefined;
	return { kind, unpackedSize };
}

/** The fields of the picture inside, for the kinds this project can read a header off. */
function innerFields(
	kind: AlbKind,
	picture: Buffer,
): { width: number; height: number; bitsPerPixel: number } | undefined {
	if ("png" === kind) return readPngHeaderFields(picture);
	if ("dds" === kind) return readDdsLayout(picture, picture.length);
	return readJpegHeaderFields(picture);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const slgAlbImageDescriptor: FormatDescriptor = {
	id: "slg-alb-image",
	name: "SLG system image",
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
			source: "ArcFormats/Slg/ImageALB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const slgAlbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: slgAlbImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readAlbLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readAlbLayout(stored);
		if (!layout) {
			throw invalidImage("Not an SLG picture");
		}
		const fields = innerFields(
			layout.kind,
			unpackAlb(
				stored.subarray(HEADER_SIZE),
				Math.min(layout.unpackedSize, FIELDS_SIZE),
			),
		);
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: "image.bmp",
			offset: BigInt(HEADER_SIZE),
			size: BigInt(layout.unpackedSize),
			compressed: true,
			metadata: {
				type: "image",
				...fields,
			},
		});
		return {
			entries: [{ ...entry, sizeKnown: false }],
			metadata: {
				image: "bmp",
				compressed: true,
				unpackedSize: layout.unpackedSize,
				...fields,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readAlbLayout(stored);
		if (!layout) {
			throw invalidImage("Not an SLG picture");
		}
		const picture = unpackAlb(
			stored.subarray(HEADER_SIZE),
			layout.unpackedSize,
		);
		if (picture.length < layout.unpackedSize) {
			throw invalidImage("The picture unfolds to less than it declares");
		}
		// The reference hands the unfolded picture to the format that reads it — the portable network graphic
		// reader, the Direct Draw surface reader or `Jpeg.Read`, the platform decoder of the Windows imaging
		// stack — and this port reads it with the same three readers of this project and hands a bitmap over.
		if ("png" === layout.kind) {
			const image = await readPngImage(picture);
			if (!image) throw invalidImage("Not an SLG picture");
			return Readable.from([
				32 === image.bitsPerPixel
					? writeBmp32(image.width, image.height, image.pixels)
					: writeBmp24(image.width, image.height, image.pixels),
			]);
		}
		if ("dds" === layout.kind) {
			const surface = readDdsLayout(picture, picture.length);
			if (!surface) throw invalidImage("Not an SLG picture");
			return Readable.from([
				writeBmp32(
					surface.width,
					surface.height,
					readDdsPicture(picture, surface),
				),
			]);
		}
		const image = readJpegImage(picture);
		return Readable.from([writeBmp32(image.width, image.height, image.pixels)]);
	},
});
