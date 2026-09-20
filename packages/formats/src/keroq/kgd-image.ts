// Format reference: GARbro "Legacy/KeroQ/ImageKGD.cs", classes `KgdFormat`, `KgdMetaData` and
// `PngRestoreStream` (a KeroQ picture: a picture of the Portable Network Graphics kind that has lost its
// signature and its header and had its chunks cut apart, which the reference puts back together before it
// hands them to a decoder of that kind). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The eight bytes every picture of the kind begins with, which the engine leaves out of its own file. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** '\x89KGD', the word the reference registers. */
const SIGNATURE = Buffer.from([0x89, 0x4b, 0x47, 0x44]);
const HEADER_SIZE = 0x19;
const MARK_FIELD = 4;
/** The word at four and the byte at eight every picture of the engine begins with. */
const MARK_VALUE = 0x10;
const KIND_FIELD = 8;
const KIND_VALUE = 1;
const WIDTH_FIELD = 9;
const HEIGHT_FIELD = 0x0d;
const BITS_PER_PLANE_FIELD = 0x11;
const COLOR_TYPE_FIELD = 0x12;
/** How many bits a pixel takes for every kind of picture the engine writes. */
const BITS_PER_PIXEL: Record<number, (bitsPerPlane: number) => number> = {
	0: (bits) => bits,
	2: (bits) => bits * 3,
	3: () => 24,
	4: (bits) => bits * 2,
	6: (bits) => bits * 4,
};
/** The checksum the end of a picture stands behind. */
const IEND_CHECKSUM = 0xae426082;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface KgdLayout {
	width: number;
	height: number;
	bitsPerPlane: number;
	colorType: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `KgdFormat.ReadMetaData`: the head begins with the word `\x89KGD`, stands ten at four and one at eight,
 * the width and the height stand at nine and `0x0D` as words, and the bits of a plane and the kind of picture
 * at `0x11` and `0x12`. The kind says how many bits a pixel takes: nought leaves the bits of a plane as they
 * are, two trebles them, three means twenty four bits a pixel, four doubles them and six takes them four
 * times over.
 */
export function readKgdLayout(
	data: Buffer,
	fileLength = data.length,
): KgdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (MARK_VALUE !== data.readInt32LE(MARK_FIELD)) return undefined;
	if (KIND_VALUE !== (data[KIND_FIELD] ?? 0)) return undefined;
	const colorType = data[COLOR_TYPE_FIELD] ?? 0;
	const scale = BITS_PER_PIXEL[colorType];
	if (!scale) return undefined;
	const bitsPerPlane = data[BITS_PER_PLANE_FIELD] ?? 0;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	if (HEADER_SIZE >= fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPlane,
		colorType,
		bitsPerPixel: scale(bitsPerPlane),
	};
}

export function adler32(
	data: Buffer,
	offset = 0,
	length = data.length - offset,
): number {
	let first = 1;
	let second = 0;
	for (let index = 0; index < length; index += 1) {
		first = (first + (data[offset + index] ?? 0)) % 65521;
		second = (second + first) % 65521;
	}
	return ((second << 16) | first) >>> 0;
}

/** A chunk of a picture of the kind: its size, its name, its own bytes and its checksum, all big endian. */
function pngChunk(name: string, data: Buffer): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.writeUInt32BE(data.length, 0);
	head.write(name, 4, "latin1");
	const checksum = Buffer.alloc(4, 0x00);
	checksum.writeUInt32BE(adler32(data), 0);
	return Buffer.concat([head, data, checksum]);
}

/**
 * `PngRestoreStream`: the head of the kind the engine leaves out is built again from what the file says — the
 * eight bytes of the signature, a header of thirteen bytes holding the width, the height, the bits of a plane,
 * the kind of picture and three bytes of nought, and the checksum behind it. Then every piece of the file
 * stands behind a word of its size and a kind byte of two, which the stream puts back as a chunk of its own,
 * the size being the one the piece really holds. Where the file ends a chunk of nought bytes named `IEND`
 * stands.
 */
export function restoreKgdPng(stored: Buffer, layout: KgdLayout): Buffer {
	const header = Buffer.alloc(13, 0x00);
	header.writeUInt32BE(layout.width, 0);
	header.writeUInt32BE(layout.height, 4);
	header[8] = layout.bitsPerPlane;
	header[9] = layout.colorType;
	const parts: Buffer[] = [PNG_SIGNATURE, pngChunk("IHDR", header)];
	let position = HEADER_SIZE;
	while (position < stored.length) {
		if (position + 5 > stored.length) {
			throw invalidPicture("KeroQ picture is cut short of its stream");
		}
		const declared = stored.readUInt32LE(position);
		const kind = stored[position + 4] ?? 0;
		position += 5;
		if (2 !== kind) {
			throw invalidPicture(
				"KeroQ picture holds a piece that is not part of its stream",
			);
		}
		if (declared < 0 || position + declared > stored.length) {
			throw invalidPicture("KeroQ picture is cut short of its stream");
		}
		parts.push(
			pngChunk("IDAT", stored.subarray(position, position + declared)),
		);
		position += declared;
	}
	const end = Buffer.alloc(12, 0x00);
	end.write("IEND", 4, "latin1");
	end.writeUInt32BE(IEND_CHECKSUM, 8);
	parts.push(end);
	return Buffer.concat(parts);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const keroqKgdImageDescriptor: FormatDescriptor = {
	id: "keroq-kgd-image",
	name: "KeroQ image format",
	extensions: ["kgd"],
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
			source: "Legacy/KeroQ/ImageKGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const keroqKgdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: keroqKgdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readKgdLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readKgdLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a KeroQ picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					colorType: layout.colorType,
				},
			}),
			// The pieces are put back together and a signature and a header are written in front of them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				compression: "deflate",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readKgdLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a KeroQ picture");
		}
		// The reference hands the picture it has put back together to a decoder of the kind and swaps the
		// red and the blue of every pixel of a picture of more than two bytes a pixel; the port hands the
		// picture itself out instead, so there are no pixels of a decoder's own making to swap.
		return Readable.from([restoreKgdPng(stored, layout)]);
	},
});
