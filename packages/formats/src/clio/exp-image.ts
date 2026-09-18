// Format reference: GARbro "Legacy/Clio/ImageEXP.cs", classes `ExpFormat`, `ExpMetaData` and `ExpReader` (a
// Clio compressed bitmap: an LZ78 style dictionary whose tokens are expanded onto a stack, behind a `PXEN`
// head). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'PXEN', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("PXEN", "latin1");
/** The head: the signature, a name of thirty two bytes and the size of the bitmap. */
const NAME_OFFSET = 4;
const NAME_SIZE = 0x20;
const BITMAP_SIZE_FIELD = NAME_OFFSET + NAME_SIZE;
const DATA_OFFSET = BITMAP_SIZE_FIELD + 4;
/** The bytes of the bitmap the reference unfolds to learn its measurements. */
const BITMAP_PREFIX = 0x36;
/** The stack the reference builds its expansions on, which is the name it read. */
const STACK_SIZE = NAME_SIZE;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface ExpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The size of the unfolded bitmap the head declares. */
	bitmapSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `ExpFormat.ReadMetaData`: the word `PXEN`, a name of thirty two bytes and then the size of the bitmap as a
 * word. The reference unfolds the first fifty four bytes of that bitmap and reads them through its own bitmap
 * reader, so the measurements and the depth are that reader's.
 */
export function readExpLayout(data: Buffer): ExpLayout | undefined {
	if (data.length < DATA_OFFSET) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const bitmapSize = data.readInt32LE(BITMAP_SIZE_FIELD);
	if (bitmapSize < 0) return undefined;
	const prefix = unpackExp(data.subarray(DATA_OFFSET), BITMAP_PREFIX);
	const fields = readBmpHeaderFields(prefix);
	if (!fields) return undefined;
	const size = fields.width * fields.height * (fields.bitsPerPixel / 8);
	if (!Number.isSafeInteger(size) || size < 0 || bitmapSize > LIMIT)
		return undefined;
	return { ...fields, bitmapSize };
}

/**
 * `ExpReader.Unpack`: the stream is a walk of blocks. Every block begins by resetting a table of two hundred
 * and fifty six entries to name themselves, and then reads that table: a control byte above one hundred and
 * twenty seven moves the place on by the control less one hundred and twenty seven and reads nothing itself,
 * and the control as it then stands is one less than the run of entries that follow. Every entry is one byte,
 * and a byte that does not name its own place takes a second byte behind it.
 *
 * Behind the table stands a count of two bytes and then that many tokens. A token that names its own place is
 * a byte of the picture; every other token puts its second byte and then its own place on a stack, which is
 * walked from the top, so a token may expand into more tokens. The reference builds that stack on the name it
 * read from the head, so it holds at most thirty two bytes; this port refuses a stack that would grow past it
 * as the reference's own array write would, and a stream that stops where a byte is wanted.
 */
export function unpackExp(input: Buffer, outputSize: number): Buffer {
	const output: Buffer = Buffer.alloc(Math.max(0, outputSize), 0x00);
	const table0 = new Uint8Array(0x100);
	const table1 = new Uint8Array(0x100);
	const stack = Buffer.alloc(STACK_SIZE, 0x00);
	let source = 0;
	let dst = 0;
	const readByte = (): number => {
		if (source >= input.length) {
			throw invalidPicture("Clio picture is cut short of its stream");
		}
		const value = input[source] ?? 0;
		source += 1;
		return value;
	};
	while (dst < output.length && source < input.length) {
		for (let index = 0; index < 0x100; index += 1) table0[index] = index;
		let place = 0;
		do {
			let control = readByte();
			if (control > 127) {
				place += control - 127;
				control = 0;
			}
			if (place !== 0x100) {
				let count = control + 1;
				while (count-- > 0) {
					const value = readByte();
					table0[place] = value;
					if (place !== value) table1[place] = readByte();
					place += 1;
				}
			}
		} while (place !== 0x100);
		let count = (readByte() << 8) | readByte();
		let stackPosition = 0;
		for (;;) {
			let token: number;
			if (stackPosition !== 0) {
				stackPosition -= 1;
				token = stack[stackPosition] ?? 0;
			} else {
				if (0 === count--) break;
				token = readByte();
			}
			if (token === table0[token]) {
				output[dst] = token;
				dst += 1;
				if (dst >= output.length) break;
			} else {
				if (stackPosition + 2 > stack.length) {
					throw invalidPicture("Clio picture expands past the stack it holds");
				}
				stack[stackPosition] = table1[token] ?? 0;
				stackPosition += 1;
				stack[stackPosition] = table0[token] ?? 0;
				stackPosition += 1;
			}
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<ExpLayout | undefined> {
	if (source.size < BigInt(DATA_OFFSET)) return undefined;
	try {
		const stored = await readStored(source);
		return readExpLayout(stored);
	} catch {
		return undefined;
	}
}

export const clioExpImageDescriptor: FormatDescriptor = {
	id: "clio-exp-image",
	name: "Clio compressed bitmap",
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
			source: "Legacy/Clio/ImageEXP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const clioExpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: clioExpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Clio picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(DATA_OFFSET),
				size: source.size - BigInt(DATA_OFFSET),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// The bitmap is unfolded from a dictionary walk and write out at the depth it was stored in.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Clio picture");
		}
		const stored = await readStored(source);
		const bitmap = unpackExp(stored.subarray(DATA_OFFSET), layout.bitmapSize);
		const image = readBmpImage(bitmap);
		if (!image) {
			throw invalidPicture("Not a Clio picture");
		}
		// `Bmp.Read` hands the bitmap out, which the port writes again at the depth it was stored in.
		return Readable.from([writeBmpImage(image)]);
	},
});
