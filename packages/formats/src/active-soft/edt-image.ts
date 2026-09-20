// Format reference: GARbro "ArcFormats/ActiveSoft/ImageEDT.cs", classes `EdtFormat`, `EdtMetaData` and
// `EdtFormat.Reader` (a picture of the Active Soft engine of the three places of a place of the picture: the
// places of the picture stand as the places of the picture of the words of the walk of them or as the places of
// the picture of the places of the picture that stand behind them, in the kinds of the walk of the places of
// the picture). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { EdBitReader } from "./ed-common.js";

/** The words a picture of this kind names itself with stand in the first places of the file, and the places of
 * the head of it stand behind them. */
const MARK = Buffer.from(".TRUE\x8d\x5d\x8c\xcb\x00", "latin1");
const HEAD_SIZE = 0x22;
const WIDTH_FIELD = 0xe;
const HEIGHT_FIELD = 0x10;
const PACKED_SIZE_FIELD = 0x1a;
const EXTRA_SIZE_FIELD = 0x1e;
/** The places of a picture of this kind stand in the places of a picture of the three places of a place of the
 * picture. */
const PLACES_PER_PLACE = 3;
/** The places of the picture of the walk of the count of the places of a walk of a picture stand within the
 * places of a picture of the count of its own. */
const COUNT_PLACES = 5;
/** The places of the picture of the places of a walk of a picture that stand behind it stand as the places of
 * the walk of the places of a picture of the count of the kinds of their places, of which the reference names
 * four, standing as the places of the picture of the words behind them. */
const SHIFT_SELECT = 0x11191718;
const SHIFT_SELECT_PLACES = 2;
/** The places of a picture of a kind stand as the places of the picture of the places of the walk of the
 * picture of the two places of theirs, the first of them standing for the places of the picture of their own
 * and the last one for no place of the picture at all. */
const PLACES_PER_ROW_BEHIND = 4;
const PLACES_PER_ROW_BEHIND_KINDS = 7;
const PLACES_OF_LAST_ROW = 4;
const LAST_ROW_LEAST = 12;
/** The places of the picture of a walk of the picture that stand behind the places of the walk of them stand
 * for the places of the picture of the kind of the places of the picture of the count of them. */
const LEAST_PLACE = 2;
const MOST_PLACE = 0xfd;

