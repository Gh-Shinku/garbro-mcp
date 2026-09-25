// Port of GARbro "Legacy/Izumi/ImageMAI2.cs" (tag "MAI/IZUMI", classes Mai2Format, Mai2Reader), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A MAI2 picture stands of four planes of
// places, every plane standing of a walk of its own, and the places of the picture stand of the planes.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { copyOverlapped } from "../shared/copy.js";
import { paletteTriples, writeBmp4 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("MAI2", "latin1");
const HEAD_SIZE = 0x14;
const COLORS = 16;
/** The place of the picture of the head: the places of it stand of fifty columns. */
const ROW_LENGTH = 0x50;

export interface Mai2Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	flags: number;
	hasPalette: boolean;
	planeSizes: number[];
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `Mai2Format.ReadMetaData`. */
export function readMai2Layout(data: Buffer): Mai2Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const at = data.readUInt16LE(4);
	const width = data.readUInt16LE(6) << 3;
	const height = data.readUInt16LE(8);
	if (0 === width || 0 === height) return undefined;
	const flags = data[10] ?? 0;
	return {
		width,
		height,
		offsetX: at % ROW_LENGTH,
		offsetY: Math.trunc(at / ROW_LENGTH),
		flags,
		hasPalette: 0 !== (flags & 0x80),
		planeSizes: [
			data.readUInt16LE(0x0c),
			data.readUInt16LE(0x0e),
			data.readUInt16LE(0x10),
			data.readUInt16LE(0x12),
		],
	};
}

/** `Binary.RotByteR`: the places of a byte stood of the places of it behind. */
function rotateRight(value: number, count: number): number {
	const places = count & 7;
	return ((value >> places) | (value << (8 - places))) & 0xff;
}

/** `Mai2Reader`: the planes of the picture and the walk of every one of them. */
class Mai2Reader {
	private at: number;
	private readonly planes: Buffer[];
	private readonly planeSize: number;

	constructor(
		private readonly data: Buffer,
		private readonly layout: Mai2Layout,
	) {
		this.at = HEAD_SIZE;
		const stride = layout.width >> 3;
		this.planeSize = stride * layout.height;
		this.planes = [
			Buffer.alloc(this.planeSize, 0x00),
			Buffer.alloc(this.planeSize, 0x00),
			Buffer.alloc(this.planeSize, 0x00),
			Buffer.alloc(this.planeSize, 0x00),
		];
	}

