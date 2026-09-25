// Format reference: GARbro "ArcFormats/Macintosh/ImagePICT.cs", classes `PictFormat`, `PictReader`,
// `Pixmap` and the `BinaryStreamExtension` beside them.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	writeBmp8,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head of a picture of the engine stands at 0x200, or at four bytes of the mark `PICT`. */
const HEAD_POSITION = 0x200;
const MARK_POSITION = 4;
const MARK = 0x54434950;
const HEAD_SIZE = 0x10;
/** The place behind the head: the word of the mark of the head and the word of the kind of it. */
const DATA_POSITION = 0x0e;
const VERSION_OPCODE = 0x11;
const VERSION = 0x2ff;
const MAX_SIDE = 0x4000;

/** The places of a pixel of the picture a walk of the engine hands over, to a place of them. */
const PLACES_32 = 4;
const PLACES_24 = 3;
const PLANE_PLACES_16 = 2;

const OP_NOP = 0x0000;
const OP_CLIP = 0x0001;
const OP_DEF_HILITE = 0x001e;
const OP_BITS_0 = 0x0090;
const OP_BITS_1 = 0x0091;
const OP_BITS_2 = 0x0098;
const OP_BITS_3 = 0x0099;
const OP_BITS_4 = 0x009a;
const OP_BITS_5 = 0x009b;
const OP_LONG_COMMENT = 0x00a1;
const OP_HEADER = 0x0c00;
const OP_EOF = 0x00ff;
const OP_EOF_2 = 0xffff;
/** The place of the word of a picture the colours of the places of the file stand of. */
const STRIDE_COLOURS = 0x8000;
const STRIDE_RAW = 8;
const SCANLINE_WIDE = 200;
const WHITE = 0xff;

export interface PictLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `PictFormat.ReadMetaData`: the head of the picture, of the marks of the engine. */
export function readPictLayout(data: Buffer): PictLayout | undefined {
	if (data.length < 4) return undefined;
	// The mark stands of the four places of the file `PICT`, of the lowest place of them first.
	const head = data.readUInt32LE(0) === MARK ? MARK_POSITION : HEAD_POSITION;
	if (data.length < head + HEAD_SIZE) return undefined;
	const top = data.readInt16BE(head + 2);
	const left = data.readInt16BE(head + 4);
	const bottom = data.readInt16BE(head + 6);
	const right = data.readInt16BE(head + 8);
	if (VERSION_OPCODE !== data.readUInt16BE(head + 0x0a)) return undefined;
	if (VERSION !== data.readUInt16BE(head + 0x0c)) return undefined;
	const width = right - left;
	const height = bottom - top;
	if (width <= 0 || height <= 0) return undefined;
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	return {
		width,
		height,
		offsetX: left,
		offsetY: top,
		dataOffset: head + DATA_POSITION,
	};
}

/** `PictFormat`'s own signatures: the mark `PICT` and the head of no mark at all. */
export function pictSignatures(): readonly { bytes: Uint8Array }[] {
	return [{ bytes: Buffer.from("PICT", "latin1") }];
}

/** `Pixmap`: the places of the head of a picture of the places of a colour of its own. */
interface PictPixmap {
	bitsPerPixel: number;
	compCount: number;
}

/** The kinds of picture a walk of the engine hands over. */
type PictKind = "bgra32" | "bgr32" | "bgr24" | "bgr555" | "indexed8" | "gray8";

interface PictResult {
	kind: PictKind;
	width: number;
	height: number;
	/** The places of the picture, of the plan of the walk of the engine. */
	pixels: Buffer;
	/** The places of the colours of the picture, where it stands of them. */
	palette: Buffer | undefined;
}

/** `PictReader`: the walk of the places of a picture of the engine, of the words of the file of it. */
class PictWalk {
	private at: number;
	private width: number;
	private height: number;
	private hasAlpha = false;
	private kind: PictKind = "gray8";
	private places: Buffer | undefined;
	private palette: Buffer | undefined;
	private readonly data: Buffer;

	constructor(data: Buffer, layout: PictLayout) {
		this.data = data;
		this.at = layout.dataOffset;
		this.width = layout.width;
		this.height = layout.height;
	}

