// Format reference: GARbro ArcFormats/Pajamas/ImageEPA.cs (classes `EpaFormat` and its `Reader`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	RGB565_MASKS,
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `EpaFormat.Signatures`: the two words are `EP` followed by the mode the header also carries. */
const SIGNATURES = [0x01015045, 0x02015045];
const HEADER_SIZE = 0x10;
/** A mode of two puts the picture's own offset in front of the pixels. */
const OFFSET_MODE = 2;
const OFFSET_HEADER_SIZE = 0x18;
const PALETTE_COLOURS = 0x100;
/** `PaletteFormat.Bgr` holds three bytes to an entry. */
const PALETTE_ENTRY_BYTES = 3;
const PALETTE_BYTES = PALETTE_COLOURS * PALETTE_ENTRY_BYTES;
const ALPHA_COLOR_TYPE = 4;
/** The bytes to a pixel and the width of each colour type. */
const COLOR_TYPES: ReadonlyMap<number, { pixelSize: number; bits: number }> =
	new Map([
		[0, { pixelSize: 1, bits: 8 }],
		[1, { pixelSize: 3, bits: 24 }],
		[2, { pixelSize: 4, bits: 32 }],
		[3, { pixelSize: 2, bits: 16 }],
		[4, { pixelSize: 1, bits: 8 }],
	]);
/** The offset table `Reader.Unpack` builds from the width, indexed by the high nibble of a flag. */
const OFFSET_TABLE_SIZE = 16;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface EpaLayout {
	readonly width: number;
	readonly height: number;
	/** The first byte of the signature, which the reference reads as the mode. */
	readonly mode: number;
	readonly colorType: number;
	/** The bytes to a pixel before the channels are woven together. */
	readonly pixelSize: number;
	readonly bitsPerPixel: number;
	readonly hasAlpha: boolean;
	readonly offsetX?: number;
	readonly offsetY?: number;
}

/** `EpaFormat.ReadMetaData`, with the signature check the reference leaves to its format catalogue. */
export function readEpaLayout(data: Buffer): EpaLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!SIGNATURES.includes(data.readUInt32LE(0))) return undefined;
	const colorType = data[4] ?? 0;
	const kind = COLOR_TYPES.get(colorType);
	if (!kind) return undefined;
	const mode = data[3] ?? 0;
	const layout: EpaLayout = {
		width: data.readUInt32LE(8),
		height: data.readUInt32LE(12),
		mode,
		colorType,
		pixelSize: kind.pixelSize,
		bitsPerPixel: kind.bits,
		hasAlpha: ALPHA_COLOR_TYPE === colorType,
	};
	if (OFFSET_MODE !== mode) return layout;
	if (data.length < OFFSET_HEADER_SIZE) return undefined;
	return {
		...layout,
		offsetX: data.readInt32LE(0x10),
		offsetY: data.readInt32LE(0x14),
	};
}

/** The offset table of `Reader.Unpack`, which every back reference is measured against. */
export function epaOffsetTable(width: number): number[] {
	const table = new Array<number>(OFFSET_TABLE_SIZE).fill(0);
	table[0] = 0;
	table[1] = 1;
	table[2] = width;
	table[3] = width + 1;
	table[4] = 2;
	table[5] = width - 1;
	table[6] = width * 2;
	table[7] = 3;
	table[8] = (width + 1) * 2;
	table[9] = width + 2;
	table[10] = width * 2 + 1;
	table[11] = width * 2 - 1;
	table[12] = (width - 1) * 2;
	table[13] = width - 2;
	table[14] = width * 3;
	table[15] = 4;
	return table;
}

/**
 * `Reader.UnpackChannel`: a flag byte either gives a run of literal bytes or a back reference whose
 * distance comes from the table indexed by the flag's high nibble. A reference that would leave the
 * channel stops it, which is what the reference's own break does; a flag that asks for nothing would
 * leave the reference reading its stream to the end, so the port refuses it instead.
 */
export function decodeEpaChannel(
	data: Buffer,
	at: number,
	size: number,
	width: number,
): { output: Buffer; end: number } {
	const output = Buffer.alloc(size);
	const offsets = epaOffsetTable(width);
	let position = at;
	let written = 0;
	while (written < size) {
		if (position >= data.length)
			throw invalidPicture("Pajamas picture ends inside a channel");
		const flag = data[position] ?? 0;
		position += 1;
		if (0 === (flag & 0xf0)) {
			let count = flag;
			if (0 === count) continue;
			if (written + count > size) count = size - written;
			if (position + count > data.length)
				throw invalidPicture("Pajamas picture ends inside a literal run");
			data.copy(output, written, position, position + count);
			position += count;
			written += count;
			continue;
		}
		let count: number;
		if (0 !== (flag & 8)) {
			if (position >= data.length)
				throw invalidPicture("Pajamas picture ends inside a run length");
			count = (data[position] ?? 0) + ((flag & 7) << 8);
			position += 1;
		} else {
			count = flag & 7;
		}
		if (0 === count)
			throw invalidPicture("Pajamas picture asks for an empty back reference");
		if (written + count > size) break;
		const source = written - (offsets[flag >> 4] ?? 0);
		if (!copyOverlapped(output, source, written, count))
			throw invalidPicture("Pajamas picture refers outside its channel");
		written += count;
	}
	return { output, end: position };
}

