// Port of GARbro "ArcFormats/Liar/ImageLIM.cs" (tag "LIM", classes LimFormat, LimFormat.Reader), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A LIM picture stands of four walks of the
// places of a channel of it, every walk standing of the words of a table of its own.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { RGB565_MASKS, writeBmp16, writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("LM", "latin1");
const HEAD_SIZE = 0x10;
const BYTE_BITS = 8;
/** The count of the places of a walk of a picture of four places to a place. */
const CHANNEL_CARD = 3;
/** The counts of the words of a walk behind which the walk stands of a count of another count. */
const SMALL_INDEX = 8192;
const CHANNEL_THRESHOLD = 6;
const CHANNEL_LIMIT = 12;

export interface LimLayout {
	flags: number;
	bitsPerPixel: number;
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `LimFormat.ReadMetaData`. */
export function readLimLayout(data: Buffer): LimLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const flags = data.readUInt16LE(2);
	if (2 !== (flags & 0x0f) && 3 !== (flags & 0x0f)) return undefined;
	const bitsPerPixel = 0x10 === data.readUInt16LE(4) ? 16 : 32;
	const width = data.readUInt32LE(8);
	const height = data.readUInt32LE(12);
	if (0 === width || 0 === height) return undefined;
	return { flags, bitsPerPixel, width, height };
}

/** `LimFormat.Reader`: the walks of the channels of the picture, of the words of a table of their own. */
class LimReader {
	private at: number;
	private readonly own: Buffer;
	private remaining = 0;
	private cache = 0;
	private cached = 0;
	private threshold = CHANNEL_THRESHOLD;
	private limit = CHANNEL_LIMIT;

	constructor(data: Buffer, at: number) {
		this.own = data;
		this.at = at;
	}

	/** The place of the file the walks of the picture stand at. */
	get position(): number {
		return this.at;
	}

	/** `LimFormat.Reader.GetBits`: `count` places of the walks, of the highest place of a place first. */
	private bits(count: number): number {
		let value = 0;
		let left = count;
		while (left > 0) {
			if (0 === this.cached) {
				if (0 === this.remaining) return value;
				this.cache = this.own[this.at] ?? 0;
				this.at += 1;
				this.remaining -= 1;
				this.cached = BYTE_BITS;
			}
			value = (value << 1) | ((this.cache >> 7) & 1);
			this.cache = (this.cache << 1) & 0xff;
			this.cached -= 1;
			left -= 1;
		}
		return value;
	}

	/** `LimFormat.Reader.GetIndex`: the place of a word of the table, of the places of the bits. */
	private index(count: number): number {
		let value = count;
		if (value <= this.threshold) {
			if (0 === value) return -1;
			value -= 1;
			if (0 === value) return this.bits(1);
			return (1 << value) | this.bits(value);
		}
		for (let place = this.threshold; place < this.limit; place += 1) {
			const bit = this.bits(1);
			if (0 === bit) return (1 << place) | this.bits(place);
		}
		return -1;
	}

	/** `LimFormat.Reader.UnpackChannel`: the places of one channel of the picture. */
	unpackChannel(card: number, size: number, step: number): Buffer {
		this.threshold = CHANNEL_THRESHOLD;
		this.limit = CHANNEL_LIMIT;
		const channelSize = this.own.readInt32LE(this.at);
		this.at += 4;
		if (channelSize < 0)
			throw invalidPicture("The places of the channel stand short of the file");
		this.remaining = this.own.readInt32LE(this.at);
		this.at += 4;
		const indexSize = this.own.readUInt16LE(this.at);
		this.at += 2;
		this.at += 2;
		if (this.at + indexSize > this.own.length) {
			throw invalidPicture("The words of the channel stand short of the file");
		}
		if (indexSize > this.indexTable.length) {
			throw invalidPicture(
				"The words of the channel stand beyond the words of the picture",
			);
		}
		for (let place = 0; place < indexSize; place += 1) {
			this.indexTable[place] = this.own[this.at + place] ?? 0;
		}
		this.at += indexSize;
		this.cache = 0;
		this.cached = 0;
		const output: Buffer = Buffer.alloc(size, 0x00);
		let destination = 0;
		while (destination < output.length) {
			const count = this.bits(card);
			if (0 !== count) {
				const place = this.index(count);
				if (place < 0) break;
				if (destination + 1 >= output.length) break;
				output[destination] = this.indexTable[place * step] ?? 0;
				destination += 1;
			} else {
				let run = this.bits(4);
				const count2 = this.bits(card);
				const place = this.index(count2);
				if (place < 0) break;
				run += 2;
				for (let at = 0; at < run; at += 1) {
					if (destination >= output.length) return output;
					output[destination] = this.indexTable[place * step] ?? 0;
					destination += 1;
				}
			}
		}
		return output;
	}

	private readonly indexTable = Buffer.alloc(0x10000, 0x00);

