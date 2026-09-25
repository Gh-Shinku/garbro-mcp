// Port of GARbro "ArcFormats/Kaas/ImageKAAS.cs" (tag "PIC/KAAS", class PicFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. A picture of the engine of KAAS of three walks of
// the places of the file: the places of the control of them, the places of the file of the places of the
// picture and the places of the file of the counts and the places of the walks of the picture.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 0x12;
/** The walks of the places of the file of the engine. */
const MODES: readonly number[] = [5, 6, 8, 9];
const MAX_DIMENSION = 4096;
/** The count of the places of the file of the walk of a picture the walk of it stands of, of the count of
 * the places of the picture of it. */
const SLACK_SIZE = 96;
const COLOR_PLACES = 3;
/** The count of the places of the file of a count of the walk of the places of a picture. */
const NIBBLE_PLACES = 4;

/** `PicFormat.Reader.Unpack6`: the counts of the scramble of the places of a picture of the walk of them. */
export const KAAS_SCRAMBLE_TABLE: readonly number[] = [
	0x29, 0x23, 0xbe, 0x84, 0xe1, 0x6c, 0xd6, 0xae, 0x52, 0x90, 0x49, 0xf1, 0xf1,
	0xbb, 0xe9, 0xeb, 0xb3, 0xa6, 0xdb, 0x3c, 0x87, 0x0c, 0x3e, 0x99, 0x24, 0x5e,
	0x0d, 0x1c, 0x06, 0xb7, 0x47, 0xde, 0xb3, 0x12, 0x4d, 0xc8, 0x43, 0xbb, 0x8b,
	0xa6, 0x1f, 0x03, 0x5a, 0x7d, 0x09, 0x38, 0x25, 0x1f, 0x5d, 0xd4, 0xcb, 0xfc,
	0x96, 0xf5, 0x45, 0x3b, 0x13, 0x0d, 0x89, 0x0a, 0x1c, 0xdb, 0xae, 0x32, 0x20,
	0x9a, 0x50, 0xee, 0x40, 0x78, 0x36, 0xfd, 0x12, 0x49, 0x32, 0xf6, 0x9e, 0x7d,
	0x49, 0xdc, 0xad, 0x4f, 0x14, 0xf2, 0x44, 0x40, 0x66, 0xd0, 0x6b, 0xc4, 0x30,
	0xb7, 0x32, 0x3b, 0xa1, 0x22, 0xf6, 0x22, 0x91, 0x9d, 0xe1, 0x8b, 0x1f, 0xda,
	0xb0, 0xca, 0x99, 0x02, 0xb9, 0x72, 0x9d, 0x49, 0x2c, 0x80, 0x7e, 0xc5, 0x99,
	0xd5, 0xe9, 0x80, 0xb2, 0xea, 0xc9, 0xcc, 0x53, 0xbf, 0x67, 0xd6, 0xbf, 0x14,
	0xd6, 0x7e, 0x2d, 0xdc, 0x8e, 0x66, 0x83, 0xef, 0x57, 0x49, 0x61, 0xff, 0x69,
	0x8f, 0x61, 0xcd, 0xd1, 0x1e, 0x9d, 0x9c, 0x16, 0x72, 0x72, 0xe6, 0x1d, 0xf0,
	0x84, 0x4f, 0x4a, 0x77, 0x02, 0xd7, 0xe8, 0x39, 0x2c, 0x53, 0xcb, 0xc9, 0x12,
	0x1e, 0x33, 0x74, 0x9e, 0x0c, 0xf4, 0xd5, 0xd4, 0x9f, 0xd4, 0xa4, 0x59, 0x7e,
	0x35, 0xcf, 0x32, 0x22, 0xf4, 0xcc, 0xcf, 0xd3, 0x90, 0x2d, 0x48, 0xd3, 0x8f,
	0x75, 0xe6, 0xd9, 0x1d, 0x2a, 0xe5, 0xc0, 0xf7, 0x2b, 0x78, 0x81, 0x87, 0x44,
	0x0e, 0x5f, 0x50, 0x00, 0xd4, 0x61, 0x8d, 0xbe, 0x7b, 0x05, 0x15, 0x07, 0x3b,
	0x33, 0x82, 0x1f, 0x18, 0x70, 0x92, 0xda, 0x64, 0x54, 0xce, 0xb1, 0x85, 0x3e,
	0x69, 0x15, 0xf8, 0x46, 0x6a, 0x04, 0x96, 0x73, 0x0e, 0xd9, 0x16, 0x2f, 0x67,
	0x68, 0xd4, 0xf7, 0x4a, 0x4a, 0xd0, 0x57, 0x68, 0x76, 0xfa, 0x16, 0xbb, 0x11,
	0xad, 0xae, 0x24, 0x88, 0x79, 0xfe, 0x52, 0xdb, 0x25, 0x43, 0xe5, 0x3c, 0xf4,
	0x45, 0xd3, 0xd8, 0x28, 0xce, 0x0b, 0xf5, 0xc5, 0x60, 0x59, 0x3d, 0x97, 0x27,
	0x8a, 0x59, 0x76, 0x2d, 0xd0, 0xc2, 0xc9, 0xcd, 0x68, 0xd4, 0x49, 0x6a, 0x79,
	0x25, 0x08, 0x61, 0x40, 0x14, 0xb1, 0x3b, 0x6a, 0xa5, 0x11, 0x28, 0xc1, 0x8c,
	0xd6, 0xa9, 0x0b, 0x87, 0x97, 0x8c, 0x2f, 0xf1,
];

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface KaasPicLayout {
	mode: number;
	key: number;
	width: number;
	height: number;
	compSize1: number;
	compSize2: number;
	compSize3: number;
}