	/** `PictReader.Unpack`: the walk of the words of the picture, of the place of the head of it behind. */
	unpack(): PictResult {
		let pixmap: PictPixmap | undefined;
		while (this.at < this.data.length) {
			if (0 !== (this.at & 1)) this.at += 1;
			const code = this.word();
			if (OP_EOF === code || OP_EOF_2 === code) break;
			switch (code) {
				case OP_NOP:
					continue;
				case OP_CLIP: {
					const length = this.word();
					if (length < 2) {
						throw invalidPicture("The clip of the picture stands of no places");
					}
					this.skip(length - 2);
					break;
				}
				case OP_DEF_HILITE:
					break;
				case OP_BITS_0:
				case OP_BITS_1:
				case OP_BITS_2:
				case OP_BITS_3:
				case OP_BITS_4:
				case OP_BITS_5: {
					const places = this.bitmap(code);
					pixmap = places.pixmap;
					this.decodeRleBitmap(places.stride, pixmap);
					break;
				}
				case OP_LONG_COMMENT: {
					this.word();
					const length = this.word();
					this.skip(length);
					break;
				}
				case OP_HEADER:
					this.skip(0x18);
					break;
				default:
					throw new GarbroError(
						"UNSUPPORTED_FEATURE",
						`The walk of the picture names no word of the engine: 0x${code.toString(16)}`,
					);
			}
		}
		if (!this.places) {
			throw invalidPicture("The picture stands of no places of its own");
		}
		return {
			kind: this.kind,
			width: this.width,
			height: this.height,
			pixels: this.places,
			palette: this.palette,
		};
	}

	/** `PictReader`'s own walk of a word of the places of a picture: the rectangles and the colours of it. */
	private bitmap(code: number): {
		stride: number;
		pixmap: PictPixmap | undefined;
	} {
		const ofPixmap = OP_BITS_4 === code || OP_BITS_5 === code;
		let stride = 0;
		let pixmap: PictPixmap | undefined;
		if (ofPixmap) this.skip(6);
		else stride = this.word();
		const offsetY = this.wordSigned();
		const offsetX = this.wordSigned();
		this.height = this.wordSigned() - offsetY;
		this.width = this.wordSigned() - offsetX;
		if (ofPixmap || 0 !== (stride & STRIDE_COLOURS)) {
			pixmap = this.readPixmap();
			this.hasAlpha = PLACES_32 === pixmap.compCount;
		}
		if (!ofPixmap) {
			let colours = 2;
			let flags = 0;
			if (0 !== (stride & STRIDE_COLOURS)) {
				this.skip(4);
				flags = this.word();
				colours = this.word() + 1;
			}
			if (undefined === this.palette) {
				this.palette = Buffer.alloc(Math.min(colours, 0x100) * 4, 0x00);
			}
			if (0 !== (stride & STRIDE_COLOURS)) {
				for (let entry = 0; entry < colours; entry += 1) {
					// The word of the place of the colour stands in the file of the picture in either case, of
					// the places of the file of it of no kind of its own.
					const named = this.word();
					const place2 = 0 !== (flags & 0x8000) ? entry : named % colours;
					const red = Math.trunc(this.word() / 0x101);
					const green = Math.trunc(this.word() / 0x101);
					const blue = Math.trunc(this.word() / 0x101);
					if (place2 >= this.palette.length / 4) {
						throw invalidPicture(
							"The colours of the picture stand past the places of its own",
						);
					}
					this.palette[place2 * 4] = blue;
					this.palette[place2 * 4 + 1] = green;
					this.palette[place2 * 4 + 2] = red;
				}
			} else {
				// A picture of no colours of its own takes the colours of the picture before it, of the
				// places of the file of it taken the other way around.
				for (let entry = 0; entry < colours; entry += 1) {
					if (entry >= this.palette.length / 4) {
						throw invalidPicture(
							"The colours of the picture stand past the places of its own",
						);
					}
					for (let place2 = 0; place2 < 3; place2 += 1) {
						this.palette[entry * 4 + place2] =
							WHITE - (this.palette[entry * 4 + place2] ?? 0);
					}
				}
			}
		}
		this.skip(8 + 8 + 2);
		if (OP_BITS_1 === code || OP_BITS_3 === code || OP_BITS_5 === code) {
			const length = this.word();
			if (length > 2) this.skip(length - 2);
		}
		this.setFormat(pixmap);
		return { stride, pixmap };
	}