/** `PaletteFormat.Bgr` read as the bitmap quads a palette bitmap needs. */
function paletteQuads(palette: Buffer): Buffer {
	const quads = Buffer.alloc(PALETTE_COLOURS * 4);
	for (let i = 0; i < PALETTE_COLOURS; i += 1) {
		const at = i * PALETTE_ENTRY_BYTES;
		quads[i * 4] = palette[at] ?? 0;
		quads[i * 4 + 1] = palette[at + 1] ?? 0;
		quads[i * 4 + 2] = palette[at + 2] ?? 0;
	}
	return quads;
}

/** `Reader.Unpack`: one channel, then the second for an alpha colour type, then the pixels. */
export function unpackEpaPicture(data: Buffer, layout: EpaLayout): Buffer {
	const frame = layout.width * layout.height;
	let at = OFFSET_MODE === layout.mode ? OFFSET_HEADER_SIZE : HEADER_SIZE;
	let palette: Buffer | undefined;
	if (1 === layout.pixelSize) {
		if (at + PALETTE_BYTES > data.length)
			throw invalidPicture("Pajamas picture is missing its colour map");
		palette = data.subarray(at, at + PALETTE_BYTES);
		at += PALETTE_BYTES;
	}
	const channel = decodeEpaChannel(
		data,
		at,
		frame * layout.pixelSize,
		layout.width,
	);
	if (layout.hasAlpha) {
		const alpha = decodeEpaChannel(data, channel.end, frame, layout.width);
		const pixels = Buffer.alloc(frame * 4);
		for (let index = 0; index < frame; index += 1) {
			const entry = (channel.output[index] ?? 0) * PALETTE_ENTRY_BYTES;
			pixels[index * 4] = palette?.[entry] ?? 0;
			pixels[index * 4 + 1] = palette?.[entry + 1] ?? 0;
			pixels[index * 4 + 2] = palette?.[entry + 2] ?? 0;
			pixels[index * 4 + 3] = alpha.output[index] ?? 0;
		}
		return writeBmp32(layout.width, layout.height, pixels);
	}
	if (1 === layout.pixelSize)
		return writeBmp8Palette(
			layout.width,
			layout.height,
			channel.output,
			paletteQuads(palette ?? Buffer.alloc(PALETTE_BYTES)),
		);
	if (2 === layout.pixelSize) {
		// A two byte pixel holds the two channels woven together, byte by byte.
		const pixels = Buffer.alloc(frame * 2);
		const channelSize = frame;
		let source = 0;
		let target = 0;
		for (let y = 0; y < layout.height; y += 1) {
			for (let x = 0; x < layout.width; x += 1) {
				const first = channel.output[source + x] ?? 0;
				const second = channel.output[source + x + channelSize] ?? 0;
				// A shift binds tighter than the ors in the reference, and each result is a byte.
				pixels[target] =
					((second & 0x03) | (((first & 0x07) | ((second & 0xfc) << 1)) << 2)) &
					0xff;
				pixels[target + 1] =
					((first & 0xc0) | (((second & 0xe3) | ((first >> 1) & 0x1c)) >> 2)) &
					0xff;
				target += 2;
			}
			source += layout.width;
		}
		return writeBmp16(layout.width, layout.height, pixels, false, RGB565_MASKS);
	}
	// Three and four byte pixels are stored as separate planes, one colour to a plane.
	const pixels = Buffer.alloc(channel.output.length);
	const stride = layout.width * layout.pixelSize;
	let source = 0;
	for (let plane = 0; plane < layout.pixelSize; plane += 1) {
		for (let y = 0; y < layout.height; y += 1) {
			let target = y * stride + plane;
			for (let x = 0; x < layout.width; x += 1) {
				pixels[target] = channel.output[source] ?? 0;
				source += 1;
				target += layout.pixelSize;
			}
		}
	}
	return 4 === layout.pixelSize
		? writeBmp32(layout.width, layout.height, pixels)
		: writeBmp24(layout.width, layout.height, pixels);
}

export const pajamasEpaImageDescriptor: FormatDescriptor = {
	id: "pajamas-epa-image",
	name: "Pajamas Adventure System image",
	extensions: ["epa"],
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
			source: "ArcFormats/Pajamas/ImageEPA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const SIGNATURE = Buffer.from([0x45, 0x50]);

export const pajamasEpaImageFormat = defineFixedArchive({
	descriptor: pajamasEpaImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const head = await source.readAt(0n, HEADER_SIZE);
		return readEpaLayout(head) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readEpaLayout(data);
		if (!layout) throw invalidPicture("Not a Pajamas picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
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
				hasAlpha: layout.hasAlpha,
			},
		});
		return {
			entries: [entry],
			metadata: {
				width: layout.width,
				height: layout.height,
				mode: layout.mode,
				colorType: layout.colorType,
			},
		};
	},
	async openEntry(source) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readEpaLayout(data);
		if (!layout) throw invalidPicture("Not a Pajamas picture");
		return Readable.from([unpackEpaPicture(data, layout)]);
	},
});
