// Format reference: GARBro ArcFormats/MicroVision/ArcARC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ARC1", "ascii");
/** Header words are spread over 0xC-byte strides, index words over seven-byte strides. */
const HEADER_STEP = 0x0c;
const INDEX_STEP = 7;
const COUNT_OFFSET = 0x0d;
const NAMES_OFFSET = 8;
const NAMES_LENGTH_OFFSET = 9;
const ALT_NAMES_OFFSET = 7;
const ALT_NAMES_LENGTH_OFFSET = 6;
const INDEX_OFFSET_OFFSET = 4;
const INDEX_ALIGNMENT = 0x80;
const MIN_INDEX_SIZE = 0x40;
const RECORD_SIZE = 0x20;
const NAME_FIELD_OFFSET = 2;
const OFFSET_FIELD_OFFSET = 4;
const SIZE_FIELD_OFFSET = 5;
const UNPACKED_FIELD_OFFSET = 6;
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
const FRAME_INIT_POSITION = 1;
const MATCH_BASE = 2;

export const microVisionArcDescriptor: FormatDescriptor = {
	id: "microvision-arc",
	name: "MicroVision resource archive",
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
			source: "ArcFormats/MicroVision/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `ArcReader.ReadUInt32`: four bytes gathered across a fixed stride. */
function readStrided(
	buffer: Buffer,
	offset: number,
	step: number,
): number | undefined {
	if (offset + step * 3 >= buffer.length) return undefined;
	return (
		((buffer[offset] ?? 0) |
			((buffer[offset + step] ?? 0) << 8) |
			((buffer[offset + step * 2] ?? 0) << 16) |
			((buffer[offset + step * 3] ?? 0) << 24)) >>>
		0
	);
}

/**
 * GARbro `ArcOpener.LzUnpack`: a most-significant-bit-first stream where a set bit marks a literal
 * and a clear bit a match whose twelve-bit offset is split across two bytes in swapped nibble order,
 * with a length of two plus the low nibble of the second byte. The ring buffer starts at position 1.
 */
function lzUnpack(payload: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = FRAME_INIT_POSITION;
	let destination = 0;
	let source = 0;
	let bit = 0;
	let control = 0;
	while (destination < output.length) {
		if (bit === 0) {
			if (source >= payload.length) break;
			control = payload[source++] ?? 0;
			bit = 0x80;
		}
		if ((control & bit) !== 0) {
			if (source >= payload.length) break;
			const value = payload[source++] ?? 0;
			frame[framePosition++ & FRAME_MASK] = value;
			output[destination++] = value;
		} else {
			if (source + 2 > payload.length) break;
			const low = payload[source++] ?? 0;
			const high = payload[source++] ?? 0;
			let offset = ((high >> 4) | (low << 4)) & FRAME_MASK;
			for (
				let count = MATCH_BASE + (high & 0x0f);
				count > 0 && destination < output.length;
				count -= 1
			) {
				const value = frame[offset++ & FRAME_MASK] ?? 0;
				frame[framePosition++ & FRAME_MASK] = value;
				output[destination++] = value;
			}
		}
		bit >>= 1;
	}
	return output;
}

async function readArcIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(MIN_INDEX_SIZE)) return undefined;
	const prefix = await source.readAt(
		0n,
		Number(source.size < BigInt(0x40) ? source.size : BigInt(0x40)),
	);
	if (!prefix.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = readStrided(prefix, COUNT_OFFSET, HEADER_STEP);
	if (count === undefined || !isSaneCount(count)) return undefined;
	let namesOffset = readStrided(prefix, NAMES_OFFSET, HEADER_STEP);
	let namesLength: number | undefined;
	if (namesOffset !== undefined && namesOffset !== 0) {
		namesLength = readStrided(prefix, NAMES_LENGTH_OFFSET, HEADER_STEP);
	} else {
		namesOffset = readStrided(prefix, ALT_NAMES_OFFSET, HEADER_STEP);
		namesLength = readStrided(prefix, ALT_NAMES_LENGTH_OFFSET, HEADER_STEP);
	}
	if (namesOffset === undefined || namesLength === undefined) return undefined;
	const indexSize =
		(namesOffset + namesLength + INDEX_ALIGNMENT - 1) & ~(INDEX_ALIGNMENT - 1);
	if (indexSize < MIN_INDEX_SIZE || BigInt(indexSize) >= source.size)
		return undefined;
	const indexOffset = readStrided(prefix, INDEX_OFFSET_OFFSET, HEADER_STEP);
	if (indexOffset === undefined) return undefined;
	const indexSizeBytes = count * RECORD_SIZE;
	if (BigInt(indexOffset) + BigInt(indexSizeBytes) > source.size)
		return undefined;
	const index = await source.readAt(BigInt(indexOffset), indexSizeBytes);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameOffset = readStrided(
			index,
			record + NAME_FIELD_OFFSET,
			INDEX_STEP,
		);
		const nameLength = readStrided(
			index,
			record + NAME_FIELD_OFFSET + 1,
			INDEX_STEP,
		);
		const offset = readStrided(index, record + OFFSET_FIELD_OFFSET, INDEX_STEP);
		const size = readStrided(index, record + SIZE_FIELD_OFFSET, INDEX_STEP);
		const unpackedSize = readStrided(
			index,
			record + UNPACKED_FIELD_OFFSET,
			INDEX_STEP,
		);
		if (
			nameOffset === undefined ||
			nameLength === undefined ||
			offset === undefined ||
			size === undefined ||
			unpackedSize === undefined
		)
			return undefined;
		if (BigInt(nameOffset) + BigInt(nameLength) > source.size) return undefined;
		const nameField =
			nameLength === 0
				? Buffer.alloc(0)
				: await source.readAt(BigInt(nameOffset), nameLength);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (!checkPlacement(BigInt(offset), BigInt(size), source.size))
			return undefined;
		const packed = unpackedSize !== size;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: BigInt(offset),
				size: packed ? BigInt(unpackedSize) : BigInt(size),
				packedSize: BigInt(size),
				compressed: packed,
				metadata: { unpackedSize: String(unpackedSize) },
			}),
		);
	}
	return entries;
}

/** GARbro `ArcOpener.OpenEntry`: packed entries are expanded with the engine's LZ variant. */
const microVisionEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.compressed !== true)
		return source.createReadStream(entry.offset, entry.packedSize);
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([lzUnpack(payload, Number(entry.size))]);
};

export const microVisionArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: microVisionArcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readArcIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readArcIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid MicroVision ARC layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: microVisionEntryOpener,
});
