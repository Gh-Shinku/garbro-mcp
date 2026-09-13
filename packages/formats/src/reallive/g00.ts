// Format reference: GARbro ArcFormats/RealLive/ArcG00.cs, class `G00Opener`, with the frame unpacker
// `G00Reader.LzDecompress` from ArcFormats/RealLive/ImageG00.cs.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The file type byte stored at offset zero. */
const FILE_TYPE = 2;
const MAX_DIMENSION = 0x8000;
/** A file holds at least two frames and at most 0x1000 of them. */
const MIN_FRAME_COUNT = 2;
const MAX_FRAME_COUNT = 0x1000;
/** Frame headers are twenty-four bytes long and their coordinates are not needed here. */
const FRAME_HEADER_SIZE = 0x18;
const FRAME_TABLE_OFFSET = 9;
/** The packed frame table opens with its own size and the unpacked size. */
const PACKED_HEADER_SIZE = 8;
const PACKED_SIZE_FIELD = 0;
const UNPACKED_SIZE_FIELD = 4;
/** The frame table stores an offset and a size per frame. */
const FRAME_FIELDS_SIZE = 8;
/** Copy lengths and distances are scaled by this factor. */
const LZ_BYTES_PER_PIXEL = 1;
/** A copy is at least this long, plus the low four bits of its distance word. */
const LZ_MIN_COUNT = 2;
const LZ_DISTANCE_SHIFT = 4;
const LZ_COUNT_MASK = 0xf;
/** The bit reader starts with this marker and refills whenever it shifts down to one. */
const LZ_INITIAL_BITS = 2;
const LZ_REFILL_SENTINEL = 1;
const LZ_CONTROL_BASE = 0x100;
const LZ_CONTROL_MASK = 1;

/**
 * GARbro `G00Reader.LzDecompress` with the parameters the archive uses. The packed stream opens with the packed
 * size including its own header and the unpacked size. A control byte is refilled whenever the one-bit marker
 * shifts down to the sentinel, a set bit copies one pixel literally, and a clear bit reads a sixteen bit word
 * whose low four bits extend the copy length and whose upper twelve bits are the distance in pixels. The
 * reference lets its array accesses throw when a copy would leave the output or reach before its start, so
 * those cases decline the archive here.
 */
export function unpackG00Table(data: Buffer): Buffer | undefined {
	if (data.length < PACKED_HEADER_SIZE) return undefined;
	const packedSize = data.readInt32LE(PACKED_SIZE_FIELD) - PACKED_HEADER_SIZE;
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize < 0) return undefined;
	const output = Buffer.alloc(unpackedSize);
	let source = PACKED_HEADER_SIZE;
	let remaining = packedSize;
	let target = 0;
	let bits = LZ_INITIAL_BITS;
	while (target < output.length && remaining > 0) {
		bits >>= 1;
		if (bits === LZ_REFILL_SENTINEL) {
			if (source >= data.length) return undefined;
			bits = (data[source] ?? 0) | LZ_CONTROL_BASE;
			source += 1;
			remaining -= 1;
		}
		if ((bits & LZ_CONTROL_MASK) !== 0) {
			if (target + LZ_BYTES_PER_PIXEL > output.length) return undefined;
			// A read past the end of the stream leaves zeroes behind, as the reference does.
			for (let i = 0; i < LZ_BYTES_PER_PIXEL; i += 1)
				output[target + i] = data[source + i] ?? 0;
			target += LZ_BYTES_PER_PIXEL;
			source += LZ_BYTES_PER_PIXEL;
			remaining -= LZ_BYTES_PER_PIXEL;
			continue;
		}
		if (remaining < 2) break;
		if (source + 2 > data.length) return undefined;
		const word = data.readUInt16LE(source);
		source += 2;
		remaining -= 2;
		const distance = (word >> LZ_DISTANCE_SHIFT) * LZ_BYTES_PER_PIXEL;
		const count = (word & LZ_COUNT_MASK) * LZ_BYTES_PER_PIXEL + LZ_MIN_COUNT;
		const from = target - distance;
		if (from < 0 || target + count > output.length) return undefined;
		for (let i = 0; i < count; i += 1) {
			output[target] = output[from + i] ?? 0;
			target += 1;
		}
	}
	return output;
}