/** `PicFormat.ReadMetaData`. */
export function readKaasPicLayout(data: Buffer): KaasPicLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	const mode = data[0] ?? 0;
	if (!MODES.includes(mode)) return undefined;
	const width = data.readUInt16LE(2);
	const height = data.readUInt16LE(4);
	if (0 === width || width > MAX_DIMENSION) return undefined;
	if (0 === height || height > MAX_DIMENSION) return undefined;
	const compSize1 = data.readUInt32LE(8);
	const compSize2 = data.readUInt32LE(12);
	const compSize3 = data.length - (HEAD_SIZE + compSize1 + compSize2);
	if (compSize3 < 0) return undefined;
	if (
		compSize1 >= data.length ||
		compSize2 >= data.length ||
		compSize3 >= data.length
	) {
		return undefined;
	}
	return {
		mode,
		key: data[1] ?? 0,
		width,
		height,
		compSize1,
		compSize2,
		compSize3,
	};
}

/**
 * `PicFormat.Reader`: the walks of the places of the file of a picture, of the places of the control of
 * them, of the places of the file of the places of the picture and of the places of the file of the counts
 * of them and of the places of the walks of the picture.
 */
class KaasPicReader {
	private readonly control: Buffer;
	private readonly data: Buffer;
	private readonly counts: Buffer;

	constructor(
		private readonly output: Buffer,
		input: Buffer,
		layout: KaasPicLayout,
	) {
		let at = HEAD_SIZE;
		this.control = input.subarray(at, at + layout.compSize1);
		at += layout.compSize1;
		this.data = input.subarray(at, at + layout.compSize2);
		at += layout.compSize2;
		this.counts = input.subarray(at, at + layout.compSize3);
	}

	/** One place of the file of a walk, of the places of the file of it. */
	private place(stream: Buffer, at: number, what: string): number {
		if (at >= stream.length) {
			throw invalidPicture(
				`The places of the file of ${what} stand short of the file`,
			);
		}
		return stream[at] ?? 0;
	}

