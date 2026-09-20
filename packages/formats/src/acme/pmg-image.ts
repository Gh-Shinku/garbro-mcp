// Format reference: GARbro "Legacy/Acme/ImagePMG.cs", classes `PmgFormat` and `PmgReader` (a picture of the
// Acme engine: the head of the picture names how many blocks of four places the picture stands in and how many
// rows of them it holds, and three places of a colour stand behind the head, every one of them walked of its
// own under a head of its own). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The head of a picture and of every one of the three places of a colour of it stands in five words of four
 * places. */
const HEAD_SIZE = 0x14;
const BLOCKS_FIELD = 0x00;
const HEIGHT_FIELD = 0x04;
const BITS_SIZE_FIELD = 0x08;
const CODE_SIZE_FIELD = 0x0c;
const DATA_SIZE_FIELD = 0x10;
/** The word the reference registers stands as the first of the four places of the first word of the file, which
 * names how many blocks of four places a row of the picture stands in; a picture of more than this many blocks
 * stands as no picture at all. */
const MAXIMUM_BLOCKS = 0x800;
/** Four places of a picture stand in every block the head of the picture names. */
const PLACES_PER_BLOCK = 4;
/** The place of a row the walk of a place of a colour stands its own places with. */
const LINE_BUFFER_SIZE = 0x800;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
/** `PmgReader.OffsetMap`: how far behind a place stands, in the thousand and twenty four places of a row, and
 * how far beside it stands, for every one of the sixteen commands a place of the walk may name. */
const OFFSET_MAP = [
	0, 0, 0, 0, 1, 1, 2, 2, 2, 4, 4, 4, 8, 8, 8, 16, 0, 2, 4, 8, 0, 2, 0, 2, 4, 0,
	2, 4, 0, 2, 4, 0,
];

