// Format reference: GARbro "ArcFormats/GameSystem/ArcPureMail.cs", class `PmDatOpener`.
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const TRAILER_SIZE = 12;
const TRAILER_XOR = 0xf0f0f0f0;
const RECORD_SIZE = 0x50;
const NAME_SIZE = 0x40;
const FLAG_PACKED_MASK = 0xff0000;
const FLAG_STORED_SIZE_MASK = 0x2000000;
const LZSS_FRAME_SIZE = 0x1000;
const LZSS_FRAME_MASK = LZSS_FRAME_SIZE - 1;
const LZSS_FRAME_INIT = 0xfee;
const LZSS_MATCH_BASE = 3;
const IMAGE_EXTENSIONS = [".crgb", ".char", ".rol", ".edg"];

/**
 * `PmDatOpener.LzUnpack`: the control byte is read most significant bit first, a clear bit marks a
 * literal and a set bit a match. A short stream leaves the remainder of the output zeroed.
 */
function unpackPmData(input: Buffer, outputLength: number): Buffer {
	const frame = Buffer.alloc(LZSS_FRAME_SIZE);
	const output = Buffer.alloc(outputLength);
	let source = 0;
	let dst = 0;
	let framePosition = LZSS_FRAME_INIT;
	let bits = 0;
	let mask = 0;
	while (dst < output.length) {
		mask >>= 1;
		if (mask === 0) {
			if (source >= input.length) break;
			bits = input[source] ?? 0;
			source += 1;
			mask = 0x80;
		}
		if ((bits & mask) === 0) {
			if (source >= input.length) break;
			const value = input[source] ?? 0;
			source += 1;
			output[dst] = value;
			dst += 1;
			frame[framePosition & LZSS_FRAME_MASK] = value;
			framePosition += 1;
		} else {
			if (source + 2 > input.length) break;
			const value = (input[source] ?? 0) | ((input[source + 1] ?? 0) << 8);
			source += 2;
			let offset = value >> 4;
			let count = (value & 0xf) + LZSS_MATCH_BASE;
			while (count > 0 && dst < output.length) {
				const copy = frame[offset & LZSS_FRAME_MASK] ?? 0;
				frame[framePosition & LZSS_FRAME_MASK] = copy;
				framePosition += 1;
				output[dst] = copy;
				dst += 1;
				offset += 1;
				count -= 1;
			}
		}
	}
	// A short stream leaves the rest of the buffer zeroed, matching the reference allocation.
	return output;
}

interface PmRecord {
	name: string;
	offset: bigint;
	size: number;
	unpackedSize: number;
	packed: boolean;
	storedSize: boolean;
}

function isImageName(name: string): boolean {
	const lower = name.toLowerCase();
	return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

async function readPmIndex(
	source: ByteSource,
): Promise<{ records: PmRecord[]; indexOffset: bigint } | undefined> {
	const maxOffset = source.size;
	if (maxOffset <= BigInt(TRAILER_SIZE) || maxOffset > 0xffffffffn)
		return undefined;
	const trailer = await source.readAt(
		maxOffset - BigInt(TRAILER_SIZE),
		TRAILER_SIZE,
	);
	const packedSize = (trailer.readUInt32LE(0) ^ TRAILER_XOR) >>> 0;
	const unpackedSize = (trailer.readUInt32LE(4) ^ TRAILER_XOR) >>> 0;
	const count = Math.trunc(unpackedSize / RECORD_SIZE);
	if (
		unpackedSize % RECORD_SIZE !== 0 ||
		BigInt(packedSize) >= maxOffset ||
		!isSaneCount(count)
	)
		return undefined;
	const indexOffset = maxOffset - BigInt(TRAILER_SIZE + packedSize);
	const stored = await source.readAt(indexOffset, packedSize);
	const unpacked = unpackPmData(stored, count * RECORD_SIZE);
	const records: PmRecord[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * RECORD_SIZE;
		const flags = unpacked.readUInt32LE(base);
		const name = decodeCStringField(unpacked, base + 4, NAME_SIZE);
		const offset = BigInt(unpacked.readUInt32LE(base + 4 + NAME_SIZE));
		const size = unpacked.readUInt32LE(base + 8 + NAME_SIZE);
		const unpackedEntrySize = unpacked.readUInt32LE(base + 12 + NAME_SIZE);
		if (!checkPlacement(offset, BigInt(size), maxOffset)) return undefined;
		records.push({
			name,
			offset,
			size,
			unpackedSize: unpackedEntrySize,
			packed: (flags & FLAG_PACKED_MASK) !== 0,
			storedSize: (flags & FLAG_STORED_SIZE_MASK) !== 0,
		});
	}
	return { records, indexOffset };
}

export const gamesystemPuremailDescriptor: FormatDescriptor = {
	id: "gamesystem-puremail",
	name: "PureMail resource archive",
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
			source: "ArcFormats/GameSystem/ArcPureMail.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gamesystemPuremailFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gamesystemPuremailDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPmIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readPmIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PureMail index");
		const entries: FixedEntry[] = index.records.map((record, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset: record.offset,
				size: BigInt(record.size),
				packedSize: BigInt(record.size),
				compressed: record.packed,
				metadata: {
					unpackedSize: record.unpackedSize,
					storedSize: record.storedSize,
					...(isImageName(record.name) ? { type: "image" } : {}),
				},
			});
			return record.packed ? { ...created, sizeKnown: false } : created;
		});
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				indexOffset: Number(index.indexOffset),
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { unpackedSize?: number; storedSize?: boolean }
			| undefined;
		const stored = await source.readAt(entry.offset, Number(entry.packedSize));
		if (!entry.compressed) return Readable.from([Buffer.from(stored)]);
		let payload = stored;
		let outputLength = metadata?.unpackedSize ?? 0;
		if (metadata?.storedSize && stored.length >= 4) {
			outputLength = stored.readUInt32LE(0);
			payload = stored.subarray(4);
		}
		return Readable.from([unpackPmData(payload, outputLength)]);
	},
});
