// Format reference: GARbro "ArcFormats/ImageEGN.cs", classes `EgnFormat`, `EgnMetaData` and
// `EgnFormat.Reader` (a bitmap behind the engine's own LZSS, of which the head carries nothing but the
// inverse of its first word). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The depth of the bitmap's own head, which is all the reference reads to learn the measurements. */
const BMP_HEAD_SIZE = 0x36;
const MAXIMUM_DATA_SIZE = 0xffffff;
const MODE_MASK = 0x70;
const MODE_SHIFT = 4;
const FLAG_MASK = 0x0f;
const SHORT_FORM_MARK = 0x80;
const SIZE_MASK = 0xffffff;
/** The two places the stream may stand: behind the word, or behind the word and the size. */
const SHORT_DATA_OFFSET = 4;
const LONG_DATA_OFFSET = 8;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/**
 * `Reader.ShiftTable`: the two words the walk of every flag is built from — how far a reference's count is
 * shifted up and the count it starts from.
 */
const SHIFT_TABLE = new Uint8Array([
	0x0c, 0x03, 0x0b, 0x03, 0x0a, 0x03, 0x09, 0x03, 0x06, 0x03, 0x05, 0x03, 0x06,
	0x02, 0x05, 0x02, 0x08, 0x04, 0x07, 0x04, 0x80, 0x40, 0x20, 0x10, 0x08, 0x04,
	0x02, 0x01, 0x00, 0x00, 0x00, 0x00,
]);

export interface EgnLayout {
	mode: number;
	flag: number;
	dataOffset: number;
	unpackedSize: number;
	/** The measurements the bitmap behind the stream declares. */
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The byte order of a word the head carries the other way round, which the reference calls its big endian. */
function swapBytes(value: number): number {
	return (
		(((value >>> 24) & 0xff) |
			(((value >>> 16) & 0xff) << 8) |
			(((value >>> 8) & 0xff) << 16) |
			((value & 0xff) << 24)) >>>
		0
	);
}

/**
 * `Reader.UnpackV0`: a walk of two kinds of step behind a bit. A set bit is a byte that stands itself; a
 * clear one is a word the **other way round**, whose highest bits count the bytes the step takes and whose
 * lowest ones count the places behind the walk they come from, both of them told apart by the flag's own two
 * words. A step may reach before the start of the picture, and the bytes before it stand as noughts, which
 * is what the reference leaves there.
 */
export function unpackEgn(
	stored: Buffer,
	offset: number,
	outputSize: number,
	flag: number,
): Buffer {
	const output: Buffer = Buffer.alloc(outputSize, 0x00);
	const countShift = SHIFT_TABLE[2 * flag] ?? 0;
	const offsetMask = (1 << countShift) - 1;
	const baseOffset = SHIFT_TABLE[2 * flag + 1] ?? 0;
	let position = offset;
	const readByte = (): number => {
		if (position >= stored.length) {
			throw invalidPicture("LZSS bitmap is cut short of its stream");
		}
		const value = stored[position] ?? 0;
		position += 1;
		return value;
	};
	let dst = 0;
	let control = 0;
	let mask = 0;
	while (dst < output.length) {
		mask >>= 1;
		if (0 === mask) {
			control = readByte();
			mask = 0x80;
		}
		if (0 !== (mask & control)) {
			output[dst] = readByte();
			dst += 1;
			continue;
		}
		const first = readByte();
		const second = readByte();
		const word = (first << 8) | second;
		let count = baseOffset + (word >> countShift);
		let source = dst - (word & offsetMask);
		do {
			output[dst] = source >= 0 ? (output[source] ?? 0) : 0;
			source += 1;
			dst += 1;
			count -= 1;
		} while (count > 0 && dst < output.length);
	}
	return output;
}

/**
 * `EgnFormat.ReadMetaData`: the head carries the **inverse** of its first word. The word's fourth to sixth
 * bits are the mode, of which only nought is walked at all — the modes one, two and three are refused by the
 * reader itself and the rest by the head — and its lowest four are the flag that tells the two words of the
 * walk apart. Where the seventh bit is set the stream stands four bytes in and its size is the highest three
 * bytes of the word; otherwise the stream stands eight bytes in and its size is a word of its own behind it,
 * **the other way round**. Only the first bytes of the stream are walked to read the measurements the bitmap
 * itself declares.
 */
export function readEgnLayout(
	data: Buffer,
	fileLength = data.length,
): EgnLayout | undefined {
	if (data.length < 4) return undefined;
	const signature = ~data.readInt32LE(0);
	const mode = (signature & MODE_MASK) >> MODE_SHIFT;
	if (0 !== (mode & 4) || 0 !== mode) return undefined;
	const flag = signature & FLAG_MASK;
	let dataOffset: number;
	let unpackedSize: number;
	if (0 !== (signature & SHORT_FORM_MARK)) {
		dataOffset = SHORT_DATA_OFFSET;
		unpackedSize = swapBytes(signature) & SIZE_MASK;
	} else {
		if (data.length < LONG_DATA_OFFSET) return undefined;
		dataOffset = LONG_DATA_OFFSET;
		unpackedSize = data.readInt32BE(4);
	}
	if (unpackedSize <= 0 || unpackedSize > MAXIMUM_DATA_SIZE) return undefined;
	if (unpackedSize > LIMIT) return undefined;
	if (dataOffset >= fileLength) return undefined;
	if (SHIFT_TABLE.length <= 2 * flag + 1) return undefined;
	// The reference walks the first fifty four bytes of the stream on its own, which is the bitmap's head,
	// and reads the measurements out of that.
	const head = unpackEgn(
		data,
		dataOffset,
		Math.min(BMP_HEAD_SIZE, unpackedSize),
		flag,
	);
	const fields = readBmpHeaderFields(head);
	if (!fields) return undefined;
	return {
		mode,
		flag,
		dataOffset,
		unpackedSize,
		width: fields.width,
		height: fields.height,
		bitsPerPixel: fields.bitsPerPixel,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const egnImageDescriptor: FormatDescriptor = {
	id: "egn-image",
	name: "LZSS-compressed BMP image",
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
			source: "ArcFormats/ImageEGN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const egnImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: egnImageDescriptor,
	// The reference registers no signature at all: the head carries the inverse of its first word and the
	// bitmap behind the stream is what tells this format from others, so it is tried after the rest.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 4n) return false;
		try {
			const stored = await readStored(source);
			return readEgnLayout(stored, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readEgnLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an LZSS-compressed bitmap");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					mode: layout.mode,
					flag: layout.flag,
					unpackedSize: layout.unpackedSize,
				},
			}),
			// The bitmap is unfolded from the walk and written out as the bitmap it is.
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
		const stored = await readStored(source);
		const layout = readEgnLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not an LZSS-compressed bitmap");
		}
		const bitmap = unpackEgn(
			stored,
			layout.dataOffset,
			layout.unpackedSize,
			layout.flag,
		);
		const image = readBmpImage(bitmap);
		if (!image) {
			throw invalidPicture("LZSS-compressed picture does not hold a bitmap");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
