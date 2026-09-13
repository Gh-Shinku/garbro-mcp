// Format reference: GARBro Legacy/Omi/ArcDAT.cs, classes `DatOpener`, `DecryptedStream` and its
// `DecompressRle` helper.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference only opens a file with this exact name. */
const FILE_NAME = "scrdat";
const DEFAULT_KEY = 7654321;
/** The key stretches as `5 * key - 3`, taken modulo 2^32. */
const KEY_MULTIPLIER = 5;
const KEY_OFFSET = 3;
/** Names resolve to a type through GARbro's catalog; the port approximates the image set by extension. */
const IMAGE_EXTENSIONS = new Set([
	"abm",
	"bmp",
	"gif",
	"jpeg",
	"jpg",
	"png",
	"tga",
	"tif",
	"tiff",
]);
const LINE_BREAK = 0x0a;
const RLE_UNIT_SIZE = 2;
const RLE_HEADER_SIZE = 6;

export const omiDatDescriptor: FormatDescriptor = {
	id: "omi-dat",
	name: "OMI Script Engine resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/Omi/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function rotateByteRight(value: number, shift: number): number {
	return (((value >>> shift) | (value << (8 - shift))) & 0xff) >>> 0;
}

function rotateByteLeft(value: number, shift: number): number {
	return (((value << shift) | (value >>> (8 - shift))) & 0xff) >>> 0;
}

/** Advances the cipher key the given number of bytes, exactly as the reference's offset prelude does. */
function advanceKey(key: number, steps: number): number {
	let current = key;
	for (let step = 0; step < steps; step += 1)
		current = (KEY_MULTIPLIER * current - KEY_OFFSET) >>> 0;
	return current;
}

/**
 * GARBro `DecryptedStream.Decrypt`. Every byte is rotated right by one bit, then has the low byte of the
 * running key subtracted, and the key stretches by `5 * key - 3` afterwards. The stream advances the key
 * once per byte, so a payload's key state is decided by its offset in the file: the port reproduces that
 * by advancing the key from the default before decoding a range.
 */
function decryptOmiRange(data: Buffer, startOffset: number): Buffer {
	let key = advanceKey(DEFAULT_KEY, startOffset);
	for (let position = 0; position < data.length; position += 1) {
		data[position] =
			(rotateByteRight(data[position] ?? 0, 1) - (key & 0xff)) & 0xff;
		key = (KEY_MULTIPLIER * key - KEY_OFFSET) >>> 0;
	}
	return data;
}

/** Inverse of `decryptOmiRange`, used by fixtures to reproduce a stored file. */
export function encryptOmiRange(data: Buffer, startOffset: number): Buffer {
	let key = advanceKey(DEFAULT_KEY, startOffset);
	for (let position = 0; position < data.length; position += 1) {
		const value = ((data[position] ?? 0) + (key & 0xff)) & 0xff;
		data[position] = rotateByteLeft(value, 1);
		key = (KEY_MULTIPLIER * key - KEY_OFFSET) >>> 0;
	}
	return data;
}

/**
 * GARBro `DatOpener.DecompressRle`. The block declares an output length in sixteen-bit units and a
 * marker word. Words are copied through until the marker appears; behind the marker comes the word to
 * repeat and a count whose value minus one gives the number of repeats. The reference copies into a
 * buffer of exactly twice the declared length and would overrun it for a corrupt count, while the port
 * clamps the copy to that length instead.
 */
