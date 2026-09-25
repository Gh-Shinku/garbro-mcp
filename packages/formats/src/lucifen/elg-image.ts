// Format reference: GARbro "ArcFormats/Lucifen/ImageELG.cs", classes `ElgFormat`, `ElgMetaData` and the
// `Reader` beside them.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The picture opens with the letters `ELG` and the place of the kind of the walk of it. */
const LETTERS = [0x45, 0x4c, 0x47];
const KIND_FIELD = 3;
const FIRST_HEAD_SIZE = 8;
const SECOND_HEAD_SIZE = 13;
const KIND_PLAIN = 0;
const KIND_PLACES = 1;
const KIND_CHUNKS = 2;
const BITS_8 = 8;
const BITS_24 = 24;
const BITS_32 = 32;
const PALETTE_SIZE = 0x400;
const END = 0xff;
const MAX_SIDE = 0x8000;

const LITERAL = 0x00;
const WIDE = 0x20;
const REPEAT = 0x40;
const COPY = 0x80;
const COPY_KIND = 0x30;

export interface ElgLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	kind: number;
	headSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `ElgFormat.ReadMetaData`: the head of the picture, of the places of the file of it. */
export function readElgLayout(data: Buffer): ElgLayout | undefined {
	if (data.length < FIRST_HEAD_SIZE) return undefined;
	if (
		LETTERS[0] !== data[0] ||
		LETTERS[1] !== data[1] ||
		LETTERS[2] !== data[2]
	) {
		return undefined;
	}
	const first = data[KIND_FIELD] ?? 0;
	let kind = KIND_PLAIN;
	let bitsPerPixel = first;
	let offsetX = 0;
	let offsetY = 0;
	let headSize = FIRST_HEAD_SIZE;
	let at = KIND_FIELD + 1;
	if (KIND_PLACES === first || KIND_CHUNKS === first) {
		kind = first;
		bitsPerPixel = data[at] ?? 0;
		at += 1;
		headSize = SECOND_HEAD_SIZE;
		// A picture of the second kind stands of the places of the picture to either side and up and down
		// behind the places of the head of it, and a picture of the third kind behind the places of the
		// file of the head of the walk of its chunks.
		if (KIND_PLACES === first) {
			if (at + 4 > data.length) return undefined;
			offsetX = data.readInt16LE(at);
			offsetY = data.readInt16LE(at + 2);
			at += 4;
		}
	}
	if (
		BITS_8 !== bitsPerPixel &&
		BITS_24 !== bitsPerPixel &&
		BITS_32 !== bitsPerPixel
	) {
		return undefined;
	}
	if (at + 4 > data.length) return undefined;
	const width = data.readUInt16LE(at);
	const height = data.readUInt16LE(at + 2);
	at += 4;
	if (KIND_CHUNKS === kind) {
		if (at + 4 > data.length) return undefined;
		offsetX = data.readInt16LE(at);
		offsetY = data.readInt16LE(at + 2);
	}
	if (0 === width || 0 === height) return undefined;
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	return { width, height, offsetX, offsetY, bitsPerPixel, kind, headSize };
}

/** The heads the reference registers as its signatures: the letters `ELG` and the kind of the picture. */
export function elgSignatures(): readonly { bytes: Uint8Array }[] {
	return [BITS_8, BITS_24, BITS_32, KIND_PLACES, KIND_CHUNKS].map((kind) => ({
		bytes: Uint8Array.from([...LETTERS, kind]),
	}));
}

/** The walk of the places of a picture of the engine, of the places of the file of it. */
class ElgWalk {
	private at: number;

	constructor(
		private readonly data: Buffer,
		private readonly width: number,
		headSize: number,
	) {
		this.at = headSize;
	}

