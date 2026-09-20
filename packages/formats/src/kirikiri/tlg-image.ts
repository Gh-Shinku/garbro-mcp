// Format reference: GARbro "ArcFormats/KiriKiri/ImageTLG.cs", classes `TlgFormat`, `TlgMetaData` and the
// walk of the places of the picture of the fifth kind of the places of the picture (`ReadV5`,
// `TVPTLG5DecompressSlide`, `TVPTLG5ComposeColors3To4` and `TVPTLG5ComposeColors4To4`). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The places of the picture of the words of the head of a picture of this kind. */
const HEAD_SIZE = 0x26;
const PREFIX_SIZE = 0x0f;
const PREFIX = Buffer.from("TLG0.0\0sds\x1a", "latin1");
const RAW_MARK = Buffer.from([0x00, 0x72, 0x61, 0x77, 0x1a]);
const RAW_PLACES = 6;
const KIND_PLACES = 6;
const COLORS_FIELD = 11;
const TLG5_WORD = "TLG5.0";
const TLG6_WORD = "TLG6.0";
const MASKED_WORD_5 = "XXXYYY";
const MASKED_WORD_6 = "XXXZZZ";
const JKM_WORD = "JKMXE8";
const MASKED_PLACE_5 = 0x0c;
const MASKED_PLACE_5_SECOND = 0x10;
const MASKED_PLACE_6 = 0x0f;
const MASKED_PLACE_6_SECOND = 0x13;
const MASKED_5 = 0xab;
const MASKED_5_SECOND = 0xac;
const MASKED_JKM = 0x1a;
const MASKED_JKM_SECOND = 0x1c;
const FIRST_PLACES = 0xab;
/** The places of the picture of the walk of the places of the picture of the fifth kind of the places of the
 * picture. */
const RING_SIZE = 4096;
const RING_PLACES = RING_SIZE - 1;
const LEAST_MATCH = 3;
const LONG_MATCH = 18;
const FLAG_PLACES = 0x100;
const OFFSET_PLACES = 0x0f;
const OFFSET_SHIFT = 8;
/** The places of the picture of the walk of the places of the picture of a place of the picture of the walk
 * of the places of the picture of the picture of the walk of them: the places of the picture of the walk of
 * the places of the picture of the place of the picture of the walk of them, and of the places of the picture
 * of the walk of the places of the picture of the place of the picture of the walk of them behind it. */
const BLOCK_HEAD = 5;
const MOST_WORDS = 4;
const LIMIT = 256 * 1024 * 1024;
const SLACK = 10;

export interface TlgLayout {
	version: number;
	colors: number;
	bitsPerPixel: number;
	width: number;
	height: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `TlgFormat.ReadMetaData`: the words of the head of a picture of this kind. The head stands of the places of
 * the picture of the kind of the walk of the places of the picture, of the places of the picture of the walk
 * of the places of the picture of the picture itself, and of how wide and how tall the picture stands, the
 * places of the picture of the walk of the places of the picture standing of the places of the picture of the
 * kind of the places of the picture of the walk of them, of how many places of the picture of a place of the
 * picture of the picture stand beside each other, and of the places of the picture of the walk of them of the
 * kinds of the walk of the places of the picture of the fifth and of the sixth kind.
 */
export function readTlgLayout(
	data: Buffer,
	fileLength = data.length,
): TlgLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const head = Buffer.from(data.subarray(0, HEAD_SIZE));
	let at = data.subarray(0, PREFIX.length).equals(PREFIX) ? PREFIX_SIZE : 0;
	if (
		!head
			.subarray(at + RAW_PLACES, at + RAW_PLACES + RAW_MARK.length)
			.equals(RAW_MARK)
	)
		return undefined;
	if (head[at] === FIRST_PLACES) head[at] = 0x54;
	const kind = head.subarray(at, at + KIND_PLACES).toString("latin1");
	let version: number;
	if (kind === TLG6_WORD) version = 6;
	else if (kind === TLG5_WORD) version = 5;
	else if (kind === MASKED_WORD_5) {
		version = 5;
		head[at + MASKED_PLACE_5] = (head[at + MASKED_PLACE_5] ?? 0) ^ MASKED_5;
		head[at + MASKED_PLACE_5_SECOND] =
			(head[at + MASKED_PLACE_5_SECOND] ?? 0) ^ MASKED_5_SECOND;
	} else if (kind === MASKED_WORD_6) {
		version = 6;
		head[at + MASKED_PLACE_6] = (head[at + MASKED_PLACE_6] ?? 0) ^ MASKED_5;
		head[at + MASKED_PLACE_6_SECOND] =
			(head[at + MASKED_PLACE_6_SECOND] ?? 0) ^ MASKED_5_SECOND;
	} else if (kind === JKM_WORD) {
		version = 5;
		head[at + MASKED_PLACE_5] = (head[at + MASKED_PLACE_5] ?? 0) ^ MASKED_JKM;
		head[at + MASKED_PLACE_5_SECOND] =
			(head[at + MASKED_PLACE_5_SECOND] ?? 0) ^ MASKED_JKM_SECOND;
	} else return undefined;
	const colors = head[at + COLORS_FIELD] ?? 0;
	if (version === 6) {
		if (colors !== 1 && colors !== 4 && colors !== 3) return undefined;
		if (head[at + 12] !== 0 || head[at + 13] !== 0 || head[at + 14] !== 0)
			return undefined;
		at += 15;
	} else {
		if (colors !== 4 && colors !== 3) return undefined;
		at += 12;
	}
	const width = head.readUInt32LE(at);
	const height = head.readUInt32LE(at + 4);
	if (width === 0 || height === 0) return undefined;
	if (width * height * MOST_WORDS > LIMIT) return undefined;
	return {
		version,
		colors,
		bitsPerPixel: colors * 8,
		width,
		height,
		dataOffset: at + 8,
	};
}

