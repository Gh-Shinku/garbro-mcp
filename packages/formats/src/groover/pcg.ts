// Format reference: GARbro ArcFormats/Groover/ArcPCG.cs, class `DatOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { readBmpImage } from "../shared/bmp.js";
import { readJpegImage } from "../shared/jpeg-image.js";
import { readPngImage } from "../shared/png-image.js";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Only archives named like `NAME01.dat` own a companion index. */
const ARCHIVE_NAME_PATTERN = /^((.+)0\d)\.dat$/i;
const DATA_EXTENSION = ".dat";
/** The index is looked up under these extensions, in order. */
const INDEX_EXTENSIONS = ["pcg", "spf"];
const PART_COUNT_FIELD = 0;
const COUNT_FIELD = 4;
const PART_NAME_OFFSET = 8;
const PART_NAME_SIZE = 0x20;
const FIRST_INDEX_OFFSET = 0x148;
const LAST_INDEX_OFFSET = 0x170;
const INDEX_HEADER_SIZE = 0x198;
const MAX_PARTS = 10;
const MIN_ENTRY_SIZE = 0x30;
const LONG_ENTRY_SIZE = 0x48;
const SHORT_NAME_SIZE = 0x20;
const LONG_NAME_SIZE = 0x40;

interface GrooverEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