	/** The places of the file of the walk; the reference reads the places behind a short file as noughts. */
	byte(): number {
		if (this.at >= this.data.length) {
			throw invalidPicture(
				"The walk of the places of the file stands short of the file",
			);
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	word(): number {
		const value = this.data.readInt32LE(this.at);
		this.at += 4;
		return value;
	}

	put(output: Buffer, at: number, value: number): void {
		if (at >= output.length) {
			throw invalidPicture(
				"The run of the walk stands past the places of the picture",
			);
		}
		output[at] = value;
	}

	get(output: Buffer, at: number): number {
		if (at < 0 || at >= output.length) {
			throw invalidPicture(
				"The places of the walk stand of no places of the picture",
			);
		}
		return output[at] ?? 0;
	}

	/** `Reader.Unpack` counting the chunks of a picture of the third kind, of no walk of their own. */
	skipChunks(): void {
		while (0 !== this.byte()) {
			const size = this.word();
			if (size < 4) {
				throw invalidPicture(
					"The places of the file of a chunk of the picture stand short",
				);
			}
			this.at += size - 4;
		}
	}

	/** `Reader.UnpackIndexed`: the places of the file of a picture of eight places of a colour. */
	unpackIndexed(output: Buffer): void {
		let dst = 0;
		for (;;) {
			const flags = this.byte();
			if (END === flags || dst >= output.length) break;
			let count: number;
			let pos: number;
			if (LITERAL === (flags & 0xc0)) {
				count = this.count(flags, 33, 1);
				for (let place = 0; place < count; place += 1) {
					this.put(output, dst, this.byte());
					dst += 1;
				}
			} else if (REPEAT === (flags & 0xc0)) {
				count = this.count(flags, 35, 3);
				const value = this.byte();
				for (let place = 0; place < count; place += 1) {
					this.put(output, dst, value);
					dst += 1;
				}
			} else {
				if (COPY === (flags & 0xc0)) {
					if (0 === (flags & COPY_KIND)) {
						count = (flags & 0xf) + 2;
						pos = this.byte() + 2;
					} else if (0x10 === (flags & COPY_KIND)) {
						pos = ((flags & 0xf) << 8) + this.byte() + 3;
						count = this.byte() + 4;
					} else if (0x20 === (flags & COPY_KIND)) {
						pos = ((flags & 0xf) << 8) + this.byte() + 3;
						count = 3;
					} else {
						pos = ((flags & 0xf) << 8) + this.byte() + 3;
						count = 4;
					}
				} else if (0 !== (flags & WIDE)) {
					pos = (flags & 0x1f) + 2;
					count = 2;
				} else {
					pos = (flags & 0x1f) + 1;
					count = 1;
				}
				const src = dst - pos;
				if (src < 0 || dst + count > output.length) {
					throw invalidPicture(
						"The run of the walk stands of no places of the picture",
					);
				}
				copyOverlapped(output, src, dst, count);
				dst += count;
			}
		}
	}

	/** `Reader.UnpackRGBA`: the places of the file of a picture of thirty two places of a colour. */
	unpackRgba(output: Buffer): void {
		let dst = 0;
		for (;;) {
			const flags = this.byte();
			if (END === flags || dst >= output.length) break;
			if (LITERAL === (flags & 0xc0)) {
				const count = this.count(flags, 33, 1);
				for (let place = 0; place < count; place += 1) {
					dst = this.putPixel(
						output,
						dst,
						4,
						this.byte(),
						this.byte(),
						this.byte(),
						0xff,
					);
				}
			} else if (REPEAT === (flags & 0xc0)) {
				const count = this.count(flags, 34, 2);
				const blue = this.byte();
				const green = this.byte();
				const red = this.byte();
				for (let place = 0; place < count; place += 1) {
					dst = this.putPixel(output, dst, 4, blue, green, red, 0xff);
				}
			} else if (COPY === (flags & 0xc0)) {
				const run = this.copyRun(output, dst, flags, 4, 2);
				dst = run.dst;
			} else {
				dst = this.putRow(output, dst, flags, 4);
			}
		}
	}

	/** `Reader.UnpackAlpha`: the places of the alpha of a picture, of the walk of the places of it. */
	unpackAlpha(output: Buffer): void {
		let dst = 3;
		for (;;) {
			const flags = this.byte();
			if (END === flags || dst >= output.length) break;
			let count: number;
			let pos: number;
			if (LITERAL === (flags & 0xc0)) {
				count = this.count(flags, 33, 1);
				for (let place = 0; place < count; place += 1) {
					this.put(output, dst, this.byte());
					dst += 4;
				}
			} else if (REPEAT === (flags & 0xc0)) {
				count = this.count(flags, 35, 3);
				const alpha = this.byte();
				for (let place = 0; place < count; place += 1) {
					this.put(output, dst, alpha);
					dst += 4;
				}
			} else {
				if (COPY === (flags & 0xc0)) {
					if (0 === (flags & COPY_KIND)) {
						count = (flags & 0xf) + 2;
						pos = this.byte() + 2;
					} else if (0x10 === (flags & COPY_KIND)) {
						pos = ((flags & 0xf) << 8) + this.byte() + 3;
						count = this.byte() + 4;
					} else if (0x20 === (flags & COPY_KIND)) {
						pos = ((flags & 0xf) << 8) + this.byte() + 3;
						count = 3;
					} else {
						pos = ((flags & 0xf) << 8) + this.byte() + 3;
						count = 4;
					}
				} else if (0 !== (flags & WIDE)) {
					pos = (flags & 0x1f) + 2;
					count = 2;
				} else {
					pos = (flags & 0x1f) + 1;
					count = 1;
				}
				let src = dst - 4 * pos;
				for (let place = 0; place < count; place += 1) {
					this.put(output, dst, this.get(output, src));
					src += 4;
					dst += 4;
				}
			}
		}
	}

	/** `Reader.UnpackRGB`: the places of the file of a picture of twenty four places of a colour. */
	unpackRgb(output: Buffer): void {
		let dst = 0;
		for (;;) {
			const flags = this.byte();
			if (END === flags || dst >= output.length) break;
			if (LITERAL === (flags & 0xc0)) {
				const count = this.count(flags, 33, 1);
				for (let place = 0; place < count; place += 1) {
					dst = this.putPixel(
						output,
						dst,
						3,
						this.byte(),
						this.byte(),
						this.byte(),
						0,
					);
				}
			} else if (REPEAT === (flags & 0xc0)) {
				const count = this.count(flags, 34, 2);
				const blue = this.byte();
				const green = this.byte();
				const red = this.byte();
				for (let place = 0; place < count; place += 1) {
					dst = this.putPixel(output, dst, 3, blue, green, red, 0);
				}
			} else if (COPY === (flags & 0xc0)) {
				dst = this.copyRun(output, dst, flags, 3, 2).dst;
			} else {
				dst = this.putRow(output, dst, flags, 3);
			}
		}
	}

	/** The count of a run of the walk, of the places of the file of the walk of the engine. */
	private count(flags: number, wide: number, plain: number): number {
		if (0 !== (flags & WIDE)) return ((flags & 0x1f) << 8) + this.byte() + wide;
		return (flags & 0x1f) + plain;
	}

	/**
	 * The places of a colour of a place of the picture, of the places of the walk of the engine: the
	 * places of the file of the walk stand blue, green and red, then the alpha of the picture.
	 */
	private putPixel(
		output: Buffer,
		dst: number,
		places: number,
		blue: number,
		green: number,
		red: number,
		alpha: number,
	): number {
		this.put(output, dst, blue);
		this.put(output, dst + 1, green);
		this.put(output, dst + 2, red);
		if (4 === places) this.put(output, dst + 3, alpha);
		return dst + places;
	}

	/** The run of the places of the picture before the places of the file of the walk of it. */
	private copyRun(
		output: Buffer,
		dst: number,
		flags: number,
		places: number,
		wide: number,
	): { dst: number } {
		let count: number;
		let pos: number;
		if (0 === (flags & COPY_KIND)) {
			count = (flags & 0xf) + 1;
			pos = this.byte() + wide;
		} else if (0x10 === (flags & COPY_KIND)) {
			pos = ((flags & 0xf) << 8) + this.byte() + wide;
			count = this.byte() + 1;
		} else if (0x20 === (flags & COPY_KIND)) {
			const high = this.byte();
			pos = (((flags & 0xf) << 8) + high) * 0x100 + this.byte() + 4098;
			count = this.byte() + 1;
		} else {
			pos =
				0 !== (flags & 0x8)
					? ((flags & 0x7) << 8) + this.byte() + 10
					: (flags & 0x7) + 2;
			count = 1;
		}
		const src = dst - places * pos;
		if (src < 0 || dst + count * places > output.length) {
			throw invalidPicture(
				"The run of the walk stands of no places of the picture",
			);
		}
		copyOverlapped(output, src, dst, count * places);
		return { dst: dst + count * places };
	}

	/** The places of a row of the picture before the places of the file of the walk of it. */
	private putRow(
		output: Buffer,
		dst: number,
		flags: number,
		places: number,
	): number {
		let rows: number;
		let side: number;
		if (0 === (flags & COPY_KIND)) {
			const high = (flags & 0x3) << 8;
			if (0 === (flags & 0xc)) {
				rows = high + this.byte() + 16;
				side = 0;
			} else if (0x4 === (flags & 0xc)) {
				rows = high + this.byte() + 16;
				side = -1;
			} else if (0x8 === (flags & 0xc)) {
				rows = high + this.byte() + 16;
				side = 1;
			} else {
				const pos = high + this.byte() + 2058;
				const src = dst - places * pos;
				if (src < 0) {
					throw invalidPicture(
						"The run of the walk stands of no places of the picture",
					);
				}
				for (let place = 0; place < places; place += 1) {
					this.put(output, dst + place, this.get(output, src + place));
				}
				return dst + places;
			}
		} else if (0x10 === (flags & COPY_KIND)) {
			rows = (flags & 0xf) + 1;
			side = 0;
		} else if (0x20 === (flags & COPY_KIND)) {
			rows = (flags & 0xf) + 1;
			side = -1;
		} else {
			rows = (flags & 0xf) + 1;
			side = 1;
		}
		const src = dst + (side - this.width * rows) * places;
		if (src < 0) {
			throw invalidPicture(
				"The places of the row of the walk stand of no places of the picture",
			);
		}
		for (let place = 0; place < places; place += 1) {
			this.put(output, dst + place, this.get(output, src + place));
		}
		return dst + places;
	}
}

/** `ElgFormat.Read`: the picture of the walk of the engine, handed over as a bitmap. */
export function unpackElgPicture(data: Buffer, layout: ElgLayout): Buffer {
	const walk = new ElgWalk(data, layout.width, layout.headSize);
	if (KIND_CHUNKS === layout.kind) walk.skipChunks();
	const total = (layout.width * layout.height * layout.bitsPerPixel) / 8;
	if (BITS_8 === layout.bitsPerPixel) {
		const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0x00);
		walk.unpackIndexed(palette);
		const places: Buffer = Buffer.alloc(total, 0x00);
		walk.unpackIndexed(places);
		return writeBmp8Palette(layout.width, layout.height, places, palette);
	}
	const places: Buffer = Buffer.alloc(total, 0x00);
	if (BITS_24 === layout.bitsPerPixel) {
		walk.unpackRgb(places);
		return writeBmp24(layout.width, layout.height, places);
	}
	walk.unpackRgba(places);
	walk.unpackAlpha(places);
	return writeBmp32(layout.width, layout.height, places);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const elgImageDescriptor: FormatDescriptor = {
	id: "lucifen-elg-image",
	name: "Lucifen Easy Game System image",
	extensions: ["elg"],
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
			source: "ArcFormats/Lucifen/ImageELG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const elgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: elgImageDescriptor,
	detection: { signatures: elgSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(FIRST_HEAD_SIZE)) return false;
		try {
			return readElgLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readElgLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Lucifen engine");
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
					kind: layout.kind,
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
		const layout = readElgLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Lucifen engine");
		return Readable.from([unpackElgPicture(data, layout)]);
	},
});
