// Format reference: GARBro "Legacy/Liddell/ImageBPA.cs", classes `BpaFormat` and `BpaDecoder`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word every picture of this engine opens with, and the head behind it. */
const MARK = Buffer.from("-BPA", "latin1");
const HEADER_SIZE = 0x11;
const DASH_AT = 4;
const WIDTH_AT = 6;
const HEIGHT_AT = 8;
const COLOURS_AT = 0x0a;
const PALETTE_AT = 0x0c;
const DATA_AT = 0x0e;
const DEPTH_BYTE_AT = 0x10;
/** One palette, of three bytes a colour, red first. */
const PALETTE_COLOUR_BYTES = 3;
const PALETTE_ENTRIES = 0x100;
/** A chunk of the packed run stands for sixteen places at the most, and a control byte holds four. */
const CHUNK_SIZE = 16;
const CHUNKS_PER_CONTROL = 4;
const CONTROL_BITS = 2;
/** The stack the run keeps its last six values in. */
const STACK_SIZE = 6;
/** The width a picture is aligned to, in pixels, for the run of a channel. */
const ALIGN = 4;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface BpaLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	colours: number;
	paletteOffset: number;
	dataOffset: number;
	/** The width every channel's run is aligned to, and the stride the channels stand in. */
	alignedWidth: number;
	channels: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `BpaFormat.ReadMetaData`: the head of the picture, which names its own depth when it keeps no palette. */
export function readBpaLayout(data: Buffer): BpaLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(MARK)) return undefined;
	if (0x2d !== (data[DASH_AT] ?? 0)) return undefined;
	const width = data.readUInt16LE(WIDTH_AT);
	const height = data.readUInt16LE(HEIGHT_AT);
	const paletteOffset = data.readUInt16LE(PALETTE_AT);
	const bitsPerPixel = 0 === paletteOffset ? (data[DEPTH_BYTE_AT] ?? 0) * 8 : 8;
	if (0 === width || 0 === height) return undefined;
	if (8 !== bitsPerPixel && 24 !== bitsPerPixel && 32 !== bitsPerPixel) {
		return undefined;
	}
	const channels = bitsPerPixel >> 3;
	const alignedWidth = ALIGN * (Math.trunc((width - 1) / ALIGN) + 1);
	const total = alignedWidth * height * channels;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		colours: data.readUInt16LE(COLOURS_AT),
		paletteOffset,
		dataOffset: data.readUInt16LE(DATA_AT),
		alignedWidth,
		channels,
	};
}

/** `ImageFormat.ReadPalette` in the order this format keeps, taken to the four bytes a writer wants. */
export function readBpaPalette(
	data: Buffer,
	at: number,
	colours: number,
): Buffer | undefined {
	if (colours < 1 || colours > PALETTE_ENTRIES) return undefined;
	if (at + colours * PALETTE_COLOUR_BYTES > data.length) return undefined;
	const palette = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < colours; index += 1) {
		const from = at + index * PALETTE_COLOUR_BYTES;
		const to = index * 4;
		palette[to] = data[from + 2] ?? 0;
		palette[to + 1] = data[from + 1] ?? 0;
		palette[to + 2] = data[from] ?? 0;
		palette[to + 3] = 0xff;
	}
	return palette;
}

/**
 * `BpaDecoder.Decompress`: a byte holds four chunks of two bits each, read from its own top. A chunk stands
 * for at most sixteen places: a run that stands as it is, a value filled over as many places as its own
 * count byte says, a control word that mixes one value with bytes that stand as they are, or places taken
 * from the stack of the six values used last.
 */
class BpaRun {
	private at: number;
	private bits = 0;
	private count = 0;
	private readonly stack = new Uint8Array(STACK_SIZE);

	constructor(
		private readonly data: Buffer,
		from: number,
	) {
		this.at = from;
	}

	/** Where the run ended, so a caller knows where the next channel begins. */
	get end(): number {
		return this.at;
	}

	/** `BpaDecoder.GetNextBit`: one bit from the top of the byte, gathered into a value of its own. */
	private nextBit(previous: number): number {
		if (0 === this.count) {
			this.bits = this.data[this.at] ?? 0;
			this.at += 1;
		}
		const result = ((previous << 1) | (this.bits >> 7)) & 0xff;
		this.bits = (this.bits << 1) & 0xff;
		this.count += 1;
		if (this.count >= 8) this.count = 0;
		return result;
	}

	/** `BpaDecoder.StorePixel`: the value used last stands first, and no value stands twice. */
	private store(value: number): void {
		let index = 0;
		for (; index < STACK_SIZE - 1; index += 1) {
			if (this.stack[index] === value) break;
		}
		if (0 === index) return;
		while (index > 0) {
			this.stack[index] = this.stack[index - 1] ?? 0;
			index -= 1;
		}
		this.stack[0] = value;
	}

	/**
	 * `BpaDecoder.RestorePixel`: the value a place takes. The code the reference reads for this is its own
	 * dead end - both of its short branches need a value the first bit can never have - so what it reaches
	 * every time is the last branch: eight bits gathered into a value of its own, and the stack shifted.
	 */
	private restore(): number {
		this.nextBit(0);
		let value = 0;
		for (let index = 0; index < 8; index += 1) value = this.nextBit(value);
		for (let index = STACK_SIZE - 1; index > 0; index -= 1) {
			this.stack[index] = this.stack[index - 1] ?? 0;
		}
		this.stack[0] = value;
		return value;
	}

