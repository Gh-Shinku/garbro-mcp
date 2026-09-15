// Format reference: GARbro "Legacy/QSoft/ImageBPE.cs", class `BpeFormat`. The picture is a bitmap kept in a
// token stream, which the port reads the way the reference reads it and hands out again as a bitmap.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The reference reads the format only out of files named `.bpe`, since it declares no signature at all. */
const EXTENSION = ".bpe";
/** The first four bytes hold how much the stream unfolds to, which has to be as long as a bitmap header. */
const SIZE_FIELD = 0;
const STREAM_OFFSET = 4;
/** How much of the picture the reference unfolds to find the header of the bitmap with. */
const PREFIX_SIZE = 0x36;
const NODES = 0x100;
const STACK_SIZE = 1024;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The reference reads the format only out of files named `.bpe`, since it declares no signature at all. */
export function hasBpeExtension(sourcePath: string): boolean {
	return sourcePath
		.replace(/^.*[/\\]/, "")
		.toLowerCase()
		.endsWith(EXTENSION);
}

/**
 * `BpeFormat.Decompress`: the stream is a run of chunks, each of them behind a table of tokens. A token that
 * stands for itself is a byte of the picture; one that stands for something else is the two tokens it is made
 * of, written with the first of them behind the second in the table and taken up in that order, which is why a
 * token can stand for a whole run of bytes of the picture with nothing in the stream behind it. A table is laid
 * out by control bytes, which say how many tokens come next, and by a value above `0x7F`, which steps over that
 * many tokens less one hundred and twenty seven, leaving them standing for themselves.
 *
 * Every byte the reference reads past the end of the stream comes out as `0xFF` where a token is read, which is
 * what the port does as well; a word wanted past the end of the stream is where the reference's own reader
 * throws. A token that runs past the two hundred and fifty six the table holds, or a table that nests deeper
 * than the stack of a thousand and twenty four tokens, is refused. The picture comes back as long as the header
 * said it would, with whatever the stream did not live up to standing at nothing.
 */
export function decompressBpe(input: Buffer, unpackedSize: number): Buffer {
	const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
	const lhs: Buffer = Buffer.alloc(NODES, 0x00);
	const rhs: Buffer = Buffer.alloc(NODES, 0x00);
	const stack: Buffer = Buffer.alloc(STACK_SIZE, 0x00);
	let at = 0;
	let dst = 0;
	const readByte = (): number => (at < input.length ? (input[at++] ?? 0) : -1);
	let control = readByte();
	while (-1 !== control) {
		for (let node = 0; node < NODES; node += 1) {
			lhs[node] = node;
		}
		let token = 0;
		for (;;) {
			if (control > 0x7f) {
				token += control - 0x7f;
				control = 0;
			}
			if (NODES === token) break;
			for (let index = 0; index <= control; index += 1) {
				if (token >= NODES) {
					throw invalidPicture("QSoft picture runs past its token table");
				}
				lhs[token] = readByte() & 0xff;
				if (token !== lhs[token]) {
					rhs[token] = readByte() & 0xff;
				}
				token += 1;
			}
			if (NODES === token) break;
			control = readByte() & 0xff;
		}
		const high = readByte();
		const low = readByte();
		if (high < 0 || low < 0) {
			throw invalidPicture("QSoft picture is cut short of its stream");
		}
		let chunkSize = (high << 8) | low;
		let taken = 0;
		for (;;) {
			let token: number;
			if (0 !== taken) {
				taken -= 1;
				token = stack[taken] ?? 0;
			} else {
				if (0 === chunkSize) break;
				chunkSize -= 1;
				token = readByte();
				if (-1 === token) break;
			}
			if (token !== lhs[token]) {
				if (taken + 1 >= STACK_SIZE) {
					throw invalidPicture("QSoft picture runs out of room for its tokens");
				}
				stack[taken++] = rhs[token] ?? 0;
				stack[taken++] = lhs[token] ?? 0;
			} else {
				output[dst] = token;
				dst += 1;
				if (dst === output.length) return output;
			}
		}
		control = readByte();
	}
	return output;
}

/**
 * `BpeFormat.ReadMetaData`: the stream behind the four bytes that say how long the picture is unfolds into a
 * bitmap, of which the port reads the header. The measurements come from the header alone rather than from a
 * whole bitmap, since only a prefix of the picture is unfolded here.
 */
export function readBpePrefix(data: Buffer): Buffer | undefined {
	if (data.length <= STREAM_OFFSET) return undefined;
	if (data.readUInt32LE(SIZE_FIELD) < PREFIX_SIZE) return undefined;
	return decompressBpe(data.subarray(STREAM_OFFSET), PREFIX_SIZE);
}

/** The header of the bitmap the picture unfolds into, which is what the measurements are read from. */
export function readBpeFields(
	data: Buffer,
): { width: number; height: number; bitsPerPixel: number } | undefined {
	const prefix = readBpePrefix(data);
	if (!prefix) return undefined;
	return readBmpHeaderFields(prefix);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const qsoftBpeImageDescriptor: FormatDescriptor = {
	id: "qsoft-bpe-image",
	name: "Qsoft image format",
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
			source: "Legacy/QSoft/ImageBPE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const qsoftBpeImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: qsoftBpeImageDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (source.size <= BigInt(STREAM_OFFSET)) return false;
		if (!hasBpeExtension(sourcePath)) return false;
		return readBpeFields(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const fields = readBpeFields(stored);
		if (!fields) {
			throw invalidPicture("Not a QSoft picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(STREAM_OFFSET),
						size: BigInt(stored.readUInt32LE(SIZE_FIELD)),
						compressed: true,
						metadata: {
							type: "image",
							width: fields.width,
							height: fields.height,
							bitsPerPixel: fields.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "bpe",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const fields = readBpeFields(stored);
		if (!fields) {
			throw invalidPicture("Not a QSoft picture");
		}
		const unpackedSize = stored.readUInt32LE(SIZE_FIELD);
		if (unpackedSize > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`QSoft picture of ${unpackedSize} bytes is too large`,
			);
		}
		const bitmap = decompressBpe(stored.subarray(STREAM_OFFSET), unpackedSize);
		// `Bmp.Read`: the reference takes the bitmap apart and hands the picture out, which the port mirrors.
		const image = readBmpImage(bitmap);
		if (!image) {
			throw invalidPicture("Not a QSoft picture");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
