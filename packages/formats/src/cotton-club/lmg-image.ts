// Format reference: GARbro "Legacy/CottonClub/ImageLMG.cs", classes `LmgFormat`, `LmgMetaData` and
// `LmgReader` (a Cotton Club picture whose stream is scrambled with a key of its own file name). GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'LMG' with the method behind it, which is the last byte of each of the three words. */
const MARK = "LMG";
const METHODS = [1, 2, 3];
const HEADER_SIZE = 12;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface LmgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The method the head declares: pixels that stand, a run walk, or a JPEG. */
	method: number;
	/** The bytes of the scrambled stream behind the head. */
	dataLength: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `LmgFormat.ReadMetaData`: the head begins with `LMG` and the method behind it, of which `1`, `2` and `3`
 * are read; the width and the height stand at four and eight as words, and the depth is thirty two bits for
 * the run walk of method two and twenty four for the other two.
 */
export function readLmgLayout(
	data: Buffer,
	fileLength = data.length,
): LmgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.subarray(0, MARK.length).toString("latin1") !== MARK)
		return undefined;
	const method = data[3] ?? 0;
	if (!METHODS.includes(method)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > 0x8000 || height > 0x8000) return undefined;
	const dataLength = fileLength - HEADER_SIZE;
	if (dataLength <= 0) return undefined;
	if (2 === method) {
		if (width * height * 4 > LIMIT) return undefined;
	} else if (1 === method) {
		if (width * height * 3 > dataLength) return undefined;
	}
	return {
		width,
		height,
		bitsPerPixel: 2 === method ? 32 : 24,
		method,
		dataLength,
	};
}

/**
 * `LmgFormat.DecryptData`: the key is the exclusive or of every byte of the file's own name, in lower case,
 * and the stream is then unscrambled a byte at a time — every byte is exclusive ored with the byte before it,
 * the key for the first one being the name's own.
 */
export function decryptLmg(data: Buffer, sourcePath: string): void {
	const name = sourcePath.replace(/^.*[/\\]/, "").toLowerCase();
	let key = 0;
	for (let index = 0; index < name.length; index += 1) {
		key ^= name.charCodeAt(index) & 0xff;
	}
	for (let index = 0; index < data.length; index += 1) {
		const value = data[index] ?? 0;
		data[index] = value ^ key;
		key = value;
	}
}

/** A cursor over the scrambled stream that refuses to walk past its end. */
class LmgCursor {
	readonly #data: Buffer;
	#position = 0;

	constructor(data: Buffer) {
		this.#data = data;
	}

	/** How many bytes of the stream are left, which is what the reference's own loop asks of its place. */
	remaining(): number {
		return this.#data.length - this.#position;
	}

	readByte(): number {
		if (this.#position >= this.#data.length) {
			throw invalidPicture("Cotton Club picture is cut short of its stream");
		}
		const value = this.#data[this.#position] ?? 0;
		this.#position += 1;
		return value;
	}

	/** `LmgReader.GetLength8`: every byte of nothing before the length adds two hundred and fifty five. */
	readLength8(): number {
		let value = 0;
		for (;;) {
			const byte = this.#data[this.#position];
			if (byte === undefined) {
				throw invalidPicture("Cotton Club picture is cut short of its stream");
			}
			if (byte !== 0) break;
			value += 0xff;
			this.#position += 1;
		}
		return value + this.readByte();
	}

	/** `LmgReader.GetLength16`: the same, of a word at a time. */
	readLength16(): number {
		let value = 0;
		for (;;) {
			const low = this.#data[this.#position];
			const high = this.#data[this.#position + 1];
			if (low === undefined || high === undefined) {
				throw invalidPicture("Cotton Club picture is cut short of its stream");
			}
			if (low !== 0 || high !== 0) break;
			value += 0xffff;
			this.#position += 2;
		}
		const low = this.readByte();
		const high = this.readByte();
		return value + ((high << 8) | low);
	}
}

/**
 * `LmgReader.Unpack`: a byte a step of the walk. `0xFF` says a run of as many pixels as the word behind it,
 * every one of them opaque; nothing says as many pixels that stand as they are, which are the zeros the
 * picture was made of; anything else is the fourth byte of a pixel, of as many pixels as the byte behind it
 * says and with the fourth bytes of the rest standing in the stream.
 */
export function unpackLmg(stored: Buffer, layout: LmgLayout): Buffer {
	const cursor = new LmgCursor(stored);
	const output: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let dst = 0;
	const put = (value: number): void => {
		if (dst >= output.length) {
			throw invalidPicture("Cotton Club picture writes past its own end");
		}
		output[dst] = value;
		dst += 1;
	};
	// The walk runs while the place of the stream has a byte behind it, which is the reference's own test.
	while (cursor.remaining() > 1) {
		const alpha = cursor.readByte();
		if (0xff === alpha) {
			const length = cursor.readLength16();
			for (let index = 0; index < length; index += 1) {
				put(cursor.readByte());
				put(cursor.readByte());
				put(cursor.readByte());
				put(0xff);
			}
		} else if (0 === alpha) {
			// The pixels that stand as they are leave the zeros the picture was made of, and the walk may
			// pass the end of the picture here, which the reference allows and its later writes answer for.
			dst += cursor.readLength16() * 4;
		} else {
			let length = cursor.readLength8();
			put(cursor.readByte());
			put(cursor.readByte());
			put(cursor.readByte());
			put(alpha);
			while (length > 1) {
				const next = cursor.readByte();
				put(cursor.readByte());
				put(cursor.readByte());
				put(cursor.readByte());
				put(next);
				length -= 1;
			}
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const cottonClubLmgImageDescriptor: FormatDescriptor = {
	id: "cotton-club-lmg-image",
	name: "Cotton Club encrypted image",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/CottonClub/ImageLMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cottonClubLmgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cottonClubLmgImageDescriptor,
	detection: {
		signatures: METHODS.map((method) => ({
			bytes: Buffer.from(`${MARK}${String.fromCharCode(method)}`, "latin1"),
		})),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (header.subarray(0, MARK.length).toString("latin1") !== MARK) {
				return false;
			}
			if (!METHODS.includes(header[3] ?? 0)) return false;
			return (
				header.readUInt32LE(WIDTH_FIELD) > 0 &&
				header.readUInt32LE(HEIGHT_FIELD) > 0 &&
				Number(source.size) > HEADER_SIZE
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readLmgLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Cotton Club picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(layout.dataLength),
				compressed: 2 === layout.method,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					method: layout.method,
				},
			}),
			// The stream is unscrambled and unfolded, and a bitmap header is written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: 2 === layout.method ? "runs" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readLmgLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Cotton Club picture");
		}
		if (3 === layout.method) {
			throw invalidPicture(
				"Cotton Club picture behind a JPEG is not supported",
			);
		}
		const data = Buffer.from(stored.subarray(HEADER_SIZE));
		decryptLmg(data, sourcePath);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (2 === layout.method) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, unpackLmg(data, layout)),
			]);
		}
		return Readable.from([
			writeBmp24(
				layout.width,
				layout.height,
				data.subarray(0, layout.width * layout.height * 3),
			),
		]);
	},
});
