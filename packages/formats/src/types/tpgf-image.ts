// Format reference: GARbro "Legacy/Types/ImageTPGF.cs", classes `TpgFormat`, the `TpgfReader` beside it and
// the `BitStreamEx` of the same file (tag `TPGF`, the picture of the Types engine). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("TPGF", "latin1");
const HEAD_SIZE = 13;
const MARK_OFFSET = 4;
const WIDTH_FIELD = 8;
const HEIGHT_FIELD = 0xa;
const BITS_FIELD = 12;
const BITS_8 = 8;
const BITS_24 = 24;
const PLACE_SIZE = 4;
const CONTROL_BITS = 3;
/** The places a count of the picture may stand of, which holds the walk of the bits to the file. */
const COUNT_LIMIT = 32;
const TABLE_SIZE = 0x100;
const TABLE_PLACES = TABLE_SIZE * TABLE_SIZE;
/** The place of the head naming whether the places of the alpha of a picture stand behind the places of it. */
const ALPHA_HEAD = 1;
const LIMIT = 256 * 1024 * 1024;

export interface TpgfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `TpgFormat.ReadMetaData`: the head of the picture, of the places of it written from the higher one down. */
export function readTpgfLayout(data: Buffer): TpgfLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(MARK_OFFSET, MARK_OFFSET + MARK.length).equals(MARK)) {
		return undefined;
	}
	const bitsPerPixel = data[BITS_FIELD] ?? 0;
	if (BITS_8 !== bitsPerPixel && BITS_24 !== bitsPerPixel) return undefined;
	const width = data.readUInt16BE(WIDTH_FIELD);
	const height = data.readUInt16BE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	return { width, height, bitsPerPixel };
}

/**
 * The bits of a picture, of the highest place of every place of the file first, which is how the reader of
 * the reference takes them. The places of a picture standing of no places at all stand of nothing.
 */
class TpgfBits {
	private readonly data: Buffer;
	private position: number;
	private cached = 0;
	private cachedBits = 0;

	constructor(data: Buffer, position: number) {
		this.data = data;
		this.position = position;
	}

	/** The place of the file the places of the picture stand behind, which the reference stands of as well. */
	get streamPosition(): number {
		return this.position;
	}

	bits(count: number): number {
		if (count <= 0) return 0;
		const mask = (1 << count) - 1;
		let value = 0;
		let left = count;
		for (;;) {
			if (0 === this.cachedBits) {
				if (this.position >= this.data.length) {
					throw invalidPicture(
						"The places of the picture stand short of the file",
					);
				}
				this.cached = this.data[this.position] ?? 0;
				this.position += 1;
				this.cachedBits = 8;
			}
			if (this.cachedBits >= left) break;
			left -= this.cachedBits;
			value |= this.cached << left;
			this.cachedBits = 0;
		}
		this.cachedBits -= left;
		return ((this.cached >> this.cachedBits) | value) & mask;
	}

	bit(): number {
		return this.bits(1);
	}

	/** `BitStreamEx.ReadEncodedBits`: as many places of a colour as the run of the bits names. */
	encoded(count: number, placeBits: number): number[] {
		const places: number[] = [];
		for (let at = 0; at < count; at += 1) places.push(this.bits(placeBits));
		return places;
	}

	/** The cache of the reader stands of nothing behind the places it has read. */
	reset(): void {
		this.cachedBits = 0;
	}
}

/** `TpgfReader.ReadCount`: how many places a run of the bits stands of. */
function readCount(bits: TpgfBits): number {
	let index = 1;
	while (0 === bits.bit() && index < COUNT_LIMIT) index += 1;
	if (index >= COUNT_LIMIT) {
		throw invalidPicture("The places of the picture stand of no places at all");
	}
	return bits.bits(index) + (1 << index) - 2;
}

/** `TpgfReader.ReadScanLine`: the line of a picture, of runs of the places of the colours of it. */
function readScanLine(bits: TpgfBits, line: Buffer): void {
	let at = 0;
	while (at < line.length) {
		const control = bits.bits(CONTROL_BITS);
		const count = readCount(bits) + 1;
		if (0 !== control) {
			for (const place of bits.encoded(count, control + 1)) {
				if (at >= line.length) break;
				line[at] = place & 0xff;
				at += 1;
			}
		} else {
			// A run standing of nothing stands of the places of the picture behind it.
			for (let place = 0; place < count; place += 1) {
				if (at >= line.length) break;
				line[at] = 0x00;
				at += 1;
			}
		}
		if (count <= 0) {
			throw invalidPicture(
				"The places of the picture stand of no places at all",
			);
		}
	}
}