	/** `Pixmap.Deserialize`: the places of the head of a picture of the places of a colour of its own. */
	private readPixmap(): PictPixmap {
		this.wordSigned(); // the kind of the places of the file
		this.wordSigned(); // the kind of the walk of them
		this.long(); // the places of the walk
		this.long(); // the places of a place of the picture to either side
		this.long(); // the places of a place of the picture up and down
		this.wordSigned(); // the kind of a place of a colour
		const bitsPerPixel = this.wordSigned();
		const compCount = this.wordSigned();
		const compSize = this.wordSigned();
		this.long(); // the places of the places of a colour of one
		this.long(); // the places of the table of the colours of the picture
		this.skip(4);
		if (bitsPerPixel <= 0 || bitsPerPixel > 32) {
			throw invalidPicture(
				"The picture stands of places of a colour of no kind of its own",
			);
		}
		if (compCount <= 0 || compCount > 4) {
			throw invalidPicture(
				"The picture stands of no places of a colour of its own",
			);
		}
		if (compSize <= 0) {
			throw invalidPicture(
				"The picture stands of no places of a colour of a place of it",
			);
		}
		return { bitsPerPixel, compCount };
	}

	/** `PictReader.SetFormat`: the kind of the places of the file the picture stands of. */
	private setFormat(pixmap: PictPixmap | undefined): void {
		const bitsPerPixel = undefined === pixmap ? 8 : pixmap.bitsPerPixel;
		if (32 === bitsPerPixel) {
			this.kind = 4 === pixmap?.compCount ? "bgra32" : "bgr32";
		} else if (24 === bitsPerPixel) this.kind = "bgr24";
		else if (16 === bitsPerPixel) this.kind = "bgr555";
		else if (8 === bitsPerPixel) {
			this.kind = undefined === this.palette ? "gray8" : "indexed8";
		} else {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`The picture stands of places of a colour of no walk of the engine: ${bitsPerPixel}`,
			);
		}
	}

	/**
	 * `PictReader.DecodeRleBitmap`: the places of the file of a picture, of the walks of the places of a
	 * row of it. Where the places of a row stand of no walk, the places of the file stand behind one
	 * another, a count of them to a row.
	 */
	private decodeRleBitmap(
		stride: number,
		pixmap: PictPixmap | undefined,
	): void {
		// The walk of a picture of the places of the file of its own stands of one place of a colour to a
		// place of the picture, of which the walk of the places of the file of the engine stands of no
		// places of eight of them: the reference names it of one place of a colour and then turns it away.
		const bitsPerPixel = undefined === pixmap ? 1 : pixmap.bitsPerPixel;
		if (bitsPerPixel < 8) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`The picture stands of places of a colour of no walk of the engine: ${bitsPerPixel}`,
			);
		}
		let rowSize = stride;
		if (bitsPerPixel <= 8) rowSize &= 0x7fff;
		const width = this.width;
		let places = 1;
		let rowPlaces = width;
		if (16 === bitsPerPixel) {
			places = PLANE_PLACES_16;
			rowPlaces = width * PLANE_PLACES_16;
		} else if (32 === bitsPerPixel) {
			rowPlaces = width * (this.hasAlpha ? PLACES_32 : PLACES_24);
		}
		if (0 === rowSize) rowSize = rowPlaces;
		const total = width * PLACES_32 * this.height;
		if (undefined === this.places || this.places.length < total) {
			this.places = Buffer.alloc(total, 0x00);
		}
		const places2 = this.places;
		const scanline = Buffer.alloc(width * PLACES_32 * 2, 0x00);
		if (rowSize < STRIDE_RAW) {
			let dst = 0;
			const step = rowPlaces * Math.trunc(bitsPerPixel / 8);
			for (let row = 0; row < this.height; row += 1) {
				for (let at = 0; at < rowSize; at += 1) {
					places2[dst + at] = this.byte();
				}
				dst += step;
			}
			return;
		}
		for (let row = 0; row < this.height; row += 1) {
			let dst = row * rowPlaces;
			const length = rowSize > SCANLINE_WIDE ? this.word() : this.byte();
			if (0 === length || length >= scanline.length) {
				throw invalidPicture(
					"The places of a row of the picture stand of no walk of it",
				);
			}
			for (let at = 0; at < length; at += 1) scanline[at] = this.byte();
			let at2 = 0;
			while (at2 < length) {
				const control = scanline[at2] ?? 0;
				if (0 === (control & 0x80)) {
					const count = (control + 1) * places;
					const from = at2 + 1;
					if (dst + count <= total) {
						scanline.copy(places2, dst, from, from + count);
					}
					dst += count;
					at2 += count + 1;
				} else {
					let count = (control ^ 0xff) + 2;
					const from = at2 + 1;
					while (count > 0) {
						if (dst + places <= total) {
							scanline.copy(places2, dst, from, from + places);
						}
						dst += places;
						count -= 1;
					}
					at2 += places + 1;
				}
			}
		}
	}

	private byte(): number {
		if (this.at >= this.data.length) {
			throw invalidPicture(
				"The walk of the picture stands past the file of it",
			);
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	private word(): number {
		const value = this.data.readUInt16BE(this.at);
		this.at += 2;
		return value;
	}

	private wordSigned(): number {
		const value = this.data.readInt16BE(this.at);
		this.at += 2;
		return value;
	}

	private long(): number {
		const value = this.data.readInt32BE(this.at);
		this.at += 4;
		return value;
	}

	private skip(amount: number): void {
		if (amount < 0)
			throw invalidPicture("The walk of the picture stands of no places");
		this.at += amount;
	}
}

/** `PictReader.RepackPixels`: the places of a picture, of the places of a colour of it one behind another. */
function repackPixels(result: PictResult): Buffer {
	const { width, height, pixels } = result;
	if (width * PLACES_32 * height > pixels.length) {
		throw invalidPicture(
			"The places of the picture stand short of the file of it",
		);
	}
	if ("indexed8" === result.kind || "gray8" === result.kind) {
		return pixels.subarray(0, width * height);
	}
	if ("bgr555" === result.kind) {
		// The places of the file of the picture stand of the places of the file the other way around from
		// the places of a place of the walk of it.
		const places: Buffer = Buffer.alloc(width * height * PLANE_PLACES_16, 0x00);
		for (let at = 0; at + 1 < width * height * PLANE_PLACES_16; at += 2) {
			places[at] = pixels[at + 1] ?? 0;
			places[at + 1] = pixels[at] ?? 0;
		}
		return places;
	}
	const planePlaces = result.kind === "bgr24" ? PLACES_24 : PLACES_32;
	const planes = "bgra32" === result.kind ? PLACES_32 : PLACES_24;
	const places: Buffer = Buffer.alloc(width * height * planePlaces, 0x00);
	let src = 0;
	for (let row = 0; row < height; row += 1) {
		let dst = row * width * planePlaces;
		for (let place = 0; place < width; place += 1) {
			if ("bgra32" === result.kind) {
				places[dst + 3] = pixels[src] ?? 0;
				places[dst + 2] = pixels[src + width] ?? 0;
				places[dst + 1] = pixels[src + width * 2] ?? 0;
				places[dst] = pixels[src + width * 3] ?? 0;
			} else {
				places[dst + 2] = pixels[src] ?? 0;
				places[dst + 1] = pixels[src + width] ?? 0;
				places[dst] = pixels[src + width * 2] ?? 0;
			}
			src += 1;
			dst += planePlaces;
		}
		src += (planes - 1) * width;
	}
	return places;
}

/** `PictFormat.Read`: the picture of the walk of the engine, handed over as a bitmap. */
export function unpackPictPicture(data: Buffer, layout: PictLayout): Buffer {
	const result = new PictWalk(data, layout).unpack();
	const places = repackPixels(result);
	if ("indexed8" === result.kind) {
		return writeBmp8Palette(
			result.width,
			result.height,
			places,
			result.palette ?? Buffer.alloc(0),
		);
	}
	if ("gray8" === result.kind) {
		return writeBmp8(result.width, result.height, places);
	}
	if ("bgr555" === result.kind) {
		return writeBmp16(result.width, result.height, places);
	}
	if ("bgr24" === result.kind) {
		return writeBmp24(result.width, result.height, places);
	}
	return writeBmp32(result.width, result.height, places);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const pictImageDescriptor: FormatDescriptor = {
	id: "macintosh-pict-image",
	name: "Apple Macintosh image",
	extensions: ["pct", "pict", "pic"],
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
			source: "ArcFormats/Macintosh/ImagePICT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pictImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pictImageDescriptor,
	detection: { signatures: pictSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readPictLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readPictLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Macintosh engine");
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
					// The head of the picture stands of four places of a colour to a place of the file; the
					// walk of it stands of the places of a colour of the picture itself.
					bitsPerPixel: 32,
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
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readPictLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Macintosh engine");
		return Readable.from([unpackPictPicture(data, layout)]);
	},
});
