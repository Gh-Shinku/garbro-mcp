// Port of GARbro "ArcFormats/Dac/ImageDGC.cs" (tag "DGC", classes DgcFormat, DgcFormat.Reader), GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A DGC picture is a table of rows, every
// row standing either of a walk of its own, of a row before it, or of the places of the file itself.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { copyOverlapped } from "../shared/copy.js";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("DGC\0", "latin1");
const HEAD_SIZE = 12;
const FLAG_ALPHA = 0x4000000;
const FLAG_DICT = 0x2000000;
const DICT_MASK = 0xffffff;
const LARGE_DICT = 0x100;

export interface DgcLayout {
	flags: number;
	width: number;
	height: number;
	hasAlpha: boolean;
	useDictionary: boolean;
	maxDictionarySize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `DgcFormat.ReadMetaData`. */
export function readDgcLayout(data: Buffer): DgcLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const flags = data.readUInt32LE(4);
	const width = data.readUInt16LE(8);
	const height = data.readUInt16LE(10);
	if (0 === width || 0 === height || width > 0x7fff || height > 0x7fff) {
		return undefined;
	}
	return {
		flags,
		width,
		height,
		hasAlpha: 0 !== (flags & FLAG_ALPHA),
		useDictionary: 0 !== (flags & FLAG_DICT),
		maxDictionarySize: flags & DICT_MASK,
	};
}

/** `DgcFormat.Reader`: the places of a picture, of the rows of it. */
class DgcReader {
	private at = HEAD_SIZE;
	private readonly output: Buffer;
	private readonly pixelSize: number;
	private readonly stride: number;

	constructor(
		private readonly data: Buffer,
		private readonly layout: DgcLayout,
	) {
		this.pixelSize = layout.hasAlpha ? 4 : 3;
		this.stride = layout.width * this.pixelSize;
		this.output = Buffer.alloc(this.stride * layout.height, 0x00);
	}

	private byte(): number {
		if (this.at + 1 > this.data.length) {
			throw invalidPicture("The walks of the picture stand short of the file");
		}
		const value = this.data[this.at] ?? 0;
		this.at += 1;
		return value;
	}

	private short(): number {
		if (this.at + 2 > this.data.length) {
			throw invalidPicture("The walks of the picture stand short of the file");
		}
		const value = this.data.readInt16LE(this.at);
		this.at += 2;
		return value;
	}

	private word(): number {
		if (this.at + 2 > this.data.length) {
			throw invalidPicture("The walks of the picture stand short of the file");
		}
		const value = this.data.readUInt16LE(this.at);
		this.at += 2;
		return value;
	}

	/** The places of a row standing as they stand. */
	private literalRow(
		destination: number,
		dictionary: Buffer,
		words: boolean,
	): void {
		for (let place = 0; place < this.layout.width; place += 1) {
			const index = 3 * (words ? this.word() : this.byte() & 0xff);
			this.output[destination] = dictionary[index] ?? 0;
			this.output[destination + 1] = dictionary[index + 1] ?? 0;
			this.output[destination + 2] = dictionary[index + 2] ?? 0;
			destination += this.pixelSize;
		}
	}

	/** `UnpackLZ`: the rows of a picture standing of the walks of the file itself. */
	private unpackLz(): void {
		for (let row = 0; row < this.layout.height; row += 1) {
			let destination = row * this.stride;
			const length = this.short();
			if (length > 0) {
				this.lineLz(destination, length);
			} else if (length < 0) {
				this.copyRow(destination, row + length);
			} else {
				for (let place = 0; place < this.layout.width; place += 1) {
					this.output[destination] = this.byte() & 0xff;
					this.output[destination + 1] = this.byte() & 0xff;
					this.output[destination + 2] = this.byte() & 0xff;
					destination += this.pixelSize;
				}
			}
		}
	}

	/** A row standing of the places of a row before it. */
	private copyRow(destination: number, source: number): void {
		if (source < 0) {
			throw invalidPicture("A row of the picture stands of no row before it");
		}
		const from = source * this.stride;
		for (let place = 0; place < this.stride; place += 1) {
			this.output[destination + place] = this.output[from + place] ?? 0;
		}
	}