	/**
	 * `LimFormat.Reader.Unpack16bpp` is the same walk of the words of a table of its own, though the count
	 * of the places of the words of it stands of two places of the file.
	 */
	unpackChannelWords(size: number): Buffer {
		const channelSize = this.own.readInt32LE(this.at);
		this.at += 4;
		if (channelSize < 0)
			throw invalidPicture("The places of the channel stand short of the file");
		this.remaining = this.own.readInt32LE(this.at);
		this.at += 4;
		const indexSize = this.own.readUInt16LE(this.at) * 2;
		this.at += 2;
		this.at += 2;
		// A word table of more than 8192 words stands of four places to a count, of sixteen places.
		const wide = indexSize > SMALL_INDEX;
		this.threshold = wide ? 14 : CHANNEL_THRESHOLD;
		this.limit = wide ? 16 : CHANNEL_LIMIT;
		const card = wide ? 4 : 3;
		if (this.at + indexSize > this.own.length) {
			throw invalidPicture("The words of the channel stand short of the file");
		}
		if (indexSize > this.indexTable.length) {
			throw invalidPicture(
				"The words of the channel stand beyond the words of the picture",
			);
		}
		for (let place = 0; place < indexSize; place += 1) {
			this.indexTable[place] = this.own[this.at + place] ?? 0;
		}
		this.at += indexSize;
		this.cache = 0;
		this.cached = 0;
		const output: Buffer = Buffer.alloc(size, 0x00);
		let destination = 0;
		while (destination < output.length) {
			const count = this.bits(card);
			if (0 !== count) {
				const place = this.index(count);
				if (place < 0) break;
				if (destination + 1 >= output.length) break;
				output[destination] = this.indexTable[place * 2] ?? 0;
				output[destination + 1] = this.indexTable[place * 2 + 1] ?? 0;
				destination += 2;
			} else {
				let run = this.bits(4);
				const count2 = this.bits(card);
				const place = this.index(count2);
				if (place < 0) break;
				run += 2;
				for (let at = 0; at < run; at += 1) {
					if (destination + 1 >= output.length) return output;
					output[destination] = this.indexTable[place * 2] ?? 0;
					output[destination + 1] = this.indexTable[place * 2 + 1] ?? 0;
					destination += 2;
				}
			}
		}
		return output;
	}
}

/** `LimFormat.Reader`: the channels of the picture, of the places of the file behind them. */
function unpackLim(data: Buffer, layout: LimLayout): Buffer {
	const places = layout.width * layout.height;
	if (32 === layout.bitsPerPixel) {
		// Four channels of one place to a place: the alpha of the picture stands of the places of the file
		// the other way round, and the channels of the picture stand of the four places of a place of it.
		const pixels: Buffer = Buffer.alloc(places * 4, 0x00);
		const reader = new LimReader(data, HEAD_SIZE);
		let mask = 0xff;
		for (let channel = 3; channel >= 0; channel -= 1) {
			const places2 = reader.unpackChannel(CHANNEL_CARD, places, 1);
			for (let place = 0; place < places; place += 1) {
				pixels[place * 4 + channel] = (places2[place] ?? 0) ^ mask;
			}
			mask = 0;
		}
		return writeBmp32(layout.width, layout.height, pixels);
	}
	// A picture of two places to a place: the places stand as they stand, or of a walk of the channels.
	const reader = new LimReader(data, HEAD_SIZE);
	let picture: Buffer;
	let at = HEAD_SIZE;
	if (0 !== (layout.flags & 0x10)) {
		if (0 !== (layout.flags & 0xe0)) {
			picture = reader.unpackChannelWords(places * 2);
			at = reader.position;
		} else {
			if (HEAD_SIZE + places * 2 > data.length) {
				throw invalidPicture(
					"The places of the picture stand short of the file",
				);
			}
			picture = Buffer.from(data.subarray(HEAD_SIZE, HEAD_SIZE + places * 2));
			at = HEAD_SIZE + places * 2;
		}
	} else {
		picture = Buffer.alloc(places * 2, 0x00);
	}
	if (0 === (layout.flags & 0x100)) {
		return writeBmp16(
			layout.width,
			layout.height,
			picture,
			false,
			RGB565_MASKS,
		);
	}
	const alpha: Buffer =
		0 !== (layout.flags & 0xe00)
			? reader.unpackChannel(CHANNEL_CARD, places, 1)
			: (() => {
					if (at + places > data.length) {
						throw invalidPicture(
							"The alpha of the picture stands short of the file",
						);
					}
					return Buffer.from(data.subarray(at, at + places));
				})();
	const pixels: Buffer = Buffer.alloc(places * 4, 0x00);
	for (let place = 0; place < places; place += 1) {
		const color = picture.readUInt16LE(place * 2);
		pixels[place * 4] = Math.trunc(((color & 0x1f) * 0xff) / 0x1f) & 0xff;
		pixels[place * 4 + 1] = Math.trunc(((color & 0x7e0) * 0xff) / 0x7e0) & 0xff;
		pixels[place * 4 + 2] =
			Math.trunc(((color & 0xf800) * 0xff) / 0xf800) & 0xff;
		pixels[place * 4 + 3] = ~(alpha[place] ?? 0) & 0xff;
	}
	return writeBmp32(layout.width, layout.height, pixels);
}

/** `LimFormat.Read`: the places of the picture, handed over as a bitmap. */
export function unpackLimPicture(data: Buffer, layout: LimLayout): Buffer {
	return unpackLim(data, layout);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const liarLimImageDescriptor: FormatDescriptor = {
	id: "liar-lim-image",
	name: "Liar-soft image",
	extensions: ["lim"],
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
			source: "ArcFormats/Liar/ImageLIM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const liarLimImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: liarLimImageDescriptor,
	// The reference registers no word of its own: the head of the picture is what decides.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readLimLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readLimLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Liar-soft engine");
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
					bitsPerPixel: layout.bitsPerPixel,
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
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readLimLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Liar-soft engine");
		return Readable.from([unpackLimPicture(data, layout)]);
	},
});