	/** `BpaDecoder.Decompress`: one channel of the picture, place by place. */
	decompress(output: Uint8Array, height: number): number {
		this.stack[0] = 0;
		this.stack[4] = 0;
		this.stack[5] = 0;
		let dst = 0;
		for (let y = 0; y < height; y += 1) {
			let control = 0;
			let left = 0;
			let width = output.length / height;
			while (width > 0) {
				if (0 === left) {
					left = CHUNKS_PER_CONTROL;
					control = this.data[this.at] ?? 0;
					this.at += 1;
				}
				let size = Math.min(width, CHUNK_SIZE);
				switch ((control >> 6) & 0x03) {
					case 0: {
						for (let index = 0; index < size; index += 1) {
							if (dst < output.length) output[dst] = this.data[this.at] ?? 0;
							dst += 1;
							this.at += 1;
						}
						break;
					}
					case 1: {
						const value = this.data[this.at] ?? 0;
						size = this.data[this.at + 1] ?? 0;
						this.at += 2;
						for (let index = 0; index < size; index += 1) {
							if (dst < output.length) output[dst] = value;
							dst += 1;
						}
						this.store(value);
						break;
					}
					case 2: {
						// The control word stands least significant byte first, and is read from its own top.
						let word =
							(this.data[this.at] ?? 0) | ((this.data[this.at + 1] ?? 0) << 8);
						const value = this.data[this.at + 2] ?? 0;
						this.at += 3;
						for (let index = 0; index < size; index += 1) {
							if (0 !== (word & 0x8000)) {
								if (dst < output.length) output[dst] = value;
								dst += 1;
							} else {
								if (dst < output.length) output[dst] = this.data[this.at] ?? 0;
								dst += 1;
								this.at += 1;
							}
							word = (word << 1) & 0xffff;
						}
						this.store(value);
						break;
					}
					default: {
						this.count = 0;
						for (let index = 0; index < size; index += 1) {
							if (dst < output.length) output[dst] = this.restore();
							dst += 1;
						}
						if (8 !== this.count) this.at += 1;
						break;
					}
				}
				width -= size;
				left -= 1;
				control = (control << CONTROL_BITS) & 0xff;
			}
		}
		return this.at;
	}
}

/** `BpaDecoder.Unpack`: the palette, then one run for every channel, drawn together from the bottom up. */
export function unpackBpaPicture(
	data: Buffer,
	layout: BpaLayout,
): { pixels: Buffer; palette?: Buffer } {
	const palette =
		0 === layout.paletteOffset
			? undefined
			: readBpaPalette(data, layout.paletteOffset, layout.colours);
	if (0 !== layout.paletteOffset && !palette) {
		throw invalid("The picture's palette reaches past the file");
	}
	const { alignedWidth, channels, height } = layout;
	const stride = alignedWidth * channels;
	const pixels = Buffer.alloc(stride * height, 0x00);
	let at = layout.dataOffset;
	for (let channel = 0; channel < channels; channel += 1) {
		const run = new BpaRun(data, at);
		if (1 === channels) {
			run.decompress(pixels, height);
			at = run.end;
			continue;
		}
		const plane = new Uint8Array(alignedWidth * height);
		run.decompress(plane, height);
		at = run.end;
		// The channel's own rows are read from its last one down, so a picture of several channels stands
		// the other way up from what its own run wrote.
		let dstRow = channel;
		let srcRow = plane.length - alignedWidth;
		for (let y = 0; y < height; y += 1) {
			let to = dstRow;
			let from = srcRow;
			for (let x = 0; x < alignedWidth; x += 1) {
				if (to < pixels.length) pixels[to] = plane[from] ?? 0;
				to += channels;
				from += 1;
			}
			dstRow += stride;
			srcRow -= alignedWidth;
		}
		// One byte stands between the runs of two channels, which the reference reads and leaves aside.
		at += 1;
	}
	// A picture of the whole palette keeps no palette of its own, so it hands none over.
	return palette ? { pixels, palette } : { pixels };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const liddellBpaImageDescriptor: FormatDescriptor = {
	id: "liddell-bpa-image",
	name: "Liddell image",
	extensions: ["bpa"],
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
			source: "Legacy/Liddell/ImageBPA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const liddellBpaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: liddellBpaImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readBpaLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBpaLayout(await readStored(source));
		if (!layout) throw invalid("Not a Liddell picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
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
				colours: layout.colours,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readBpaLayout(stored);
		if (!layout) throw invalid("Not a Liddell picture");
		const { pixels, palette } = unpackBpaPicture(stored, layout);
		if (8 === layout.bitsPerPixel) {
			// The run works in rows aligned to four pixels, and the writers here take packed rows.
			const packed = Buffer.alloc(layout.width * layout.height, 0x00);
			for (let row = 0; row < layout.height; row += 1) {
				for (let column = 0; column < layout.width; column += 1) {
					packed[row * layout.width + column] =
						pixels[row * layout.alignedWidth + column] ?? 0;
				}
			}
			return Readable.from([
				writeBmp8Palette(
					layout.width,
					layout.height,
					packed,
					palette ?? Buffer.alloc(PALETTE_ENTRIES * 4, 0xff),
					false,
				),
			]);
		}
		// A picture of several channels stands the other way up, and its rows are gathered together.
		const channels = layout.channels;
		const packed = Buffer.alloc(
			((layout.width * channels + 3) & ~3) * layout.height,
			0x00,
		);
		for (let row = 0; row < layout.height; row += 1) {
			for (let column = 0; column < layout.width; column += 1) {
				for (let channel = 0; channel < channels; channel += 1) {
					packed[
						row * ((layout.width * channels + 3) & ~3) +
							column * channels +
							channel
					] =
						pixels[
							row * layout.alignedWidth * channels + column * channels + channel
						] ?? 0;
				}
			}
		}
		const bottomUp = true;
		return Readable.from([
			24 === layout.bitsPerPixel
				? writeBmp24(layout.width, layout.height, packed, bottomUp)
				: writeBmp32(layout.width, layout.height, packed, bottomUp),
		]);
	},
});