interface G00Frame {
	offset: bigint;
	size: bigint;
	index: number;
}

/** Reads the frame table and the frames it points at. */
async function readG00Table(
	source: ByteSource,
): Promise<G00Frame[] | undefined> {
	if (source.size < BigInt(FRAME_TABLE_OFFSET)) return undefined;
	const header = Buffer.from(
		await source.readAt(0n, Math.min(Number(source.size), FRAME_TABLE_OFFSET)),
	);
	if ((header[0] ?? 0) !== FILE_TYPE) return undefined;
	const width = header.readUInt16LE(1);
	const height = header.readUInt16LE(3);
	if (width === 0 || width > MAX_DIMENSION) return undefined;
	if (height === 0 || height > MAX_DIMENSION) return undefined;
	const count = header.readInt16LE(5);
	if (count < MIN_FRAME_COUNT || count > MAX_FRAME_COUNT) return undefined;
	const tableOffset = FRAME_TABLE_OFFSET + count * FRAME_HEADER_SIZE;
	if (BigInt(tableOffset) >= source.size) return undefined;
	const table = unpackG00Table(
		Buffer.from(
			await source.readAt(
				BigInt(tableOffset),
				Number(source.size) - tableOffset,
			),
		),
	);
	if (!table) return undefined;
	if (table.length < 4 || table.readInt32LE(0) !== count) return undefined;
	if (table.length < 4 + count * FRAME_FIELDS_SIZE) return undefined;
	const frames: G00Frame[] = [];
	for (let i = 0; i < count; i += 1) {
		const cursor = 4 + i * FRAME_FIELDS_SIZE;
		const size = BigInt(table.readUInt32LE(cursor + 4));
		if (size === 0n) continue;
		frames.push({
			offset: BigInt(table.readUInt32LE(cursor)),
			size,
			index: i,
		});
	}
	if (frames.length === 0) return undefined;
	return frames;
}

async function readG00(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "g00") return undefined;
	const frames = await readG00Table(source);
	if (!frames) return undefined;
	const base = basename(sourcePath, ".g00");
	return frames.map((frame, id) =>
		createFixedEntry({
			id,
			path: `${base}#${String(frame.index).padStart(3, "0")}`,
			offset: frame.offset,
			size: frame.size,
			packedSize: frame.size,
			metadata: { type: "image" },
		}),
	);
}

/**
 * GARbro `G00Opener.OpenEntry` hands out a region of the unpacked frame table. The table is unpacked again for
 * every entry rather than cached, so the archive handle stays stateless.
 */
async function openG00Entry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const header = Buffer.from(
		await source.readAt(0n, Math.min(Number(source.size), FRAME_TABLE_OFFSET)),
	);
	const count = header.readInt16LE(5);
	const tableOffset = FRAME_TABLE_OFFSET + count * FRAME_HEADER_SIZE;
	const table = unpackG00Table(
		Buffer.from(
			await source.readAt(
				BigInt(tableOffset),
				Number(source.size) - tableOffset,
			),
		),
	);
	if (!table)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid RealLive frame table");
	const start = Number(entry.offset);
	const end = start + Number(entry.size);
	if (end > table.length)
		throw new GarbroError("INVALID_ARCHIVE", "Frame leaves the frame table");
	return Readable.from([table.subarray(start, end)]);
}

export const realliveG00Descriptor: FormatDescriptor = {
	id: "reallive-g00",
	name: "RealLive engine multi-frame image",
	extensions: ["g00"],
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
			source: "ArcFormats/RealLive/ArcG00.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const realliveG00Format = defineFixedArchive({
	descriptor: realliveG00Descriptor,
	detection: { signatures: [{ bytes: Buffer.from([FILE_TYPE]) }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readG00(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readG00(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid RealLive G00 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openG00Entry,
});
