// Format reference: GARBro Legacy/Dice/ArcRLZ.cs, class `RlzOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("RLZ2", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 0x10;
/** A record is a 0x20-byte name, the stored and unpacked sizes, a packed flag and a payload offset. */
const NAME_SIZE = 0x20;
const SIZE_FIELD = 0x20;
const UNPACKED_SIZE_FIELD = 0x24;
const PACKED_FIELD = 0x28;
const OFFSET_FIELD = 0x2c;
const RECORD_SIZE = 0x34;
const FRAME_SIZE = 0x800;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_INIT_POSITION = 0x7ef;
/** GARbro's copy length is the high nibble plus two, one less than the shared LZSS variant. */
const MATCH_BASE_LENGTH = 2;

export const diceRlzDescriptor: FormatDescriptor = {
	id: "dice-rlz",
	name: "DiceSystem resource archive",
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
			source: "Legacy/Dice/ArcRLZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readRlzIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const dataOffset = BigInt(INDEX_OFFSET + indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const packed = index.readInt32LE(record + PACKED_FIELD) !== 0;
		const offset =
			BigInt(index.readUInt32LE(record + OFFSET_FIELD)) + dataOffset;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: packed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed: packed,
			}),
		);
	}
	return entries;
}

/**
 * GARbro `RlzOpener.LzUnpack`. The control byte is consumed from its low bit with an `0x100` sentinel;
 * a set bit reads one literal, a clear bit reads a little-endian word whose high nibble plus two is
 * the copy length and whose remaining twelve bits index the 0x800-byte frame. The frame starts at
 * 0x7ef and holds absolute positions, so matches normally reference the raised frame area. The
 * declared unpacked size is allocated up front and decoding stops when it is filled or input ends.
 */
export function inflateDiceLz(input: Uint8Array, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = FRAME_INIT_POSITION;
	let sourcePosition = 0;
	let destination = 0;
	let control = 2;
	while (destination < output.length) {
		control >>= 1;
		if (control === 1) {
			if (sourcePosition >= source.length) break;
			control = (source[sourcePosition++] ?? 0) | 0x100;
		}
		if ((control & 1) !== 0) {
			if (sourcePosition >= source.length) break;
			const value = source[sourcePosition++] ?? 0;
			output[destination++] = value;
			frame[framePosition++ & FRAME_MASK] = value;
		} else {
			if (sourcePosition + 2 > source.length) break;
			const low = source[sourcePosition++] ?? 0;
			const high = source[sourcePosition++] ?? 0;
			const offset = ((high & 0xf0) << 4) | low;
			const count = (high & 0x0f) + MATCH_BASE_LENGTH;
			for (
				let index = 0;
				index < count && destination < output.length;
				index += 1
			) {
				const value = frame[(offset + index) & FRAME_MASK] ?? 0;
				output[destination++] = value;
				frame[framePosition++ & FRAME_MASK] = value;
			}
		}
	}
	return output;
}

/** GARbro `RlzOpener.OpenEntry`: packed payloads use the private Dice LZ scheme. */
const diceEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "Dice entry"),
	);
	return Readable.from([
		inflateDiceLz(stored, bigintToBufferLength(entry.size, "Dice output")),
	]);
};

export const diceRlzFormat: ArchiveFormat = defineFixedArchive({
	descriptor: diceRlzDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readRlzIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readRlzIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Dice RLZ layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: diceEntryOpener,
});