	/** `UnpackLineLZ`: the walk of a row of a picture of the places of the file itself. */
	private lineLz(destination: number, length: number): void {
		let left = length;
		while (left > 0) {
			const control = this.short();
			left -= 2;
			if (0 !== (control & 0x8000)) {
				const count = (control & 0x3f) + 1;
				const offset = (control >> 6) * this.pixelSize;
				for (let step = 0; step < count; step += 1) {
					this.output[destination] = this.output[destination + offset] ?? 0;
					this.output[destination + 1] =
						this.output[destination + offset + 1] ?? 0;
					this.output[destination + 2] =
						this.output[destination + offset + 2] ?? 0;
					destination += this.pixelSize;
				}
			} else {
				let count = control & 0x1fff;
				if (0 !== (control & 0x4000)) {
					this.output[destination] = this.byte() & 0xff;
					this.output[destination + 1] = this.byte() & 0xff;
					this.output[destination + 2] = this.byte() & 0xff;
					left -= 3;
					destination += this.pixelSize;
					count -= 1;
					if (count > 0) {
						const places = count * this.pixelSize;
						copyOverlapped(
							this.output,
							destination - this.pixelSize,
							destination,
							places,
						);
						destination += places;
					}
				} else {
					while (0 !== count) {
						count -= 1;
						this.output[destination] = this.byte() & 0xff;
						this.output[destination + 1] = this.byte() & 0xff;
						this.output[destination + 2] = this.byte() & 0xff;
						left -= 3;
						destination += this.pixelSize;
					}
				}
			}
		}
	}

	/** `UnpackLine8`: the walk of a row of a picture of a small colour table. */
	private lineSmall(
		destination: number,
		length: number,
		dictionary: Buffer,
	): void {
		let left = length;
		while (left > 0) {
			let control = this.byte() & 0xff;
			left -= 1;
			if (0 !== control) {
				const index = 3 * (this.byte() & 0xff);
				left -= 1;
				while (0 !== control) {
					control -= 1;
					this.output[destination] = dictionary[index] ?? 0;
					this.output[destination + 1] = dictionary[index + 1] ?? 0;
					this.output[destination + 2] = dictionary[index + 2] ?? 0;
					destination += this.pixelSize;
				}
			} else {
				control = this.byte() & 0xff;
				left -= 1;
				if (0 === (control & 0x80)) {
					let count = control + 2;
					while (0 !== count) {
						count -= 1;
						const index = 3 * (this.byte() & 0xff);
						left -= 1;
						this.output[destination] = dictionary[index] ?? 0;
						this.output[destination + 1] = dictionary[index + 1] ?? 0;
						this.output[destination + 2] = dictionary[index + 2] ?? 0;
						destination += this.pixelSize;
					}
				} else {
					let offset = ((control << 8) | (this.byte() & 0xff)) & 0xffff;
					left -= 1;
					if (offset >= 0x8000) offset -= 0x10000;
					const count = ((offset & 0x3f) + 4) * this.pixelSize;
					offset = (offset >> 6) * this.pixelSize;
					copyOverlapped(this.output, destination + offset, destination, count);
					destination += count;
				}
			}
		}
	}

	/** `UnpackLine16`: the walk of a row of a picture of a colour table of its own. */
	private lineLarge(
		destination: number,
		length: number,
		dictionary: Buffer,
		words: boolean,
	): void {
		let left = length;
		const indexAt = (): number => {
			if (words) {
				const value = this.word();
				left -= 2;
				return value;
			}
			const value = this.byte() & 0xff;
			left -= 1;
			return value;
		};
		while (left > 0) {
			const control = this.short();
			left -= 2;
			if (0 !== (control & 0x8000)) {
				const count = (control & 0x3f) + 2;
				const places = count * this.pixelSize;
				const offset = (control >> 6) * this.pixelSize;
				copyOverlapped(this.output, destination + offset, destination, places);
				destination += places;
			} else {
				let count = control & 0x1fff;
				if (0 !== (control & 0x4000)) {
					const index = 3 * indexAt();
					while (0 !== count) {
						count -= 1;
						this.output[destination] = dictionary[index] ?? 0;
						this.output[destination + 1] = dictionary[index + 1] ?? 0;
						this.output[destination + 2] = dictionary[index + 2] ?? 0;
						destination += this.pixelSize;
					}
				} else {
					while (0 !== count) {
						count -= 1;
						const index = 3 * indexAt();
						this.output[destination] = dictionary[index] ?? 0;
						this.output[destination + 1] = dictionary[index + 1] ?? 0;
						this.output[destination + 2] = dictionary[index + 2] ?? 0;
						destination += this.pixelSize;
					}
				}
			}
		}
	}

	/** `UnpackWithDictSmall`: the rows of a picture of a small colour table. */
	private unpackSmall(): void {
		const dictionary: Buffer = Buffer.alloc(
			this.layout.maxDictionarySize * 3,
			0x00,
		);
		const length = (this.byte() & 0xff) + 1;
		const places = Math.min(length, this.layout.maxDictionarySize) * 3;
		this.data.copy(dictionary, 0, this.at, this.at + places);
		this.at += places;
		for (let row = 0; row < this.layout.height; row += 1) {
			const destination = row * this.stride;
			const size = this.short();
			if (size > 0) {
				this.lineSmall(destination, size, dictionary);
			} else if (size < 0) {
				this.copyRow(destination, row + size);
			} else {
				this.literalRow(destination, dictionary, false);
			}
		}
	}

