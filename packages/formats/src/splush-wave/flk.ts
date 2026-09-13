// Format reference: GARbro Legacy/SplushWave/ArcDAT.cs, classes `DatOpener` and `FlkEntry`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("FLK", "latin1");
const ARC_SIZE_FIELD = 0x14;
const COUNT_FIELD = 0x18;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x10;
const RECORD_OFFSET_FIELD = 0;
const RECORD_SIZE_FIELD = 4;
const RECORD_FLAGS_FIELD = 0xf;
/** Bit zero marks a packed payload. */
const PACKED_FLAG = 1;
/** Payloads that start with the Splush Wave image marker are images. */
const IMAGE_MARKER = 0x475753;
const NAME_DIGITS = 4;
const FRAME_SIZE = 0x400;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_INIT_POSITION = 0x3be;
const CONTROL_BASE = 0x100;
const COPY_MIN_LENGTH = 3;
const COPY_OFFSET_MASK = 0xc0;
const COPY_LENGTH_MASK = 0x3f;
const COPY_OFFSET_SHIFT = 2;

interface FlkEntry {
	name: string;
	offset: bigint;
	size: bigint;
	packed: boolean;
}

/**
 * `DatOpener.LzssUnpack`: a 0x400 byte frame whose control bits are consumed from the least significant one,
 * with the offset packed into the low bits of the second copy byte.
 */
export function inflateFlkLzss(input: Buffer): Buffer {
	const frame = Buffer.alloc(FRAME_SIZE);
	const parts: Buffer[] = [];
	let current = Buffer.alloc(FRAME_SIZE);
	let currentSize = 0;
	let framePosition = FRAME_INIT_POSITION;
	let position = 0;
	const write = (value: number): void => {
		frame[framePosition & FRAME_MASK] = value;
		framePosition += 1;
		if (currentSize === current.length) {
			parts.push(current);
			current = Buffer.alloc(FRAME_SIZE);
			currentSize = 0;
		}
		current[currentSize] = value;
		currentSize += 1;
	};
	let control = 0;
	while (position < input.length) {
		control >>= 1;
		if ((control & CONTROL_BASE) === 0) {
			control = (input[position] ?? 0) | 0xff00;
			position += 1;
		}
		if ((control & 1) === 0) {
			if (position >= input.length) break;
			write(input[position] ?? 0);
			position += 1;
			continue;
		}
		if (position + 1 >= input.length) break;
		const low = input[position] ?? 0;
		const high = input[position + 1] ?? 0;
		position += 2;
		let offset = low + ((high & COPY_OFFSET_MASK) << COPY_OFFSET_SHIFT);
		let count = (high & COPY_LENGTH_MASK) + COPY_MIN_LENGTH;
		while (count > 0) {
			write(frame[offset & FRAME_MASK] ?? 0);
			offset += 1;
			count -= 1;
		}
	}
	parts.push(current.subarray(0, currentSize));
	return Buffer.concat(parts);
}

/** `DatOpener.TryOpen`: a flat index of payload ranges, with names generated from the archive name. */
async function readFlk(
	source: ByteSource,
	sourcePath: string,
): Promise<FlkEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (BigInt(header.readUInt32LE(ARC_SIZE_FIELD)) !== source.size)
		return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = (sourcePath.split(/[\\/]/).pop() ?? "").replace(
		/\.[^.]*$/,
		"",
	);
	const entries: FlkEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(position + RECORD_OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(position + RECORD_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const flags = index[position + RECORD_FLAGS_FIELD] ?? 0;
		entries.push({
			name: `${baseName}#${String(id).padStart(NAME_DIGITS, "0")}`,
			offset,
			size,
			packed: (flags & PACKED_FLAG) !== 0,
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** The image marker sits either at the start of a payload or one byte in. */
async function isImagePayload(
	source: ByteSource,
	entry: FlkEntry,
): Promise<boolean> {
	if (entry.size < 4n || entry.offset + 4n > source.size) return false;
	const signature = await source.readAt(entry.offset, 4);
	const value = signature.readUInt32LE(0);
	return value === IMAGE_MARKER || value >>> 8 === IMAGE_MARKER;
}

async function toFixedEntries(
	source: ByteSource,
	entries: readonly FlkEntry[],
): Promise<FixedEntry[]> {
	const fixed: FixedEntry[] = [];
	for (const [id, entry] of entries.entries()) {
		const type = (await isImagePayload(source, entry)) ? "image" : "data";
		const created = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			compressed: entry.packed,
			metadata: { type },
		});
		// The index carries the stored size only, so a packed entry has no declared output size.
		fixed.push(entry.packed ? { ...created, sizeKnown: false } : created);
	}
	return fixed;
}

export const flkDatDescriptor: FormatDescriptor = {
	id: "splush-wave-flk",
	name: "Splush Wave resource archive",
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
			source: "Legacy/SplushWave/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const flkDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: flkDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readFlk(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readFlk(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Splush Wave layout");
		return {
			entries: await toFixedEntries(source, entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (!entry.compressed) return Readable.from([stored]);
		return Readable.from([inflateFlkLzss(stored)]);
	},
});
