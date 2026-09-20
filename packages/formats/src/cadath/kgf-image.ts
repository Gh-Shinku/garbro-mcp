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
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("KGF", "latin1");
const HEAD_SIZE = 0x1c;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
const BPP_FIELD = 0xc;
const MODE_FIELD = 0x10;
const PACKED_SIZE_FIELD = 0x24;
const BITS_PER_PLACE = 8;
const BITS_PER_PLACE_24 = 24;
const BITS_PER_PLACE_32 = 32;
const MODE_RAW = 0;
const MODE_CHANNELS = 1;
const MODE_BITS = 2;
const MODE_PACKED = 3;
const MODE_PACKED_CHANNELS = 4;
const MODE_PACKED_XOR = 5;
const PACKED_BUFFER = 0x100;
const PACKED_BUFFER_LONG = 0x200;
const LEAST_RUN = 3;
const LIMIT = 256 * 1024 * 1024;

export interface KgfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	mode: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readKgfLayout(
	data: Buffer,
	fileLength = data.length,
): KgfLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readInt32LE(BPP_FIELD);
	const mode = data.readInt32LE(MODE_FIELD);
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	if (bitsPerPixel !== BITS_PER_PLACE_24 && bitsPerPixel !== BITS_PER_PLACE_32)
		return undefined;
	if (mode < 0 || mode > MODE_PACKED_XOR) return undefined;
	return { width, height, bitsPerPixel, mode, dataOffset: HEAD_SIZE };
}

class KgfInputBuffer {
	private readonly ctlBits: Buffer;
	private readonly data: Buffer;
	private lastByte = 0;

	constructor(readonly length: number) {
		this.ctlBits = Buffer.alloc((length >> 3) + 1);
		this.data = Buffer.alloc(length + 1);
	}

	get byteLength(): number {
		return this.length >> 3;
	}

	readFromStream(input: Buffer, position: number): number {
		const from = position;
		if (from + this.byteLength > input.length)
			throw invalidPicture(
				"The places of the walk of a picture stand short of the places of the picture",
			);
		input.copy(this.ctlBits, 0, from, from + this.byteLength);
		return from + this.byteLength;
	}

	readFromBuffer(input: Buffer): void {
		input.copy(this.ctlBits, 0, 0, this.byteLength);
	}

	decode(
		output: Buffer,
		dstPos: number,
		outputSize: number,
		input: Buffer,
		position: number,
	): { position: number; chunkSize: number; over: boolean } {
		let at = position;
		for (let i = 0; i < this.length; i += 1) {
			if (((this.ctlBits[i >> 3] ?? 0) & 1) !== 0) {
				this.data[i] = 0;
			} else {
				if (at >= input.length) break;
				this.data[i] = input[at] ?? 0;
				at += 1;
			}
			this.ctlBits[i >> 3] = (this.ctlBits[i >> 3] ?? 0) >> 1;
		}
		this.data[0] = (this.data[0] ?? 0) ^ this.lastByte;
		for (let i = 0; i < this.length; i += 1)
			this.data[i + 1] = (this.data[i + 1] ?? 0) ^ (this.data[i] ?? 0);
		this.lastByte = this.data[this.length - 1] ?? 0;
		const chunkSize = Math.min(this.length, outputSize);
		this.data.copy(output, dstPos, 0, chunkSize);
		return { position: at, chunkSize, over: this.length > outputSize };
	}
}

function decompressKgf(
	input: Buffer,
	position: number,
	output: Buffer,
	bufferSize: number,
): Buffer {
	const buf0 = new KgfInputBuffer(bufferSize);
	const buf1 = new KgfInputBuffer(bufferSize >> 3);
	const bitsBuf = Buffer.alloc(buf1.length + 1);
	let at = position;
	let dst = 0;
	while (dst < output.length) {
		at = buf1.readFromStream(input, at);
		const first = buf1.decode(bitsBuf, 0, buf1.length, input, at);
		if (first.over)
			throw invalidPicture(
				"The places of the walk of a picture stand past the places of the picture",
			);
		at = first.position;
		buf0.readFromBuffer(bitsBuf);
		const second = buf0.decode(output, dst, output.length - dst, input, at);
		at = second.position;
		if (second.over) break;
		dst += second.chunkSize;
	}
	return output;
}

function copyChannels(output: Buffer, data: Buffer, pixelSize: number): void {
	let src = 0;
	for (let i = 0; i < pixelSize; i += 1) {
		for (let dst = i; dst < output.length; dst += pixelSize) {
			output[dst] = data[src] ?? 0;
			src += 1;
		}
	}
}