	/** `Binary.CopyOverlapped` of the walk of the places of a picture, of the places of the file of it. */
	private copy(source: number, destination: number, count: number): void {
		if (source < 0) {
			throw invalidPicture(
				"The places of the walk of the picture stand behind the places of the file",
			);
		}
		if (!copyOverlapped(this.output, source, destination, count)) {
			throw invalidPicture(
				"The places of the walk of the picture stand beyond the picture",
			);
		}
	}

	/** `PicFormat.Reader.Unpack5`: the walk of the places of the file of a picture of the walk of five. */
	unpack5(): void {
		const control = this.control;
		const data = this.data;
		const counts = this.counts;
		let read0 = 0;
		let read1 = 0;
		let read2 = 0;
		let at = 0;
		let bits = 1;
		for (;;) {
			if (1 === bits) {
				if (read0 === control.length) break;
				bits = (control[read0] ?? 0) | 0x100;
				read0 += 1;
			}
			const type = bits & 3;
			bits >>= 2;
			if (0 === type) {
				if (at >= this.output.length) {
					throw invalidPicture(
						"The places of the walk of the picture stand beyond the picture",
					);
				}
				this.output[at] = this.place(data, read1, "the places of the picture");
				at += 1;
				read1 += 1;
				continue;
			}
			let count: number;
			let offset: number;
			if (1 === type) {
				count =
					((this.place(counts, read2 >> 1, "the counts of the walk") >>
						(NIBBLE_PLACES * (read2 & 1))) &
						0x0f) +
					2;
				read2 += 1;
				offset = this.place(data, read1, "the places of the picture") + 2;
				read1 += 1;
			} else if (2 === type) {
				const code =
					this.place(data, read1, "the places of the picture") |
					(this.place(data, read1 + 1, "the places of the picture") << 8);
				read1 += 2;
				if (0 === code) break;
				offset = (code & 0x0fff) + 2;
				count = (code >> 12) + 2;
			} else {
				offset =
					(((this.place(counts, read2 >> 1, "the counts of the walk") <<
						(NIBBLE_PLACES * (2 - (read2 & 1)))) &
						0x0f00) |
						this.place(data, read1, "the places of the picture")) +
					2;
				count = this.place(data, read1 + 1, "the places of the picture") + 18;
				read2 += 1;
				read1 += 2;
			}
			this.copy(at - offset, at, count);
			at += count;
		}
	}

	/** `PicFormat.Reader.Unpack6`: the counts of the scramble of the places of a picture of no walk. */
	unpack6(key: number): void {
		const base = key & 0x3f;
		for (let at = 0; at < this.output.length; at += 1) {
			this.output[at] =
				((this.output[at] ?? 0) -
					(KAAS_SCRAMBLE_TABLE[base + (at & 0xff)] ?? 0)) &
				0xff;
		}
	}

	/** The walk of the places of the file of a picture of the walks of eight and nine places to a count. */
	private unpackRun(type: number): number {
		const data = this.data;
		const counts = this.counts;
		if (1 === type) {
			const code =
				this.place(data, this.read1, "the places of the picture") +
				((this.place(counts, this.read2 >> 1, "the counts of the walk") <<
					(NIBBLE_PLACES * (2 - (this.read2 & 1)))) &
					0x0f00);
			this.read1 += 1;
			this.read2 += 1;
			this.count = ((code >> 10) + 1) * COLOR_PLACES;
			this.offset = ((code & 0x03ff) + 1) * COLOR_PLACES;
			return -1;
		}
		if (2 === type) {
			const code =
				this.place(data, this.read1, "the places of the picture") |
				(this.place(data, this.read1 + 1, "the places of the picture") << 8);
			this.read1 += 2;
			this.count = ((code >> 14) + 1) * COLOR_PLACES;
			this.offset = ((code & 0x3fff) + 1) * COLOR_PLACES;
			return -1;
		}
		const code =
			((this.place(counts, this.read2 >> 1, "the counts of the walk") <<
				(NIBBLE_PLACES * (4 - (this.read2 & 1)))) &
				0xf0000) |
			this.place(data, this.read1, "the places of the picture") |
			(this.place(data, this.read1 + 1, "the places of the picture") << 8);
		if (0 === code) return 0;
		this.read1 += 2;
		this.read2 += 1;
		this.count = ((code >> 14) + 5) * COLOR_PLACES;
		this.offset = ((code & 0x3fff) + 1) * COLOR_PLACES;
		return -1;
	}

