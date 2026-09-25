// Port of GARbro "ArcFormats/Liar/ImageWCG.cs" (tag "WCG", classes WcgFormat, WcgFormat.Reader), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A WCG picture stands of two walks behind
// the head of it, every walk standing of two of the four places of the places of the picture.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("WG", "latin1");
const HEAD_SIZE = 16;
const STREAM_HEAD_SIZE = 12;
/** The count of the words of a walk behind which the walk stands of a count of another count. */
const SMALL_INDEX = 0x1002;
const MAX_INDEX_LENGTH = 0x10;

export interface WcgLayout {
	flags: number;
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `WcgFormat.ReadMetaData`. */
export function readWcgLayout(data: Buffer): WcgLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const flags = data.readUInt16LE(2);
	if (1 !== (flags & 0x0f)) return undefined;
	if (0x20 !== data[4] || 0 !== data[5]) return undefined;
	const width = data.readUInt32LE(8);
	const height = data.readUInt32LE(12);
	if (0 === width || 0 === height) return undefined;
	return { flags, width, height };
}

/** `WcgFormat.Reader`: the two walks of the picture, of the words of the places of it. */
class WcgReader {
	private readonly output: Buffer;
	private nextPointer = HEAD_SIZE;
	private nextSize: number;
	private indexLimit = 6;
	private indexBits = 3;

	constructor(
		private readonly data: Buffer,
		private readonly pixels: number,
	) {
		this.output = Buffer.alloc(pixels * 4, 0x00);
		this.nextSize = data.length - HEAD_SIZE;
	}

	/** `WcgFormat.Reader.GetIndex`: the place of a word of the walks, of the places of the bits. */
	private index(bits: MsbBitReader, count: number): number {
		let length = count - 1;
		if (0 === length) {
			const bit = bits.tryReadBits(1);
			if (bit < 0)
				throw invalidPicture(
					"The walks of the picture stand short of the file",
				);
			return bit;
		}
		if (length < this.indexLimit) {
			const places = bits.tryReadBits(length);
			if (places < 0)
				throw invalidPicture(
					"The walks of the picture stand short of the file",
				);
			return (1 << length) | places;
		}
		for (;;) {
			const bit = bits.tryReadBits(1);
			if (bit < 0)
				throw invalidPicture(
					"The walks of the picture stand short of the file",
				);
			if (0 === bit) break;
			if (length >= MAX_INDEX_LENGTH) {
				throw invalidPicture(
					"The places of the words of the picture stand beyond the count of them",
				);
			}
			length += 1;
		}
		const places = bits.tryReadBits(length);
		if (places < 0)
			throw invalidPicture("The walks of the picture stand short of the file");
		return (1 << length) | places;
	}

	/** `WcgFormat.Reader.DecodeStream`: the words of one walk of the picture. */
	private decodeStream(
		dataPosition: number,
		indexSize: number,
		offset: number,
	): boolean {
		const index: number[] = [];
		for (let at = 0; at < indexSize; at += 1) {
			const place = this.streamAt + STREAM_HEAD_SIZE + at * 2;
			if (place + 2 > this.data.length) {
				throw invalidPicture(
					"The words of the picture stand short of the file",
				);
			}
			index.push(this.data.readUInt16LE(place));
		}
		const bits = new MsbBitReader(this.data, dataPosition);
		let left = this.pixels;
		let at = offset;
		while (left > 0) {
			let count = 1;
			let length = bits.tryReadBits(this.indexBits);
			if (length < 0)
				throw invalidPicture(
					"The walks of the picture stand short of the file",
				);
			if (0 === length) {
				const extra = bits.tryReadBits(4);
				if (extra < 0)
					throw invalidPicture(
						"The walks of the picture stand short of the file",
					);
				count = extra + 2;
				length = bits.tryReadBits(this.indexBits) ?? 0;
				if (0 === length) return false;
			}
			const place = this.index(bits, length);
			if (place >= indexSize) return false;
			if (count > left) return false;
			left -= count;
			const word = index[place] ?? 0;
			for (let step = 0; step < count; step += 1) {
				if (at + 1 < this.output.length) {
					this.output[at] = word & 0xff;
					this.output[at + 1] = (word >> 8) & 0xff;
				}
				at += 4;
			}
		}
		return true;
	}

	private streamAt = HEAD_SIZE;

	/** `WcgFormat.Reader.Unpack`: one walk of the picture, of the places of the file behind it. */
	private readStream(offset: number): boolean {
		if (this.nextSize < STREAM_HEAD_SIZE) {
			throw invalidPicture("The walks of the picture stand short of the file");
		}
		const source = this.nextPointer;
		this.streamAt = source;
		const unpackedSize = this.data.readInt32LE(source);
		const dataSize = this.data.readUInt32LE(source + 4);
		const indexSize = this.data.readUInt16LE(source + 8);
		if (unpackedSize !== this.pixels * 2) {
			throw invalidPicture(
				"The picture stands of another count of places than its head names",
			);
		}
		if (0 === indexSize || indexSize * 2 > this.nextSize - STREAM_HEAD_SIZE) {
			throw invalidPicture("The words of the picture stand short of the file");
		}
		if (dataSize > this.nextSize - STREAM_HEAD_SIZE - indexSize * 2) {
			throw invalidPicture("The walks of the picture stand short of the file");
		}
		const dataPosition = source + STREAM_HEAD_SIZE + indexSize * 2;
		this.nextPointer = dataPosition + dataSize;
		this.nextSize = this.nextSize - STREAM_HEAD_SIZE - indexSize * 2 - dataSize;
		this.indexLimit = indexSize < SMALL_INDEX ? 6 : 14;
		this.indexBits = indexSize < SMALL_INDEX ? 3 : 4;
		return this.decodeStream(dataPosition, indexSize, offset);
	}

	/** `WcgFormat.Reader.Unpack`. */
	unpack(): Buffer {
		if (this.readStream(2)) this.readStream(0);
		// The alpha of the places of the picture stands of the places of the file the other way round.
		for (let at = 3; at < this.output.length; at += 4) {
			this.output[at] = ~(this.output[at] ?? 0) & 0xff;
		}
		return this.output;
	}
}

/** `WcgFormat.Read`: the places of the picture, handed over as a bitmap of four places to a place. */
export function unpackWcgPicture(data: Buffer, layout: WcgLayout): Buffer {
	const pixels = layout.width * layout.height;
	return writeBmp32(
		layout.width,
		layout.height,
		new WcgReader(data, pixels).unpack(),
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const liarWcgImageDescriptor: FormatDescriptor = {
	id: "liar-wcg-image",
	name: "Liar-soft proprietary image",
	extensions: ["wcg"],
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
			source: "ArcFormats/Liar/ImageWCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const liarWcgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: liarWcgImageDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from([0x57, 0x47, 0x71, 0x02]) },
			{ bytes: Buffer.from([0x57, 0x47, 0x71, 0xf2]) },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readWcgLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readWcgLayout(await readStored(source));
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
					bitsPerPixel: 32,
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
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readWcgLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Liar-soft engine");
		return Readable.from([unpackWcgPicture(data, layout)]);
	},
});