/** `TpgfReader.InitTransformMap`: the places of a line, of the places before them and of the place before. */
function initTransformMap(): Buffer {
	const table: Buffer = Buffer.alloc(TABLE_PLACES, 0x00);
	for (let place = 0; place < TABLE_SIZE; place += 1) {
		for (let before = 0; before < TABLE_SIZE; before += 1) {
			let value = before >= 0x80 ? (-1 - before) & 0xff : before;
			if (2 * value < place) value = place;
			else if (0 !== (place & 1)) value += (place + 1) >> 1;
			else value -= place >> 1;
			table[place * TABLE_SIZE + before] =
				before >= 0x80 ? (-1 - value) & 0xff : value & 0xff;
		}
	}
	return table;
}

const TRANSFORM_MAP = initTransformMap();

/** `TpgfReader.TransformLine`: the places of a line stand of the places before them. */
function transformLine(line: Buffer): void {
	for (let at = 1; at < line.length; at += 1) {
		line[at] =
			TRANSFORM_MAP[(line[at] ?? 0) * TABLE_SIZE + (line[at - 1] ?? 0)] ?? 0;
	}
}

/** `TpgfReader.Unpack`: the places of the picture, of the lines of the colours of it. */
export function unpackTpgfPicture(data: Buffer, layout: TpgfLayout): Buffer {
	const bits = new TpgfBits(data, HEAD_SIZE);
	const line: Buffer = Buffer.alloc(layout.width, 0x00);
	if (BITS_8 === layout.bitsPerPixel) {
		const pixels: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
		for (let row = 0; row < layout.height; row += 1) {
			readScanLine(bits, line);
			transformLine(line);
			line.copy(pixels, row * layout.width);
		}
		return writeBmp8(layout.width, layout.height, pixels);
	}
	// The places of a picture of three colours stand of three lines of the picture to a row, one place of a
	// colour of every one of them.
	const pixels: Buffer = Buffer.alloc(
		layout.width * layout.height * PLACE_SIZE,
		0x00,
	);
	for (let row = 0; row < layout.height; row += 1) {
		for (let colour = 0; colour < 3; colour += 1) {
			readScanLine(bits, line);
			transformLine(line);
			let at = row * layout.width * PLACE_SIZE + colour;
			for (let column = 0; column < layout.width; column += 1) {
				pixels[at] = line[column] ?? 0;
				at += PLACE_SIZE;
			}
		}
	}
	// A picture whose places stand of the places of an alpha behind them stands of four places to a pixel:
	// the head of the alpha stands behind the places of the colours of the picture, where the reader has
	// reached, and the places of the alpha stand behind that head.
	const head = bits.streamPosition;
	if (head < data.length && ALPHA_HEAD === data[head]) {
		const fields = data.subarray(head + 1, head + 1 + HEAD_SIZE);
		if (
			fields.length === HEAD_SIZE &&
			fields.subarray(MARK_OFFSET, MARK_OFFSET + MARK.length).equals(MARK) &&
			fields.readUInt16BE(WIDTH_FIELD) === layout.width &&
			fields.readUInt16BE(HEIGHT_FIELD) === layout.height &&
			fields[BITS_FIELD] === BITS_8
		) {
			const alpha = new TpgfBits(data, head + 1 + HEAD_SIZE);
			for (let row = 0; row < layout.height; row += 1) {
				readScanLine(alpha, line);
				transformLine(line);
				let at = row * layout.width * PLACE_SIZE + 3;
				for (let column = 0; column < layout.width; column += 1) {
					pixels[at] = ~(line[column] ?? 0) & 0xff;
					at += PLACE_SIZE;
				}
			}
		}
	}
	return writeBmp32(layout.width, layout.height, pixels);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const tpgfImageDescriptor: FormatDescriptor = {
	id: "types-tpgf-image",
	name: "Types image",
	extensions: ["tpg"],
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
			source: "Legacy/Types/ImageTPGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tpgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tpgfImageDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readTpgfLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readTpgfLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Types engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readTpgfLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Types engine");
		return Readable.from([unpackTpgfPicture(data, layout)]);
	},
});