	private read1 = 0;
	private read2 = 0;
	private count = 0;
	private offset = 0;

	/** `PicFormat.Reader.Unpack8`: the walk of the places of the file of a picture of the walk of eight. */
	unpack8(): void {
		let read0 = 0;
		let at = 0;
		for (;;) {
			const type = ((this.control[read0 >> 3] ?? 0) >> (read0 & 6)) & 3;
			read0 += 2;
			if (0 === type) {
				for (let place = 0; place < COLOR_PLACES; place += 1) {
					if (at >= this.output.length) {
						throw invalidPicture(
							"The places of the walk of the picture stand beyond the picture",
						);
					}
					this.output[at] = this.place(
						this.data,
						this.read1,
						"the places of the picture",
					);
					at += 1;
					this.read1 += 1;
				}
				continue;
			}
			if (0 === this.unpackRun(type)) break;
			this.copy(at - this.offset, at, this.count);
			at += this.count;
		}
	}

	/** `PicFormat.Reader.Unpack9`: the walk of the places of the file of a picture of the walk of nine. */
	unpack9(): void {
		let read0 = 0;
		let at = 0;
		for (;;) {
			const type = ((this.control[read0 >> 3] ?? 0) >> (read0 & 6)) & 3;
			read0 += 2;
			if (0 === type) {
				const places =
					(((this.control[read0 >> 3] ?? 0) >> (read0 & 6)) & 3) + 1;
				read0 += 2;
				const count = places * COLOR_PLACES;
				for (let place = 0; place < count; place += 1) {
					if (at >= this.output.length) {
						throw invalidPicture(
							"The places of the walk of the picture stand beyond the picture",
						);
					}
					this.output[at] = this.place(
						this.data,
						this.read1,
						"the places of the picture",
					);
					at += 1;
					this.read1 += 1;
				}
				continue;
			}
			if (0 === this.unpackRun(type)) break;
			this.copy(at - this.offset, at, this.count);
			at += this.count;
		}
	}
}

/** `PicFormat.Read`: the places of the picture, handed over as a bitmap. */
export function unpackKaasPic(data: Buffer, layout: KaasPicLayout): Buffer {
	const picture = layout.width * layout.height * COLOR_PLACES;
	const size =
		6 === layout.mode ? picture : picture + SLACK_SIZE * COLOR_PLACES;
	const output: Buffer = Buffer.alloc(size, 0x00);
	const reader = new KaasPicReader(output, data, layout);
	if (6 === layout.mode) {
		const stored = data.subarray(HEAD_SIZE, HEAD_SIZE + picture);
		if (stored.length !== picture) {
			throw invalidPicture("The places of the picture stand short of the file");
		}
		stored.copy(output, 0);
		reader.unpack6(layout.key);
	} else if (5 === layout.mode) {
		reader.unpack5();
	} else if (8 === layout.mode) {
		reader.unpack8();
	} else {
		reader.unpack9();
	}
	return writeBmp24(layout.width, layout.height, output.subarray(0, picture));
}

export const kaasPicImageDescriptor: FormatDescriptor = {
	id: "kaas-pic-image",
	name: "KAAS engine image",
	extensions: [],
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
			source: "ArcFormats/Kaas/ImageKAAS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const kaasPicImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaasPicImageDescriptor,
	// The reference stands of no mark of its own: the places of the file of the head of the picture are
	// what decides.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readKaasPicLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readKaasPicLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the KAAS engine");
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
					bitsPerPixel: 24,
					mode: layout.mode,
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
				bitsPerPixel: 24,
				mode: layout.mode,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readKaasPicLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the KAAS engine");
		return Readable.from([unpackKaasPic(data, layout)]);
	},
});