function decompressOmiRle(input: Buffer): Buffer {
	if (input.length < RLE_HEADER_SIZE) {
		throw new GarbroError("INVALID_ARCHIVE", "OMI RLE block is truncated");
	}
	const units = input.readInt32LE(0);
	if (units < 0)
		throw new GarbroError("INVALID_ARCHIVE", "OMI RLE size is invalid");
	const output = Buffer.alloc(units * RLE_UNIT_SIZE);
	const marker = input.readUInt16LE(4);
	let source = RLE_HEADER_SIZE;
	let destination = 0;
	while (destination < output.length) {
		if (source + RLE_UNIT_SIZE > input.length) break;
		input.copy(output, destination, source, source + RLE_UNIT_SIZE);
		const word = output.readUInt16LE(destination);
		source += RLE_UNIT_SIZE;
		if (word !== marker) {
			destination += RLE_UNIT_SIZE;
			continue;
		}
		if (source + RLE_UNIT_SIZE > input.length) break;
		input.copy(output, destination, source, source + RLE_UNIT_SIZE);
		source += RLE_UNIT_SIZE;
		destination += RLE_UNIT_SIZE;
		if (source + RLE_UNIT_SIZE > input.length) break;
		const count = (input.readUInt16LE(source) - 1) * RLE_UNIT_SIZE;
		source += RLE_UNIT_SIZE;
		for (
			let index = 0;
			index < count && destination < output.length;
			index += 1
		) {
			output[destination] = output[destination - RLE_UNIT_SIZE] ?? 0;
			destination += 1;
		}
	}
	return output;
}

/** Splits the decrypted index into lines, keeping the offset each line ends at. */
function readLines(data: Buffer): { text: string; end: number }[] {
	const lines: { text: string; end: number }[] = [];
	let start = 0;
	for (let position = 0; position < data.length; position += 1) {
		if (data[position] !== LINE_BREAK) continue;
		lines.push({
			text: data.toString("latin1", start, position),
			end: position + 1,
		});
		start = position + 1;
	}
	if (start < data.length)
		lines.push({ text: data.toString("latin1", start), end: data.length });
	return lines;
}

/**
 * GARBro `DatOpener.TryOpen`. Only a file named exactly `scrdat` is opened, and the whole file is read
 * through the decrypting stream so that the index is plain text once decrypted: the first line is the
 * entry count, and each entry then contributes a name line and a size line, giving two lines per entry.
 *
 * The payload area begins right behind the last line, and entries follow each other in index order, so
 * their offsets come from accumulating the declared sizes rather than from the index. GARbro marks an
 * entry packed when its name resolves to an image, and decodes those with its RLE helper.
 */
async function readOmiIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (basename(sourcePath).toLowerCase() !== FILE_NAME) return undefined;
	const decrypted = decryptOmiRange(
		await source.readAt(0n, Number(source.size)),
		0,
	);
	const lines = readLines(decrypted);
	if (lines.length < 1) return undefined;
	const count = Number.parseInt((lines[0]?.text ?? "").trim(), 10);
	if (!isSaneCount(count)) return undefined;
	// Lines are the count, then a name and a size per entry, and the payload area starts behind the
	// last line the reference consumed.
	const payloadBase = BigInt(lines[2 * count]?.end ?? 0);
	const parsed: { name: string; size: bigint }[] = [];
	let position = 1;
	for (let id = 0; id < count; id += 1) {
		const nameLine = lines[position];
		const sizeLine = lines[position + 1];
		if (!nameLine || !sizeLine) return undefined;
		position += 2;
		const name = nameLine.text;
		if (name.trim().length === 0) return undefined;
		const size = Number.parseInt(sizeLine.text.trim(), 10);
		if (!Number.isSafeInteger(size) || size < 0) return undefined;
		parsed.push({ name, size: BigInt(size) });
	}

	const entries: FixedEntry[] = [];
	let dataOffset = payloadBase;
	for (const [id, entry] of parsed.entries()) {
		if (!checkPlacement(dataOffset, entry.size, source.size)) return undefined;
		const packed = IMAGE_EXTENSIONS.has(sourceExtension(entry.name));
		const fixed: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: dataOffset,
			size: entry.size,
			packedSize: entry.size,
			compressed: packed,
			...(packed ? { metadata: { inferredType: "image" } } : {}),
		});
		if (packed) fixed.sizeKnown = false;
		entries.push(fixed);
		dataOffset += entry.size;
	}
	return entries;
}

/**
 * GARBro `DatOpener.OpenEntry`. A payload is decrypted with the key state its own offset implies, and an
 * image payload is then expanded by the RLE helper, whose declared output length the reference trusts.
 */
async function openOmiEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = decryptOmiRange(
		await source.readAt(entry.offset, Number(entry.packedSize)),
		Number(entry.offset),
	);
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([decompressOmiRle(stored)]);
}

export const omiDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: omiDatDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readOmiIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readOmiIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid OMI DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openOmiEntry,
});
