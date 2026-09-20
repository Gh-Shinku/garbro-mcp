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

const HEAD_SIZE = 5;
const PART_HEAD_SIZE = 0xd;
const KIND_FIELD = 0;
const WIDTH_FIELD = 1;
const HEIGHT_FIELD = 3;
const KIND_LIMIT = 0x20;
const PLACES_LIMIT = 4096;
const KIND_RGB = 0x10;
const KIND_PART = 7;
const PLACES_PER_PLACE = 3;
const PALETTE_PLACES = 0x80;
const PALETTE_SIZE = PALETTE_PLACES * PLACES_PER_PLACE;
const BACKGROUND_PLACE = 0xff;
const LONG_RUN = 15;
const LONGEST_RUN = 270;
const RUN_TOO_LONG = 0xff;
const SHIFT_X: readonly number[] = [0, -1, -3, -2, -1, 0, 1, 2];
const SHIFT_Y: readonly number[] = [0, 0, -1, -1, -1, -1, -1, -1];

export interface CgLayout {
	type: number;
	width: number;
	height: number;
	left: number;
	top: number;
	right: number;
	bottom: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

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

	private readCount(code: number): { shift: number; count: number } {
		const shift = code >> 4;
		let count = code & 0xf;
		if (count === 0) {
			count = this.readByte() + LONG_RUN;
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
