// Format reference: GARbro "ArcFormats/AnimeGameSystem/ImageAinos.cs", classes `CgFormat`, `CgMetaData` and
// `CgFormat.Reader` (a picture of the Anime Game System engine that stands as a part of a picture rather than
// as the whole of one: the words of the head of it name the place of the picture that stands and the places of
// the picture of the part that stand, and the places of the picture stand as runs of the places beside them or
// as places of the picture of their own, the places of the picture of the picture standing green where the
// places of a part stand for no place of the picture). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The words of the head of a picture of this kind stand in the first places of the file, and the words of the
 * part of the picture stand behind them. */
const HEAD_SIZE = 5;
const PART_HEAD_SIZE = 0xd;
/** The places of the head of a picture of this kind stand as the places of the picture of the kind of the
 * picture, which stand as one place, and as the places of the picture of the width and of the height of the
 * picture, which stand as the places of a picture of two places each. */
const KIND_FIELD = 0;
const WIDTH_FIELD = 1;
const HEIGHT_FIELD = 3;
/** The kind of a picture of this kind stands beneath the places of a picture of the kind of the places of a
 * picture of the engine. */
const KIND_LIMIT = 0x20;
const PLACES_LIMIT = 4096;
/** The places of a picture of the kind the places of a picture stand of their own. */
const KIND_RGB = 0x10;
const KIND_PART = 7;
const PLACES_PER_PLACE = 3;
/** The places of a picture of a kind of the places of a picture of its own stand as the places of a palette of
 * a picture of the places of a picture of the engine. */
const PALETTE_PLACES = 0x80;
const PALETTE_SIZE = PALETTE_PLACES * PLACES_PER_PLACE;
/** The places of a picture a picture of this kind stands for no place of stand as the places of the
 * picture of the background of it, which stand green: the places of the green of a place of a picture. */
const BACKGROUND_PLACE = 0xff;
/** Every place of a picture of this kind stands for the places of a picture of the three places of a place of
 * the picture. */
const LONG_RUN = 15;
const LONGEST_RUN = 270;
const RUN_TOO_LONG = 0xff;
/** Where the places of a picture that stand beside the places of the picture stand, of the places of the walk
 * of the places of the picture of the engine. */
const SHIFT_X: readonly number[] = [0, -1, -3, -2, -1, 0, 1, 2];
const SHIFT_Y: readonly number[] = [0, 0, -1, -1, -1, -1, -1, -1];

export interface CgLayout {
	/** The kind of the picture, which names the kind of the walk of the places of it. */
	type: number;
	width: number;
	height: number;
	/** The places of the picture of the part of the picture that stands. */
	left: number;
	top: number;
	right: number;
	bottom: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `CgFormat.ReadMetaData`: the place of the head of a picture of this kind names the kind of it and how wide
 * and how tall it stands, and, where the kind names a part of a picture, the places of the picture of the part
 * of the picture that stands within it.
 */
export function readCgLayout(
	data: Buffer,
	fileLength = data.length,
): CgLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const type = data[KIND_FIELD] ?? 0;
	if (type >= KIND_LIMIT) return undefined;
	const width = data.readInt16LE(WIDTH_FIELD);
	const height = data.readInt16LE(HEIGHT_FIELD);
	if (
		width <= 0 ||
		height <= 0 ||
		width > PLACES_LIMIT ||
		height > PLACES_LIMIT
	)
		return undefined;
	let left = 0;
	let top = 0;
	let right = 0;
	let bottom = 0;
	if ((type & KIND_PART) !== 0) {
		if (fileLength < PART_HEAD_SIZE || data.length < PART_HEAD_SIZE)
			return undefined;
		left = data.readInt16LE(HEAD_SIZE);
		top = data.readInt16LE(HEAD_SIZE + 2);
		right = data.readInt16LE(HEAD_SIZE + 4);
		bottom = data.readInt16LE(HEAD_SIZE + 6);
		if (
			left > right ||
			top > bottom ||
			right > width ||
			bottom > height ||
			left < 0 ||
			top < 0
		)
			return undefined;
	}
	return {
		type,
		width,
		height,
		left,
		top,
		right: right === 0 ? width : right,
		bottom: bottom === 0 ? height : bottom,
		dataOffset: (type & KIND_PART) !== 0 ? PART_HEAD_SIZE : HEAD_SIZE,
	};
}

/** `CgFormat.Reader`: the places of the picture of the part of the picture that stands. */
class CgReader {
	private position: number;
	private readonly out: Buffer;
	private readonly table: Int32Array;

	constructor(
		private readonly data: Buffer,
		private readonly layout: CgLayout,
	) {
		this.position = layout.dataOffset;
		this.out = Buffer.alloc(layout.width * layout.height * PLACES_PER_PLACE);
		// The reference stands the places of the picture behind the places of a picture of the engine green,
		// so the places of the picture a part of the picture stands for no place of stand green as well.
		for (let at = 1; at < this.out.length; at += PLACES_PER_PLACE)
			this.out[at] = BACKGROUND_PLACE;
		this.table = new Int32Array(8);
		for (let i = 0; i < 8; i += 1) {
			this.table[i] =
				PLACES_PER_PLACE *
				((SHIFT_X[i] ?? 0) + (SHIFT_Y[i] ?? 0) * layout.width);
		}
	}

	private readByte(): number {
		if (this.position >= this.data.length)
			throw invalidPicture(
				"The places of a picture stand short of the places they stand for",
			);
		const byte = this.data[this.position] ?? 0;
		this.position += 1;
		return byte;
	}