/** `DatOpener.TryOpen`: the archive name selects the part, which carries its own entry range. */
export function readGrooverIndex(
	index: Buffer,
	archiveName: string,
	sourceSize: bigint,
): GrooverEntry[] | undefined {
	if (index.length < INDEX_HEADER_SIZE) return undefined;
	const partsCount = index.readInt32LE(PART_COUNT_FIELD);
	const count = index.readInt32LE(COUNT_FIELD);
	if (partsCount > MAX_PARTS || !isSaneCount(count)) return undefined;
	const entrySize = Math.floor((index.length - INDEX_HEADER_SIZE) / count);
	if (entrySize < MIN_ENTRY_SIZE) return undefined;
	let firstIndex = -1;
	let lastIndex = -1;
	for (let part = 0; part < partsCount; part += 1) {
		const namePosition = PART_NAME_OFFSET + part * PART_NAME_SIZE;
		const nameField = index.subarray(
			namePosition,
			namePosition + PART_NAME_SIZE,
		);
		const end = nameField.indexOf(0);
		const name = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		if (name !== archiveName) continue;
		firstIndex = index.readInt32LE(FIRST_INDEX_OFFSET + part * 4);
		lastIndex = index.readInt32LE(LAST_INDEX_OFFSET + part * 4);
		break;
	}
	if (firstIndex < 0 || firstIndex >= lastIndex || lastIndex > count)
		return undefined;
	const nameSize =
		entrySize >= LONG_ENTRY_SIZE ? LONG_NAME_SIZE : SHORT_NAME_SIZE;
	const entries: GrooverEntry[] = [];
	let position = INDEX_HEADER_SIZE + entrySize * firstIndex;
	for (let id = firstIndex; id < lastIndex; id += 1) {
		const nameField = index.subarray(position, position + nameSize);
		const end = nameField.indexOf(0);
		const name = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		const offset = BigInt(index.readUInt32LE(position + nameSize));
		const size = BigInt(index.readUInt32LE(position + nameSize + 4));
		if (!checkPlacement(offset, size, sourceSize)) return undefined;
		entries.push({ name, offset, size });
		position += entrySize;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** The companion index is named after the archive without its trailing digits. */
function indexCandidates(archiveName: string): string[] | undefined {
	const match = ARCHIVE_NAME_PATTERN.exec(archiveName);
	if (!match?.[2]) return undefined;
	const base = match[2];
	return INDEX_EXTENSIONS.map((extension) => `${base}.${extension}`);
}

async function readIndexFile(
	sourcePath: string,
): Promise<{ index: Buffer; archiveName: string } | undefined> {
	const archiveName = sourcePath.split(/[\\/]/).pop() ?? "";
	if (!archiveName.toLowerCase().endsWith(DATA_EXTENSION)) return undefined;
	const candidates = indexCandidates(archiveName);
	if (!candidates) return undefined;
	for (const candidate of candidates) {
		const index = await readCompanionFile(sourcePath, candidate);
		if (index) return { index, archiveName };
	}
	return undefined;
}

async function readGroover(
	source: ByteSource,
	sourcePath: string,
): Promise<GrooverEntry[] | undefined> {
	const found = await readIndexFile(sourcePath);
	if (!found) return undefined;
	return readGrooverIndex(found.index, found.archiveName, source.size);
}

function toFixedEntries(entries: readonly GrooverEntry[]): FixedEntry[] {
	return entries.map((entry, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			metadata: { type: "data" },
		}),
	);
}

/** The head of a picture of this engine: two words of counts, a count of places and a count of the file. */
const PCG_HEADER_SIZE = 0x18;
/** `DatOpener.OpenImage` stands of these words to tell a picture of the engine from a picture of a format. */
const NCMP_SIGNATURE = Buffer.from("NCMP", "latin1");
const RCB_SIGNATURE = Buffer.from([0x52, 0x43, 0x42, 0x00]);
/** The words every picture of a format a payload may stand of opens with. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
const BMP_SIGNATURE = Buffer.from("BM", "latin1");

function invalidPcg(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PcgReaderBase`: a picture of this engine carries its width and height at eight, the count of the places of its
 * picture at sixteen and the count of the places of the file at twenty, every one of them a word. Both readers
 * stand of three places of a colour to a pixel.
 */
function readPcgHead(
	data: Buffer,
	path: string,
): { width: number; height: number; unpackedSize: number; packedSize: number } {
	if (data.length < PCG_HEADER_SIZE) {
		throw invalidPcg(
			`The picture ${path} stands of too few places of the file`,
		);
	}
	const width = data.readUInt32LE(8);
	const height = data.readUInt32LE(0xc);
	const unpackedSize = data.readInt32LE(0x10);
	const packedSize = data.readInt32LE(0x14);
	const pixels = width * height * 3;
	if (width <= 0 || height <= 0 || unpackedSize < pixels) {
		throw invalidPcg(`The picture ${path} stands of no picture of this engine`);
	}
	return { width, height, unpackedSize, packedSize };
}

/**
 * `RcbReader.Unpack`: a run of a picture stands of three places of a colour and a count of the times they stand
 * again, the count standing behind them. A count of nought stands of nothing at all, which is what the reference
 * stands of as well.
 */
function unpackRcb(
	data: Buffer,
	unpackedSize: number,
	packedSize: number,
	path: string,
): Buffer {
	const output = Buffer.alloc(unpackedSize);
	let at = PCG_HEADER_SIZE;
	let dst = 0;
	for (let run = 0; run < packedSize && dst < unpackedSize; run += 1) {
		if (at + 4 > data.length || dst + 3 > unpackedSize) {
			throw invalidPcg(`The picture ${path} stands of a run past its places`);
		}
		data.copy(output, dst, at, at + 3);
		const count = data.readUInt8(at + 3);
		at += 4;
		if (count > 0) {
			// `Binary.CopyOverlapped` copies the places of the colour just written over the places behind them,
			// one place at a time, so a run of them stands of the same colour.
			const places = (count - 1) * 3;
			if (dst + 3 + places > unpackedSize) {
				throw invalidPcg(`The picture ${path} stands of a run past its places`);
			}
			for (let place = 0; place < places; place += 1) {
				output[dst + 3 + place] = output[dst + place] ?? 0;
			}
			dst += count * 3;
		}
	}
	return output;
}

/**
 * `DatOpener.OpenImage`: a payload of this archive is either a picture of the engine, which stands of its own
 * head, or a picture of a format, which the reference hands to the walks of the formats; anything else stands
 * turned away.
 */
async function readPcgPicture(data: Buffer, path: string): Promise<Buffer> {
	if (data.subarray(0, 4).equals(NCMP_SIGNATURE)) {
		const { width, height } = readPcgHead(data, path);
		// `NcmpReader.Unpack` reads the places of the picture as they stand.
		const pixels = data.subarray(
			PCG_HEADER_SIZE,
			PCG_HEADER_SIZE + width * height * 3,
		);
		if (pixels.length < width * height * 3) {
			throw invalidPcg(
				`The picture ${path} stands of too few places of the file`,
			);
		}
		return writeBmp24(width, height, Buffer.from(pixels));
	}
	if (data.subarray(0, 4).equals(RCB_SIGNATURE)) {
		const { width, height, unpackedSize, packedSize } = readPcgHead(data, path);
		return writeBmp24(
			width,
			height,
			unpackRcb(data, unpackedSize, packedSize, path),
		);
	}
	if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		const image = await readPngImage(data);
		if (image) return writePcgPicture(image);
	}
	if (data.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) {
		return writePcgPicture(readJpegImage(data));
	}
	if (data.subarray(0, BMP_SIGNATURE.length).equals(BMP_SIGNATURE)) {
		const image = readBmpImage(data);
		if (image) return writePcgPicture(image);
	}
	throw invalidPcg(
		`The payload ${path} stands of no picture this project reads`,
	);
}

/** The places of a picture of a format, of the counts of that picture, as a picture of this project. */
function writePcgPicture(image: {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
}): Buffer {
	if (32 === image.bitsPerPixel) {
		const places = Buffer.alloc(image.width * image.height * 4);
		for (let at = 0, to = 0; to < places.length; at += 4, to += 3) {
			places[to] = image.pixels[at] ?? 0;
			places[to + 1] = image.pixels[at + 1] ?? 0;
			places[to + 2] = image.pixels[at + 2] ?? 0;
		}
		return writeBmp24(image.width, image.height, places);
	}
	if (24 === image.bitsPerPixel) {
		return writeBmp24(image.width, image.height, Buffer.from(image.pixels));
	}
	throw invalidPcg(
		"A picture of this payload stands of no three places of a colour",
	);
}

export const grooverPcgDescriptor: FormatDescriptor = {
	id: "groover-pcg",
	name: "Groover resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Groover/ArcPCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const grooverPcgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: grooverPcgDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGroover(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGroover(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Groover layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			await readPcgPicture(
				Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
				entry.path,
			),
		]);
	},
});
