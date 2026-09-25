// Port of GARbro "ArcFormats/ShiinaRio/ImageS25.cs" (tag "S25", classes S25Format, S25Format.Reader),
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The picture of a file of several
// frames is the first frame; the frames of the file stand of the archive of the same engine.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("S25\0", "latin1");
const HEAD_SIZE = 0x14;
const MAX_FRAMES = 0xfffff;
/** The head of a frame stands of its measurements, of where it stands and of the kind of its walk. */
const FRAME_HEAD_SIZE = 0x14;
const INCREMENTAL = 0x80000000;

export interface S25Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	incremental: boolean;
	/** Where the rows of the picture stand. */
	rowsAt: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `S25Format.ReadMetaData`: the head of the first frame of the file. */
export function readS25Layout(data: Buffer): S25Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, 3).equals(MARK.subarray(0, 3))) return undefined;
	if (0x00 !== (data[3] ?? 0xff)) return undefined;
	const count = data.readInt32LE(4);
	if (count < 0 || count > MAX_FRAMES) return undefined;
	let firstOffset = 0;
	for (let at = 0; at < count && 0 === firstOffset; at += 1) {
		const place = 8 + at * 4;
		if (place + 4 > data.length) break;
		firstOffset = data.readUInt32LE(place);
	}
	if (0 === firstOffset || firstOffset + FRAME_HEAD_SIZE > data.length) {
		return undefined;
	}
	const width = data.readUInt32LE(firstOffset);
	const height = data.readUInt32LE(firstOffset + 4);
	// The reference reads the measurements of the frame without asking after them; a picture of no
	// places of its own stands of no picture at all.
	if (0 === width || 0 === height) return undefined;
	return {
		width,
		height,
		offsetX: data.readInt32LE(firstOffset + 8),
		offsetY: data.readInt32LE(firstOffset + 0xc),
		incremental: 0 !== (data.readUInt32LE(firstOffset + 0x10) & INCREMENTAL),
		rowsAt: firstOffset + FRAME_HEAD_SIZE,
	};
}

/** The rows of a frame, of the places of the file and of the walks of them. */
class S25Reader {
	private readonly data: Buffer;
	private readonly layout: S25Layout;
	private readonly output: Buffer;

	constructor(data: Buffer, layout: S25Layout) {
		this.data = data;
		this.layout = layout;
		this.output = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	}

	/** `Reader.Unpack`: the places of the picture, of the first frame of the file. */
	unpack(): Buffer {
		if (!this.layout.incremental) {
			const rows = this.rowTable(this.layout.rowsAt, this.layout.height);
			let at = 0;
			for (let row = 0; row < this.layout.height; row += 1) {
				const line = this.readRow(rows[row] ?? 0);
				at = this.unpackLine(line, at);
			}
			return this.output;
		}
		return this.unpackIncremental();
	}

	/** The places of the rows of a frame, of the count of the rows of it. */
	private rowTable(at: number, count: number): number[] {
		const rows: number[] = [];
		for (let row = 0; row < count; row += 1) {
			if (at + row * 4 + 4 > this.data.length) {
				throw invalidPicture("The rows of the picture stand short of the file");
			}
			rows.push(this.data.readUInt32LE(at + row * 4));
		}
		return rows;
	}

	/**
	 * `Reader.UpdateRepeatCount`: the frames of the file behind the frame of the picture stand of the rows
	 * of it as well, and a row of the walks of the engine stands of the count of them.
	 */
	private repeatCounts(rows: number[]): Map<number, number> {
		const counts = new Map<number, number>();
		for (const offset of rows)
			counts.set(offset, (counts.get(offset) ?? 0) + 1);
		const count = this.data.readInt32LE(4);
		const frames: number[] = [];
		for (let at = 0; at < count; at += 1) {
			const place = 8 + at * 4;
			if (place + 4 > this.data.length) break;
			const offset = this.data.readUInt32LE(place);
			if (0 !== offset) frames.push(offset);
		}
		for (const offset of frames) {
			if (offset + FRAME_HEAD_SIZE === this.layout.rowsAt) continue;
			if (offset + 8 > this.data.length) continue;
			const height = this.data.readInt32LE(offset + 4);
			if (
				height <= 0 ||
				offset + FRAME_HEAD_SIZE + height * 4 > this.data.length
			) {
				continue;
			}
			const table = this.rowTable(offset + FRAME_HEAD_SIZE, height);
			for (const place of table) {
				const known = counts.get(place);
				if (undefined !== known) counts.set(place, known + 1);
			}
		}
		return counts;
	}

	/** `Reader.UnpackIncremental`: the rows of the picture standing of one another. */
	private unpackIncremental(): Buffer {
		const rows = this.rowTable(this.layout.rowsAt, this.layout.height);
		const counts = this.repeatCounts(rows);
		const known = new Map<number, Buffer>();
		const lines: Buffer[] = [];
		for (let row = 0; row < this.layout.height; row += 1) {
			const offset = rows[row] ?? 0;
			const seen = known.get(offset);
			if (seen) {
				lines.push(seen);
				continue;
			}
			const line = this.readLine(offset, counts.get(offset) ?? 1);
			known.set(offset, line);
			lines.push(line);
		}
		let at = 0;
		for (let row = 0; row < this.layout.height; row += 1) {
			at = this.unpackLine(lines[row] ?? Buffer.alloc(0), at);
		}
		return this.output;
	}