	/** `UnpackWithDictLarge`: the rows of a picture of a colour table of its own, of every group of rows. */
	private unpackLarge(): void {
		const dictionary: Buffer = Buffer.alloc(
			this.layout.maxDictionarySize * 3,
			0x00,
		);
		let row = 0;
		while (row < this.layout.height) {
			const length = this.word() + 1;
			const places = Math.min(length, this.layout.maxDictionarySize) * 3;
			this.data.copy(dictionary, 0, this.at, this.at + places);
			this.at += places;
			const end = this.word();
			// The reference stands of the rows of a group for ever where the group names no rows of its own.
			if (end <= row) {
				throw invalidPicture(
					"The colour table of the picture names no rows of its own",
				);
			}
			for (; row < end; row += 1) {
				const destination = row * this.stride;
				const size = this.short();
				if (size > 0) {
					if (length > LARGE_DICT) {
						this.lineLarge(destination, size, dictionary, true);
					} else {
						this.lineSmall(destination, size, dictionary);
					}
				} else if (size < 0) {
					this.copyRow(destination, row + size);
				} else {
					this.literalRow(destination, dictionary, length > LARGE_DICT);
				}
			}
		}
	}

	/** `UnpackAlphaChannel`: the alpha of the places of the picture, behind the places of it. */
	private unpackAlpha(): void {
		for (let row = 0; row < this.layout.height; row += 1) {
			let destination = 3 + row * this.stride;
			const size = this.short();
			if (size > 0) {
				this.lineAlpha(destination, size);
			} else if (size < 0) {
				if (row + size < 0) {
					throw invalidPicture(
						"A row of the picture stands of no row before it",
					);
				}
				let source = 3 + (row + size) * this.stride;
				for (let place = 0; place < this.layout.width; place += 1) {
					this.output[destination] = this.output[source] ?? 0;
					destination += this.pixelSize;
					source += this.pixelSize;
				}
			} else {
				for (let place = 0; place < this.layout.width; place += 1) {
					this.output[destination] = this.byte() & 0xff;
					destination += this.pixelSize;
				}
			}
		}
	}

	/** `UnpackLineAlpha`: the walk of the alpha of a row of a picture. */
	private lineAlpha(destination: number, length: number): void {
		let left = length;
		while (left > 0) {
			let control = this.byte() & 0xff;
			left -= 1;
			if (0 !== control) {
				const alpha = this.byte() & 0xff;
				left -= 1;
				while (0 !== control) {
					control -= 1;
					this.output[destination] = alpha;
					destination += this.pixelSize;
				}
			} else {
				control = this.byte() & 0xff;
				left -= 1;
				if (0 === (control & 0x80)) {
					let count = control + 2;
					left -= count;
					while (0 !== count) {
						count -= 1;
						this.output[destination] = this.byte() & 0xff;
						destination += this.pixelSize;
					}
				} else {
					let offset = ((control << 8) | (this.byte() & 0xff)) & 0xffff;
					left -= 1;
					if (offset >= 0x8000) offset -= 0x10000;
					// The reference names the places of the alpha of the places of a row here without the
					// places of a place of the picture, so the walks of the alpha of a picture of four
					// places to a place stand of another walk than the walks of the colours of it.
					let count = (offset & 0x3f) + 4;
					offset >>= 6;
					while (0 !== count) {
						count -= 1;
						this.output[destination] = this.output[destination + offset] ?? 0;
						destination += this.pixelSize;
					}
				}
			}
		}
	}

	unpack(): Buffer {
		if (!this.layout.useDictionary) {
			this.unpackLz();
		} else if (this.layout.maxDictionarySize > LARGE_DICT) {
			this.unpackLarge();
		} else {
			this.unpackSmall();
		}
		if (this.layout.hasAlpha) this.unpackAlpha();
		return this.output;
	}
}

/** `DgcFormat.Read`: the places of the picture, handed over as a bitmap. */
export function unpackDgcPicture(data: Buffer, layout: DgcLayout): Buffer {
	const pixels = new DgcReader(data, layout).unpack();
	return layout.hasAlpha
		? writeBmp32(layout.width, layout.height, pixels)
		: writeBmp24(layout.width, layout.height, pixels);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const dacDgcImageDescriptor: FormatDescriptor = {
	id: "dac-dgc-image",
	name: "DAC engine image",
	extensions: ["dgc"],
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
			source: "ArcFormats/Dac/ImageDGC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dacDgcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dacDgcImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readDgcLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readDgcLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the DAC engine");
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
					bitsPerPixel: layout.hasAlpha ? 32 : 24,
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
				bitsPerPixel: layout.hasAlpha ? 32 : 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readDgcLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the DAC engine");
		return Readable.from([unpackDgcPicture(data, layout)]);
	},
});