export function unpackKgfPicture(data: Buffer, layout: KgfLayout): Buffer {
	const pixelSize = layout.bitsPerPixel / BITS_PER_PLACE;
	const output = Buffer.alloc(layout.width * layout.height * pixelSize);
	if (layout.mode === MODE_RAW) {
		const from = layout.dataOffset;
		if (from + output.length > data.length)
			throw invalidPicture(
				"The places of the walk of a picture stand short of the places of the picture",
			);
		data.copy(output, 0, from, from + output.length);
		return output;
	}
	if (layout.mode === MODE_CHANNELS) {
		const from = layout.dataOffset;
		if (from + output.length > data.length)
			throw invalidPicture(
				"The places of the walk of a picture stand short of the places of the picture",
			);
		copyChannels(output, data.subarray(from, from + output.length), pixelSize);
		return output;
	}
	if (layout.mode === MODE_BITS) {
		return unpackKgfBits(data, layout, output, pixelSize);
	}
	if (layout.mode === MODE_PACKED) {
		return decompressKgf(data, PACKED_SIZE_FIELD + 4, output, PACKED_BUFFER);
	}
	if (layout.mode === MODE_PACKED_CHANNELS) {
		const places = decompressKgf(
			data,
			PACKED_SIZE_FIELD + 4,
			Buffer.alloc(output.length),
			PACKED_BUFFER,
		);
		copyChannels(output, places, pixelSize);
		return output;
	}
	const places = decompressKgf(
		data,
		PACKED_SIZE_FIELD + 4,
		Buffer.alloc(output.length),
		PACKED_BUFFER_LONG,
	);
	const line = Buffer.alloc(layout.width);
	let src = 0;
	for (let channel = 0; channel < pixelSize; channel += 1) {
		line.fill(0);
		let dst = channel;
		for (let at = 0; at < layout.width * layout.height; at += 1) {
			const pos = at % layout.width;
			const place = (line[pos] ?? 0) ^ (places[src] ?? 0);
			src += 1;
			output[dst] = place;
			line[pos] = place;
			dst += pixelSize;
		}
	}
	return output;
}

function unpackKgfBits(
	data: Buffer,
	layout: KgfLayout,
	output: Buffer,
	pixelSize: number,
): Buffer {
	const bitsSize = data.readInt32LE(layout.dataOffset);
	const ctlSize = data.readInt32LE(layout.dataOffset + 4);
	if (bitsSize < 0 || ctlSize < 0)
		throw invalidPicture("The places of the walk of a picture stand nowhere");
	const from = layout.dataOffset + 12;
	if (from + ctlSize > data.length)
		throw invalidPicture(
			"The places of the walk of a picture stand short of the places of the picture",
		);
	const bits = Buffer.from(data.subarray(from, from + ctlSize));
	const places = Buffer.alloc(output.length);
	let at = from + ctlSize;
	let dst = 0;
	for (let i = 0; i < bitsSize; i += 1) {
		if (((bits[i >> 3] ?? 0) & 1) !== 0) {
			if (at >= data.length)
				throw invalidPicture(
					"The places of the walk of a picture stand short of the places of the picture",
				);
			const value = data[at] ?? 0;
			at += 1;
			if (at >= data.length)
				throw invalidPicture(
					"The places of the walk of a picture stand short of the places of the picture",
				);
			const count = Math.min((data[at] ?? 0) + LEAST_RUN, places.length - dst);
			at += 1;
			for (let j = 0; j < count; j += 1) {
				places[dst] = value;
				dst += 1;
			}
		} else {
			if (at >= data.length)
				throw invalidPicture(
					"The places of the walk of a picture stand short of the places of the picture",
				);
			places[dst] = data[at] ?? 0;
			at += 1;
			dst += 1;
		}
		if (dst >= places.length) break;
		bits[i >> 3] = (bits[i >> 3] ?? 0) >> 1;
	}
	copyChannels(output, places, pixelSize);
	return output;
}

export const cadathKgfImageDescriptor: FormatDescriptor = {
	id: "cadath-kgf-image",
	name: "Cadath image format",
	extensions: ["kgf"],
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
			source: "ArcFormats/Cadath/ImageKGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cadathKgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cadathKgfImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readKgfLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readKgfLayout(stored, Number(source.size));
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
						bitsPerPixel: layout.bitsPerPixel,
						mode: layout.mode,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				mode: layout.mode,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readKgfLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		const places = unpackKgfPicture(stored, layout);
		if (layout.bitsPerPixel === BITS_PER_PLACE_24)
			return Readable.from([
				writeBmp24(layout.width, layout.height, places, false),
			]);
		return Readable.from([
			writeBmp32(layout.width, layout.height, places, false),
		]);
	},
});