	/**
	 * `Reader.Unpack`: the places of a row of a picture whose rows stand as they stand. The walks of a row
	 * of an odd place of the file stand of one place of their own.
	 */
	private readRow(offset: number): Buffer {
		if (offset + 2 > this.data.length) {
			throw invalidPicture("The rows of the picture stand short of the file");
		}
		let length = this.data.readUInt16LE(offset);
		let at = offset + 2;
		if (0 !== (at & 1)) {
			at += 1;
			length -= 1;
		}
		if (length < 0 || at + length > this.data.length) {
			throw invalidPicture("The rows of the picture stand short of the file");
		}
		return Buffer.from(this.data.subarray(at, at + length));
	}

	/** `Reader.ReadLine`: the places of a row, of the walks of the engine behind them. */
	private readLine(offset: number, repeat: number): Buffer {
		if (offset + 2 > this.data.length) {
			throw invalidPicture("The rows of the picture stand short of the file");
		}
		let length = this.data.readUInt16LE(offset);
		// The walks of a row stand of a place of their own where the row stands of a place of the file
		// of an odd count: the reference reads a place of the row and stands of one place less.
		let at = offset + 2;
		if (0 !== (offset & 1)) {
			at += 1;
			length -= 1;
		}
		if (at + length > this.data.length) {
			throw invalidPicture("The rows of the picture stand short of the file");
		}
		const line = Buffer.from(this.data.subarray(at, at + length));
		let place = 0;
		for (let left = this.layout.width; left > 0; ) {
			if (0 !== (place & 1)) place += 1;
			if (place + 2 > line.length) break;
			let count = line.readUInt16LE(place);
			place += 2;
			const method = count >> 13;
			const skip = (count >> 11) & 3;
			if (0 !== skip) place += skip;
			count &= 0x7ff;
			if (0 === count) {
				if (place + 4 > line.length) break;
				count = line.readInt32LE(place);
				place += 4;
			}
			if (count < 0 || count > left) count = left;
			left -= count;
			if (2 === method) {
				for (let pass = 0; pass < repeat; pass += 1) {
					for (
						let step = 3;
						step < count * 3 && place + step < line.length;
						step += 1
					) {
						line[place + step] =
							(line[place + step] ?? 0) + (line[place + step - 3] ?? 0);
					}
				}
				place += count * 3;
			} else if (3 === method) {
				place += 3;
			} else if (4 === method) {
				for (let pass = 0; pass < repeat; pass += 1) {
					for (
						let step = 4;
						step < count * 4 && place + step < line.length;
						step += 1
					) {
						line[place + step] =
							(line[place + step] ?? 0) + (line[place + step - 4] ?? 0);
					}
				}
				place += count * 4;
			} else if (5 === method) {
				place += 4;
			}
		}
		return line;
	}

	/** `Reader.UnpackLine`: the places of a row of the picture, of the walks of the row. */
	private unpackLine(line: Buffer, at: number): number {
		let destination = at;
		let place = 0;
		const step = (): number => {
			const value = line[place] ?? 0;
			place += 1;
			return value;
		};
		for (
			let left = this.layout.width;
			left > 0 && destination < this.output.length && place < line.length;
		) {
			if (0 !== (place & 1)) place += 1;
			let count = (line[place] ?? 0) | ((line[place + 1] ?? 0) << 8);
			place += 2;
			const method = count >> 13;
			const skip = (count >> 11) & 3;
			if (0 !== skip) place += skip;
			count &= 0x7ff;
			if (0 === count) {
				if (place + 4 > line.length) break;
				count = line.readInt32LE(place);
				place += 4;
			}
			if (count > left) count = left;
			left -= count;
			if (2 === method) {
				for (
					let stepAt = 0;
					stepAt < count && place < line.length;
					stepAt += 1
				) {
					this.output[destination] = step();
					this.output[destination + 1] = step();
					this.output[destination + 2] = step();
					this.output[destination + 3] = 0xff;
					destination += 4;
				}
			} else if (3 === method) {
				const blue = step();
				const green = step();
				const red = step();
				for (let stepAt = 0; stepAt < count; stepAt += 1) {
					this.output[destination] = blue;
					this.output[destination + 1] = green;
					this.output[destination + 2] = red;
					this.output[destination + 3] = 0xff;
					destination += 4;
				}
			} else if (4 === method) {
				for (
					let stepAt = 0;
					stepAt < count && place < line.length;
					stepAt += 1
				) {
					const alpha = step();
					this.output[destination] = step();
					this.output[destination + 1] = step();
					this.output[destination + 2] = step();
					this.output[destination + 3] = alpha;
					destination += 4;
				}
			} else if (5 === method) {
				const alpha = step();
				const blue = step();
				const green = step();
				const red = step();
				for (let stepAt = 0; stepAt < count; stepAt += 1) {
					this.output[destination] = blue;
					this.output[destination + 1] = green;
					this.output[destination + 2] = red;
					this.output[destination + 3] = alpha;
					destination += 4;
				}
			} else {
				destination += count * 4;
			}
		}
		return destination;
	}
}

/** `S25Format.Read`: the places of the picture, handed over as a bitmap of four places to a place. */
export function unpackS25Picture(data: Buffer, layout: S25Layout): Buffer {
	const picture = new S25Reader(data, layout).unpack();
	return writeBmp32(layout.width, layout.height, picture);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const shiinaRioS25ImageDescriptor: FormatDescriptor = {
	id: "shiina-rio-s25-image",
	name: "ShiinaRio image",
	extensions: ["s25"],
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
			source: "ArcFormats/ShiinaRio/ImageS25.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const shiinaRioS25ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: shiinaRioS25ImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("S25\0", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readS25Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readS25Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the ShiinaRio engine");
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
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					incremental: layout.incremental,
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
		const layout = readS25Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the ShiinaRio engine");
		return Readable.from([unpackS25Picture(data, layout)]);
	},
});