/**
 * `TVPTLG5DecompressSlide`: the places of the picture of the walk of the places of the picture of the fifth
 * kind stand of the places of the picture of the walk of the places of the picture of the picture of the
 * walk of them, the places of the picture of the walk of the places of the picture standing of the places of
 * the picture of the walk of the places of the picture of the words of the walk of the picture, and standing
 * of the places of the picture of the walk of the places of the picture of their own where the places of the
 * picture of the walk of the places of the picture of the word of the walk of them stand of the places of the
 * picture of the walk of the places of the picture.
 */
function decompressSlide(
	out: Buffer,
	input: Buffer,
	size: number,
	ring: Buffer,
	start: number,
): number {
	let r = start;
	let flags = 0;
	let at = 0;
	let o = 0;
	while (at < size) {
		flags >>>= 1;
		if ((flags & FLAG_PLACES) === 0) {
			if (at >= input.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			flags = (input[at] ?? 0) | 0xff00;
			at += 1;
		}
		if ((flags & 1) !== 0) {
			if (at + 2 > input.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			let to =
				(input[at] ?? 0) |
				(((input[at + 1] ?? 0) & OFFSET_PLACES) << OFFSET_SHIFT);
			let length = ((input[at + 1] ?? 0) & 0xf0) >> 4;
			at += 2;
			length += LEAST_MATCH;
			if (length === LONG_MATCH) {
				if (at >= input.length)
					throw invalidPicture(
						"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
					);
				length += input[at] ?? 0;
				at += 1;
			}
			for (let i = 0; i < length; i += 1) {
				if (o >= out.length) break;
				const place = ring[to] ?? 0;
				out[o] = place;
				o += 1;
				ring[r] = place;
				to = (to + 1) & RING_PLACES;
				r = (r + 1) & RING_PLACES;
			}
		} else {
			if (at >= input.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			const place = input[at] ?? 0;
			at += 1;
			if (o < out.length) {
				out[o] = place;
				o += 1;
			}
			ring[r] = place;
			r = (r + 1) & RING_PLACES;
		}
	}
	return r;
}

/** `TVPTLG5ComposeColors3To4` and `TVPTLG5ComposeColors4To4`: the places of the picture of the walk of the
 * places of the picture of the places of the picture stand beside each other of the places of the picture of
 * the walk of the places of the picture of the picture behind them. */
function composeColors(
	bits: Buffer,
	at: number,
	upper: number,
	planes: Buffer[],
	from: number,
	width: number,
	colors: number,
): void {
	const places = [0, 0, 0, 0];
	for (let x = 0; x < width; x += 1) {
		const first = (planes[0] ?? Buffer.alloc(0))[from + x] ?? 0;
		const second = (planes[1] ?? Buffer.alloc(0))[from + x] ?? 0;
		const third = (planes[2] ?? Buffer.alloc(0))[from + x] ?? 0;
		places[0] = ((places[0] ?? 0) + (first + second)) & 0xff;
		places[1] = ((places[1] ?? 0) + second) & 0xff;
		places[2] = ((places[2] ?? 0) + (third + second)) & 0xff;
		bits[at] = ((places[0] ?? 0) + (bits[upper] ?? 0)) & 0xff;
		bits[at + 1] = ((places[1] ?? 0) + (bits[upper + 1] ?? 0)) & 0xff;
		bits[at + 2] = ((places[2] ?? 0) + (bits[upper + 2] ?? 0)) & 0xff;
		if (colors === 4) {
			const fourth = (planes[3] ?? Buffer.alloc(0))[from + x] ?? 0;
			places[3] = ((places[3] ?? 0) + fourth) & 0xff;
			bits[at + 3] = ((places[3] ?? 0) + (bits[upper + 3] ?? 0)) & 0xff;
		} else {
			bits[at + 3] = 0xff;
		}
		at += 4;
		upper += 4;
	}
}

/** `TlgFormat.ReadV5`: the places of the picture of the walk of the places of the picture of the fifth kind
 * of the places of the picture stand as the places of the picture of the walk of the places of the picture of
 * the picture of the walk of them of the places of the picture of every place of the picture of the walk of
 * the places of the picture, the places of the picture of the walk of the places of the picture of the
 * picture standing of the places of the picture of the walk of the places of the picture of the picture of
 * the walk of them of every place of the picture of the walk of the places of them. */
export function unpackTlg5(data: Buffer, layout: TlgLayout): Buffer {
	if (layout.version !== 5)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture of the sixth kind of the places of the picture stand beside the places of the picture of the walk of the places of the picture of the sound of the engine that stand outside the places of the picture of the walk of the places of the picture of the picture",
		);
	if (layout.dataOffset + MOST_WORDS > data.length)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
		);
	const blockHeight = data.readInt32LE(layout.dataOffset);
	if (blockHeight <= 0)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture stand of no places of the picture of the walk of the places of the picture",
		);
	const blockCount = Math.floor((layout.height - 1) / blockHeight) + 1;
	let at = layout.dataOffset + MOST_WORDS + blockCount * MOST_WORDS;
	const stride = layout.width * 4;
	const bits = Buffer.alloc(layout.height * stride);
	const ring = Buffer.alloc(RING_SIZE);
	const planes: Buffer[] = [];
	for (let c = 0; c < layout.colors; c += 1)
		planes.push(Buffer.alloc(blockHeight * layout.width + SLACK));
	let r = 0;
	let prevline = -1;
	for (let yBlock = 0; yBlock < layout.height; yBlock += blockHeight) {
		for (let c = 0; c < layout.colors; c += 1) {
			if (at + BLOCK_HEAD > data.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			const mark = data[at] ?? 0;
			const size = data.readInt32LE(at + 1);
			at += BLOCK_HEAD;
			if (size < 0 || at + size > data.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			const plane = planes[c] ?? Buffer.alloc(0);
			if (mark === 0) {
				r = decompressSlide(plane, data.subarray(at, at + size), size, ring, r);
			} else {
				data.copy(plane, 0, at, at + size);
			}
			at += size;
		}
		const limit = Math.min(yBlock + blockHeight, layout.height);
		let from = 0;
		for (let y = yBlock; y < limit; y += 1) {
			const current = y * stride;
			if (prevline >= 0) {
				composeColors(
					bits,
					current,
					prevline,
					planes,
					from,
					layout.width,
					layout.colors,
				);
			} else {
				const b = [0, 0, 0, 0];
				const a = [0, 0, 0, 0];
				let to = current;
				for (let x = 0; x < layout.width; x += 1) {
					const first = (planes[0] ?? Buffer.alloc(0))[from + x] ?? 0;
					const second = (planes[1] ?? Buffer.alloc(0))[from + x] ?? 0;
					const third = (planes[2] ?? Buffer.alloc(0))[from + x] ?? 0;
					b[0] = ((b[0] ?? 0) + (first + second)) & 0xff;
					b[1] = ((b[1] ?? 0) + second) & 0xff;
					b[2] = ((b[2] ?? 0) + (third + second)) & 0xff;
					bits[to] = b[0] ?? 0;
					bits[to + 1] = b[1] ?? 0;
					bits[to + 2] = b[2] ?? 0;
					if (layout.colors === 4) {
						const fourth = (planes[3] ?? Buffer.alloc(0))[from + x] ?? 0;
						a[3] = ((a[3] ?? 0) + fourth) & 0xff;
						bits[to + 3] = a[3] ?? 0;
					} else {
						bits[to + 3] = 0xff;
					}
					to += 4;
				}
			}
			prevline = current;
			from += layout.width;
		}
	}
	return bits;
}

export const kirikiriTlgImageDescriptor: FormatDescriptor = {
	id: "kirikiri-tlg-image",
	name: "KiriKiri game engine image format",
	extensions: ["tlg", "tlg5", "tlg6"],
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
			source: "ArcFormats/KiriKiri/ImageTLG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kirikiriTlgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kirikiriTlgImageDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from("TLG0", "latin1") },
			{ bytes: Buffer.from("TLG5", "latin1") },
			{ bytes: Buffer.from("TLG6", "latin1") },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
			);
			return readTlgLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readTlgLayout(stored, Number(source.size));
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
						version: layout.version,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				version: layout.version,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readTlgLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		// The reference stands the places of the picture of the walk of the places of the picture of the
		// picture of the walk of the places of the picture of the kind of the places of the picture of the
		// third kind of the places of the picture out of the places of the picture of the walk of the places
		// of the picture of the words of the walk of them, so a picture of this project stands the places of
		// the picture of the walk of the places of the picture of the fourth kind of the places of the picture
		// of their own.
		return Readable.from([
			writeBmp32(
				layout.width,
				layout.height,
				unpackTlg5(stored, layout),
				false,
			),
		]);
	},
});