export interface PmgLayout {
	/** How many blocks of four places every row of the picture stands in. */
	blocks: number;
	width: number;
	height: number;
	bitsSize: number;
	codeSize: number;
	dataSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PmgFormat.ReadMetaData`: the head of the file names how many blocks of four places a row of the picture
 * stands in, and a picture of more than `0x800` blocks or of no blocks at all stands as no picture; the head
 * then names the height of the picture and the three sizes of the walk of the first place of a colour, of which
 * the size of the words that name the places of the walk stands above the size of the whole walk and the size of
 * the places the walk reads stands above nought. The word the head of the picture names stands again behind the
 * walk of the first place of a colour.
 */
export function readPmgLayout(
	data: Buffer,
	fileLength = data.length,
): PmgLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const blocks = data.readUInt32LE(BLOCKS_FIELD);
	if (blocks <= 0 || blocks > MAXIMUM_BLOCKS) return undefined;
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsSize = data.readInt32LE(BITS_SIZE_FIELD);
	const codeSize = data.readInt32LE(CODE_SIZE_FIELD);
	const dataSize = data.readInt32LE(DATA_SIZE_FIELD);
	if (
		bitsSize <= 0 ||
		codeSize <= bitsSize ||
		dataSize <= 0 ||
		codeSize + dataSize > fileLength
	) {
		return undefined;
	}
	const width = blocks * PLACES_PER_BLOCK;
	if (width * height > LIMIT) return undefined;
	const markAt = HEAD_SIZE + codeSize + dataSize;
	if (markAt + 4 > fileLength) return undefined;
	if (data.readUInt32LE(markAt) !== blocks) return undefined;
	return { blocks, width, height, bitsSize, codeSize, dataSize };
}

/** A place of a colour of the walk: the places of the walk stand one place of a byte in two places, so every
 * place of a colour stands as a place of two places, the first of the two standing as the place of the colour
 * of the first of two places of the picture. */
function decodePmgPlace(
	command: number,
	places: Uint16Array,
	at: number,
	width: number,
): number {
	if (command !== 0) {
		const offset =
			(OFFSET_MAP[command + 16] ?? 0) + width * (OFFSET_MAP[command] ?? 0);
		return places[at - (offset >> 1)] ?? 0;
	}
	return -1;
}

/**
 * `PmgReader.Unpack`: the three places of a colour of the picture stand beside each other, every one of them
 * standing under a head of its own and walked of its own: a step of the walk names a place of the picture by
 * how far behind the place that stands before it and how far beside it stands, or stands as a place of its own
 * where it names none. What stands at the place of the walk stands beside the place of the colour before it,
 * and the places of the three colours are read one beside the other.
 */
export function unpackPmg(
	stored: Buffer,
	layout: PmgLayout,
): { pixels: Buffer; planes: Uint16Array } {
	const planeSize = layout.width * layout.height;
	if (planeSize <= 0 || planeSize % 2 !== 0) {
		throw invalidPicture("Acme picture stands in no places");
	}
	const planes = new Uint16Array(3 * (planeSize >> 1));
	const starts = [0, planeSize >> 1, planeSize];
	let at = 0;
	// The reference stands the place of the mask of the walk of the first place of a colour as a place of the
	// whole picture rather than of the place of the colour, so the mask carries from place to place.
	let mask = 0x80;
	for (const start of starts) {
		if (at + HEAD_SIZE > stored.length) {
			throw invalidPicture("Acme picture is cut short of a place of a colour");
		}
		const codeSize = stored.readInt32LE(at + CODE_SIZE_FIELD);
		const bitsSize = stored.readInt32LE(at + BITS_SIZE_FIELD);
		const dataSize = stored.readInt32LE(at + DATA_SIZE_FIELD);
		const code = stored.subarray(at + HEAD_SIZE, at + HEAD_SIZE + codeSize);
		let bitSource = 0;
		let codeSource = bitsSize;
		let readAt = at + HEAD_SIZE + codeSize;
		const end = readAt + dataSize;
		const line = new Uint8Array(LINE_BUFFER_SIZE);
		let dst = start;
		for (let y = 0; y < layout.height; y += 1) {
			for (let x = 0; x < layout.blocks; x += 1) {
				if ((code[bitSource] ?? 0) & mask) {
					line[x] = (line[x] ?? 0) ^ (code[codeSource] ?? 0);
					codeSource += 1;
				}
				mask >>= 1;
				if (0 === mask) {
					mask = 0x80;
					bitSource += 1;
				}
				for (const command of [(line[x] ?? 0) >> 4, (line[x] ?? 0) & 0xf]) {
					let value = decodePmgPlace(command, planes, dst, layout.width);
					if (value < 0) {
						if (readAt + 2 > stored.length) {
							throw invalidPicture(
								"Acme picture is cut short of a place of its walk",
							);
						}
						value = stored.readUInt16LE(readAt);
						readAt += 2;
					}
					planes[dst] = value;
					dst += 1;
				}
			}
		}
		at = end;
	}
	const pixels: Buffer = Buffer.alloc(3 * planeSize, 0x00);
	let dst = 0;
	let blue = starts[0] ?? 0;
	let green = starts[1] ?? 0;
	let red = starts[2] ?? 0;
	while (dst < pixels.length) {
		const b = planes[blue++] ?? 0;
		const g = planes[green++] ?? 0;
		const r = planes[red++] ?? 0;
		pixels[dst++] = b & 0xff;
		pixels[dst++] = g & 0xff;
		pixels[dst++] = r & 0xff;
		pixels[dst++] = (b >> 8) & 0xff;
		pixels[dst++] = (g >> 8) & 0xff;
		pixels[dst++] = (r >> 8) & 0xff;
	}
	return { pixels, planes };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const acmePmgImageDescriptor: FormatDescriptor = {
	id: "acme-pmg-image",
	name: "Acme image format",
	extensions: ["pmg"],
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
			source: "Legacy/Acme/ImagePMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const acmePmgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: acmePmgImageDescriptor,
	// The reference registers the place `0xA0` — the first of the four places of the first word of the file,
	// which names how many blocks a row of the picture stands in — and, behind it, a word of no places at all,
	// so a picture of this kind is told by its head rather than by a word of its own.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE + 4)) return false;
		try {
			return (
				readPmgLayout(await readStored(source), Number(source.size)) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPmgLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Acme picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						blocks: layout.blocks,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPmgLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Acme picture");
		const { pixels } = unpackPmg(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, false),
		]);
	},
});