	/** `Binary.CopyOverlapped`: a walk of the places of a picture that stands within the places it stands for. */
	private copy(src: number, dst: number, count: number): void {
		if (
			src < 0 ||
			dst + count > this.out.length ||
			src + count > this.out.length
		)
			throw invalidPicture(
				"A place of the walk of a picture stands past the picture",
			);
		for (let at = 0; at < count; at += 1)
			this.out[dst + at] = this.out[src + at] ?? 0;
	}

	/** The count of the places of a walk of a picture, which stands as the places of the count behind the
	 * places of the walk where the places of the walk stand for no place of the picture of their own. */
	private readCount(code: number): { shift: number; count: number } {
		const shift = code >> 4;
		let count = code & 0xf;
		if (count === 0) {
			count = this.readByte() + LONG_RUN;
			// The longest counts of the places of a walk stand as the places of the picture of the walk of the
			// count of its own, standing as the whole places of a picture of the walk of the count.
			if (count === LONGEST_RUN) {
				let byte: number;
				do {
					byte = this.readByte();
					count += byte;
				} while (byte === RUN_TOO_LONG);
			}
		}
		return { shift, count };
	}

	/** `CgFormat.Reader.UnpackIndexed`: the places of a picture of a kind of the places of a picture of a
	 * palette of its own. */
	unpackIndexed(): void {
		const palette = this.data.subarray(
			this.position,
			this.position + PALETTE_SIZE,
		);
		if (palette.length < PALETTE_SIZE)
			throw invalidPicture(
				"The places of the palette of a picture stand short",
			);
		this.position += PALETTE_SIZE;
		this.walk((dst, code) => {
			const place = PLACES_PER_PLACE * (code & 0x7f);
			this.out[dst] = palette[place] ?? 0;
			this.out[dst + 1] = palette[place + 1] ?? 0;
			this.out[dst + 2] = palette[place + 2] ?? 0;
		});
	}

	/** `CgFormat.Reader.UnpackRGB`: the places of a picture of a kind of the places of a picture of its own,
	 * which stand as the places of the picture of the places behind them where the places of the walk name
	 * them. */
	unpackRGB(): void {
		this.walk((dst, code) => {
			if ((code & 0x40) !== 0) {
				this.out[dst] =
					((this.out[dst - 3] ?? 0) + ((code >> 3) & 6) - 2) & 0xff;
				this.out[dst + 1] =
					((this.out[dst - 2] ?? 0) + ((code >> 1) & 6) - 2) & 0xff;
				this.out[dst + 2] =
					((this.out[dst - 1] ?? 0) + ((code & 3) + 127) * 2) & 0xff;
				return;
			}
			const second = this.readByte();
			this.out[dst] = (((code << 1) + (second & 1)) << 1) & 0xff;
			this.out[dst + 1] = second & 0xfe;
			this.out[dst + 2] = this.readByte();
		});
	}

	/** The walk of the places of the part of the picture that stands, the places of the picture of it standing
	 * as the places of the picture of the kind of the walk of the picture. */
	private walk(placeOfPicture: (dst: number, code: number) => void): void {
		const { width, top, bottom, left, right } = this.layout;
		const row = width * PLACES_PER_PLACE;
		let from = row * top + PLACES_PER_PLACE * left;
		let to = row * top + PLACES_PER_PLACE * right;
		for (let y = top; y < bottom; y += 1) {
			let dst = from;
			while (dst !== to) {
				const code = this.readByte();
				if ((code & 0x80) !== 0) {
					placeOfPicture(dst, code);
					dst += PLACES_PER_PLACE;
					continue;
				}
				const { shift, count } = this.readCount(code);
				// A walk of the places of the picture of no places stands for the places of the picture of the
				// walk of the kind of the count of the walk of the places of the picture of the picture itself.
				if (shift !== 0)
					this.copy(
						dst + (this.table[shift] ?? 0),
						dst,
						count * PLACES_PER_PLACE,
					);
				dst += PLACES_PER_PLACE * count;
				if (dst > to)
					throw invalidPicture(
						"A walk of the places of a picture stands past the places of the part of the picture",
					);
			}
			from += row;
			to += row;
		}
	}

	/** `CgFormat.Reader.Unpack`. */
	unpack(): Buffer {
		if ((this.layout.type & KIND_RGB) !== 0) this.unpackRGB();
		else this.unpackIndexed();
		return this.out;
	}
}

/** `CgFormat.Read`: the places of the picture of the part of the picture that stands. */
export function unpackCgPicture(data: Buffer, layout: CgLayout): Buffer {
	return new CgReader(data, layout).unpack();
}

export const animeGameSystemCgImageDescriptor: FormatDescriptor = {
	id: "anime-game-system-cg",
	name: "Anime Game System image format",
	extensions: ["cg"],
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
			source: "ArcFormats/AnimeGameSystem/ImageAinos.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const animeGameSystemCgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: animeGameSystemCgImageDescriptor,
	// A picture of this kind names itself with no words of its own: the reference stands the kind of the
	// picture in the first place of the file and stands the pictures of the kinds it names no places of the
	// head for away. The reference stands a picture of this kind behind the pictures of the kinds of the
	// places of a picture of the engine, so this port stands it there as well.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readCgLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readCgLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(layout.dataOffset),
					size: source.size - BigInt(layout.dataOffset),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: 24,
						pictureType: layout.type,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
				pictureType: layout.type,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readCgLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		// The reference stands the places of a picture of this kind beside the places of a picture of its own,
		// which stand the places of a picture of the three places of a place of the picture.
		return Readable.from([
			writeBmp24(
				layout.width,
				layout.height,
				unpackCgPicture(stored, layout),
				false,
			),
		]);
	},
});