	private byte(): number {
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	private place(plane: Buffer, at: number, value: number): void {
		if (at < plane.length) plane[at] = value;
	}

	/** `Mai2Reader.ReadPalette`: sixteen colours of three places, of the highest place of every byte first. */
	private palette(): Buffer {
		const bits = new MsbBitReader(this.data, HEAD_SIZE);
		const palette: Buffer = Buffer.alloc(COLORS * 4, 0x00);
		for (let color = 0; color < COLORS; color += 1) {
			const red = (bits.readBits(4) & 0xff) * 0x11;
			const green = (bits.readBits(4) & 0xff) * 0x11;
			const blue = (bits.readBits(4) & 0xff) * 0x11;
			palette[color * 4] = blue & 0xff;
			palette[color * 4 + 1] = green & 0xff;
			palette[color * 4 + 2] = red & 0xff;
		}
		return palette;
	}

	/** `Mai2Reader.UnpackPlane`: the places of one plane of the picture, of the walk of it. */
	private unpackPlane(plane: Buffer): void {
		const stride = this.layout.width >> 3;
		const height = this.layout.height;
		for (let column = 0; column < stride; column += 1) {
			const row = column * height;
			let destination = row;
			let remaining = height;
			while (remaining > 0) {
				let count = 1;
				const control = this.byte();
				if (control < 0x90) {
					count = control & 0x1f;
					if (0 === count) count = this.byte();
					const kind = control >> 5;
					for (let step = 0; step < count; step += 1) {
						if (2 === kind)
							this.place(
								plane,
								destination,
								this.planes[0]?.[destination] ?? 0,
							);
						else if (3 === kind)
							this.place(
								plane,
								destination,
								this.planes[1]?.[destination] ?? 0,
							);
						else if (4 === kind)
							this.place(
								plane,
								destination,
								this.planes[2]?.[destination] ?? 0,
							);
						else this.place(plane, destination, 1 === kind ? 0xff : 0x00);
						destination += 1;
					}
				} else if (control < 0xf0) {
					count = control & 0xf;
					if (0 === count) count = this.byte();
					let offset = 0;
					switch (control >> 4) {
						case 0x9:
							offset = 0x10;
							break;
						case 0xa:
							offset = 8;
							break;
						case 0xb:
							offset = 4;
							break;
						case 0xc:
							offset = 2;
							break;
						case 0xd:
							offset = height << 1;
							break;
						default:
							offset = height;
							break;
					}
					copyOverlapped(plane, destination - offset, destination, count);
					destination += count;
				} else if (control < 0xf9) {
					count = control & 0xf;
					if (0 === count) count = this.byte();
					for (let step = 0; step < count; step += 1) {
						this.place(plane, destination, this.byte());
						destination += 1;
					}
				} else {
					count = this.byte();
					switch (control) {
						case 0xf9:
							destination += count;
							break;
						case 0xfa: {
							const value = this.byte();
							for (let step = 0; step < count; step += 1) {
								this.place(plane, destination, value);
								destination += 1;
							}
							break;
						}
						case 0xfb: {
							let source = 0;
							if (0 !== (count & 0x80)) {
								count &= 0x7f;
								source = 1;
							}
							if (0 === count) count = this.byte();
							for (let step = 0; step < count; step += 1) {
								this.place(
									plane,
									destination,
									~(this.planes[source]?.[destination] ?? 0) & 0xff,
								);
								destination += 1;
							}
							break;
						}
						case 0xfc:
							if (0 !== (count & 0x80)) {
								count &= 0x7f;
								if (0 === count) count = this.byte();
								const first = this.byte();
								const low = ((first << 4) | (first & 0x0f)) & 0xff;
								const high = ((first >> 4) | (first & 0xf0)) & 0xff;
								for (let step = 0; step < count; step += 1) {
									this.place(plane, destination, low);
									this.place(plane, destination + 1, high);
									destination += 2;
								}
								count <<= 1;
							} else {
								if (0 === count) count = this.byte();
								for (let step = 0; step < count; step += 1) {
									this.place(
										plane,
										destination,
										~(this.planes[2]?.[destination] ?? 0) & 0xff,
									);
									destination += 1;
								}
							}
							break;
						case 0xfd:
							if (0 !== (count & 0x80)) {
								const kind = count;
								count = kind & 0x3f;
								if (0 === count) count = this.byte();
								const first = this.byte();
								const bl = ((first & 0xf0) | (first >> 4)) & 0xff;
								const bh = ((first & 0x0f) | (first << 4)) & 0xff;
								let al: number;
								let ah: number;
								if (kind < 0xc0) {
									al = rotateRight(bl, 2);
									ah = rotateRight(bh, 2);
								} else {
									const second = this.byte();
									ah = second;
									al = ((second & 0xf0) | (second >> 4)) & 0xff;
								}
								for (let step = 0; step < count; step += 1) {
									this.place(plane, destination, bl);
									this.place(plane, destination + 1, bh);
									this.place(plane, destination + 2, al);
									this.place(plane, destination + 3, ah);
									destination += 4;
								}
								count <<= 2;
							} else {
								if (0 === count) count = this.byte();
								const first = this.byte();
								const second = this.byte();
								for (let step = 0; step < count; step += 1) {
									this.place(plane, destination, first);
									this.place(plane, destination + 1, second);
									destination += 2;
								}
								count <<= 1;
							}
							break;
						case 0xfe: {
							const kind = count;
							count &= 0x3f;
							if (0 === count) count = this.byte();
							if (kind < 0x40) {
								const places = [
									this.byte(),
									this.byte(),
									this.byte(),
									this.byte(),
								];
								for (const [step, value] of places.entries()) {
									this.place(plane, destination + step, value);
								}
								count <<= 2;
								copyOverlapped(plane, destination, destination + 4, count - 4);
								destination += count;
							} else {
								let source: number;
								let mask: number;
								if (0 === (kind & 0x80)) {
									source = 0;
									mask = 1;
								} else if (kind < 0xc0) {
									source = 0;
									mask = 2;
								} else {
									source = 1;
									mask = 2;
								}
								for (let step = 0; step < count; step += 1) {
									const value =
										(this.planes[source]?.[destination] ?? 0) &
										(this.planes[mask]?.[destination] ?? 0);
									this.place(plane, destination, value);
									destination += 1;
								}
							}
							break;
						}
						default: {
							let kind: (source: number) => number;
							if (count < 0x40) {
								kind = (source) =>
									(this.planes[0]?.[source] ?? 0) |
									(this.planes[1]?.[source] ?? 0);
							} else if (count < 0x80) {
								kind = (source) =>
									(this.planes[0]?.[source] ?? 0) ^
									(this.planes[1]?.[source] ?? 0);
								count &= 0x3f;
							} else {
								if (count < 0xa0) {
									kind = (source) =>
										(this.planes[0]?.[source] ?? 0) |
										(this.planes[2]?.[source] ?? 0);
								} else if (count < 0xc0) {
									kind = (source) =>
										(this.planes[1]?.[source] ?? 0) |
										(this.planes[2]?.[source] ?? 0);
								} else if (count < 0xe0) {
									kind = (source) =>
										(this.planes[0]?.[source] ?? 0) ^
										(this.planes[2]?.[source] ?? 0);
								} else {
									kind = (source) =>
										(this.planes[1]?.[source] ?? 0) ^
										(this.planes[2]?.[source] ?? 0);
								}
								count &= 0x1f;
							}
							if (0 === count) count = this.byte();
							for (let step = 0; step < count; step += 1) {
								this.place(plane, destination, kind(destination) & 0xff);
								destination += 1;
							}
							break;
						}
					}
				}
				remaining -= count;
			}
		}
	}

	/** `Mai2Reader.FlattenPlanes`: the places of the picture, of the four planes of it. */
	private flatten(output: Buffer, outputStride: number): void {
		let source = 0;
		for (let column = 0; column < outputStride; column += 4) {
			let destination = column;
			for (let row = 0; row < this.layout.height; row += 1) {
				const places = [
					this.planes[0]?.[source] ?? 0,
					this.planes[1]?.[source] ?? 0,
					this.planes[2]?.[source] ?? 0,
					this.planes[3]?.[source] ?? 0,
				];
				source += 1;
				for (let bit = 0; bit < 8; bit += 2) {
					let place = 0;
					for (let plane = 0; plane < 4; plane += 1) {
						place |= (((places[plane] ?? 0) << bit) & 0x80) >> (3 - plane);
						place |= ((((places[plane] ?? 0) << bit) & 0x40) >> 6) << plane;
					}
					output[destination + (bit >> 1)] = place;
				}
				destination += outputStride;
			}
		}
	}

	/** `Mai2Reader.Unpack`: the planes of the picture and the places of it. */
	unpack(): { pixels: Buffer; palette: Buffer } {
		const palette = this.layout.hasPalette ? this.palette() : greyPalette();
		// The colours of the picture stand of four places to a colour of the picture: three colours of
		// four places to a colour of the map stand of the places of the file itself.
		if (this.layout.hasPalette) this.at = HEAD_SIZE + (COLORS * 3) / 2;
		const { planeSizes } = this.layout;
		let next = this.at;
		for (let plane = 0; plane < 4; plane += 1) {
			if (0 !== (this.layout.flags & (1 << plane))) {
				this.at = next;
				this.unpackPlane(this.planes[plane] as Buffer);
			}
			next += planeSizes[plane] ?? 0;
		}
		const outputStride = this.layout.width >> 1;
		const output: Buffer = Buffer.alloc(
			outputStride * this.layout.height,
			0x00,
		);
		this.flatten(output, outputStride);
		return { pixels: output, palette };
	}
}

/** The colours of a picture of no colour map of its own: sixteen places of grey. */
function greyPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(COLORS * 4, 0x00);
	for (let color = 0; color < COLORS; color += 1) {
		const grey = color * 0x11;
		palette[color * 4] = grey & 0xff;
		palette[color * 4 + 1] = grey & 0xff;
		palette[color * 4 + 2] = grey & 0xff;
	}
	return palette;
}

/** `Mai2Format.Read`: the places of the picture, handed over as a bitmap of four places to a place. */
export function unpackMai2Picture(data: Buffer, layout: Mai2Layout): Buffer {
	const { pixels, palette } = new Mai2Reader(data, layout).unpack();
	return writeBmp4(
		layout.width,
		layout.height,
		pixels,
		paletteTriples(palette),
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const izumiMai2ImageDescriptor: FormatDescriptor = {
	id: "izumi-mai2-image",
	name: "Izumi engine image",
	extensions: ["mai", "mai2"],
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
			source: "Legacy/Izumi/ImageMAI2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const izumiMai2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: izumiMai2ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readMai2Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readMai2Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Izumi engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
					flags: layout.flags,
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
				bitsPerPixel: 4,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readMai2Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the Izumi engine");
		return Readable.from([unpackMai2Picture(data, layout)]);
	},
});