export interface EdtLayout {
	width: number;
	height: number;
	compSize: number;
	extraSize: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `EdtFormat.ReadMetaData`: the words of the head of a picture of this kind name the words of the kind of the
 * picture, how wide and how tall the picture stands, how many places the walk of the places of the picture
 * stands for, and how many places the picture of the places of the walk of the picture of its own stands for.
 */
export function readEdtLayout(
	data: Buffer,
	fileLength = data.length,
): EdtLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const compSize = data.readUInt32LE(PACKED_SIZE_FIELD);
	const extraSize = data.readUInt32LE(EXTRA_SIZE_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	// Every place of the picture of the places of the walk of the picture of its own stands as the places of a
	// picture of the three places of a place of the picture, so a picture of no places of them stands nowhere.
	if (extraSize === 0 || extraSize % PLACES_PER_PLACE !== 0) return undefined;
	// The places of the walk of a picture and the places of the picture of the walk of it stand within the
	// places of the picture, which the reference reads without standing them against the places of the file.
	// This port stands the words of the head against the places of the file, so a picture cut short of the
	// places of its own stands away.
	if (HEAD_SIZE + compSize + extraSize > fileLength) return undefined;
	return {
		width,
		height,
		compSize,
		extraSize,
		dataOffset: HEAD_SIZE,
	};
}

/** Where the places of the picture that stand beside the places of the walk of a picture stand, of the places
 * of the picture of the walk of it. */
function createShiftTable(width: number): Int32Array {
	const stride = width * PLACES_PER_PLACE;
	const table = new Int32Array(
		PLACES_PER_ROW_BEHIND * PLACES_PER_ROW_BEHIND_KINDS + PLACES_OF_LAST_ROW,
	);
	let at = 0;
	let offset = stride * -PLACES_PER_ROW_BEHIND;
	while (offset !== 0) {
		let shift = offset - PLACES_PER_ROW_BEHIND_KINDS - 2;
		for (let j = 0; j < PLACES_PER_ROW_BEHIND_KINDS; j += 1) {
			table[at] = shift;
			at += 1;
			shift += PLACES_PER_PLACE;
		}
		offset += stride;
	}
	offset = -LAST_ROW_LEAST;
	while (offset !== 0) {
		table[at] = offset;
		at += 1;
		offset += PLACES_PER_PLACE;
	}
	return table;
}

/**
 * `EdtFormat.Read`: the places of the picture, walked. Every place of the walk of the picture names one of the
 * kinds of the walk of the places of the picture: a place of the picture that stands as a place of the picture
 * of the places behind the places of the walk of the picture of its own, a place of the picture that stands as
 * the places of the picture of the place beside it, and a place of the picture that stands from the places of
 * the picture of the kinds of the walk of the places of the picture of the count of them.
 */
export function unpackEdtPicture(data: Buffer, layout: EdtLayout): Buffer {
	const packed = data.subarray(
		layout.dataOffset,
		layout.dataOffset + layout.compSize,
	);
	const extra = data.subarray(
		layout.dataOffset + layout.compSize,
		layout.dataOffset + layout.compSize + layout.extraSize,
	);
	const out = Buffer.alloc(layout.width * layout.height * PLACES_PER_PLACE);
	const table = createShiftTable(layout.width);
	const reader = new EdBitReader(packed);
	let extraAt = 0;
	const readExtra = (dst: number): void => {
		if (extraAt + PLACES_PER_PLACE > extra.length)
			throw invalidPicture(
				"The places of the picture of the walk of a picture stand short of the places of the picture",
			);
		for (let at = 0; at < PLACES_PER_PLACE; at += 1)
			out[dst + at] = extra[extraAt + at] ?? 0;
		extraAt += PLACES_PER_PLACE;
	};
	let dst = 0;
	readExtra(dst);
	dst += PLACES_PER_PLACE;
	while (dst < out.length) {
		if (reader.nextBit() === 1) {
			if (reader.nextBit() === 0) {
				const offset = table[reader.readBits(0, COUNT_PLACES)] ?? 0;
				// The reference stands the walk of the places of the picture away where the places of the
				// picture of the walk of it stand before the places of the picture itself.
				if (dst < -offset) return out;
				const count = reader.countBits() * PLACES_PER_PLACE;
				for (let at = 0; at < count; at += 1) {
					const from = dst + offset + at;
					if (from < 0 || dst + at >= out.length)
						throw invalidPicture(
							"The places of the picture of the walk of a picture stand past the places of it",
						);
					out[dst + at] = out[from] ?? 0;
				}
				dst += count;
				continue;
			}
			let offset = -PLACES_PER_PLACE;
			if (reader.nextBit() === 1) {
				const select = reader.readBits(0, SHIFT_SELECT_PLACES);
				offset =
					table[(SHIFT_SELECT >>> (select << PLACES_PER_PLACE)) & 0xff] ?? 0;
				if (dst < -offset) return out;
			}
			for (let at = 0; at < PLACES_PER_PLACE; at += 1) {
				const from = dst + offset;
				if (from < 0 || from >= out.length)
					throw invalidPicture(
						"The places of the picture of the walk of a picture stand past the places of it",
					);
				let place = out[from] ?? 0;
				if (place < LEAST_PLACE) place = LEAST_PLACE;
				else if (place > MOST_PLACE) place = MOST_PLACE;
				if (reader.nextBit() === 1) {
					const step = 1 + reader.nextBit();
					if (reader.nextBit() === 0) place -= step;
					else place += step;
				}
				out[dst] = place & 0xff;
				dst += 1;
			}
			continue;
		}
		readExtra(dst);
		dst += PLACES_PER_PLACE;
	}
	return out;
}

export const activeSoftEdtImageDescriptor: FormatDescriptor = {
	id: "active-soft-edt-image",
	name: "Active Soft RGB image format",
	extensions: ["edt"],
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
			source: "ArcFormats/ActiveSoft/ImageEDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const activeSoftEdtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: activeSoftEdtImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readEdtLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readEdtLayout(stored, Number(source.size));
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
						bitsPerPixel: 24,
						packedSize: layout.compSize,
						extraSize: layout.extraSize,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
				packedSize: layout.compSize,
				extraSize: layout.extraSize,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readEdtLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return Readable.from([
			writeBmp24(
				layout.width,
				layout.height,
				unpackEdtPicture(stored, layout),
				false,
			),
		]);
	},
});
