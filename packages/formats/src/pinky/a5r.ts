// Format reference: GARbro "Legacy/Pinky/ArcA5R.cs", classes `A5rOpener`, `A5rEntry`, `A5Segment`
// and `A5rStream`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURES = ["PCRS", "PLIB"];
const HEADER_SIZE = 0x38;
const COUNT_OFFSET = 0x30;
const INDEX_OFFSET_POSITION = 0x34;
const SEGMENT_SIZE = 0x0a;
const SEGMENT_AUDIO = 0x3c;
const SEGMENT_IMAGE = 0x3e;
const COMPRESSION_ZLIB = 3;

interface A5Segment {
	offset: bigint;
	size: number;
	unpackedSize: number;
	type: number;
	compressed: boolean;
}

/** Serialised segment records keep their offsets as numbers so metadata stays plain JSON data. */
interface SegmentRecord {
	offset: number;
	size: number;
	unpackedSize: number;
	type: number;
	compressed: boolean;
}

function recordOf(segment: A5Segment): SegmentRecord {
	return {
		offset: Number(segment.offset),
		size: segment.size,
		unpackedSize: segment.unpackedSize,
		type: segment.type,
		compressed: segment.compressed,
	};
}

async function readA5rSegments(
	source: ByteSource,
): Promise<A5Segment[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const id = header.readUInt32LE(0);
	if (header.readUInt32LE(4) !== ~id >>> 0) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = header.readUInt32LE(INDEX_OFFSET_POSITION);
	if (BigInt(indexOffset) >= source.size) return undefined;
	// Records overlap: each one starts where the previous record's next-offset field sits, so the
	// table is a leading offset, ten bytes per record, and a trailing next-offset field.
	const tableSize = count * SEGMENT_SIZE + 8;
	if (BigInt(indexOffset) + BigInt(tableSize) > source.size) return undefined;
	const table = Buffer.from(
		await source.readAt(BigInt(indexOffset), tableSize),
	);
	const segments: A5Segment[] = [];
	let nextOffset = table.readUInt32LE(0);
	for (let i = 0; i < count; i += 1) {
		const position = i * SEGMENT_SIZE;
		const offset = nextOffset;
		const unpackedSize = table.readUInt32LE(position + 4);
		const type = table[position + 8] ?? 0;
		const compression = table[position + 9] ?? 0;
		nextOffset = table.readUInt32LE(position + 0x0a);
		// The next record starts after this one, and the last one ends inside the file.
		if (BigInt(nextOffset) > source.size || nextOffset < offset)
			return undefined;
		segments.push({
			offset: BigInt(offset),
			size: nextOffset - offset,
			unpackedSize,
			type,
			compressed: compression === COMPRESSION_ZLIB,
		});
	}
	for (const segment of segments) {
		if (!checkPlacement(segment.offset, BigInt(segment.size), source.size))
			return undefined;
	}
	return segments;
}

/** Reads a segment, decompressing it when it is a zlib stream. */
async function readA5Segment(
	source: ByteSource,
	segment: { offset: number; size: number; compressed: boolean },
): Promise<Buffer> {
	const stored = Buffer.from(
		await source.readAt(BigInt(segment.offset), segment.size),
	);
	if (!segment.compressed) return stored;
	const inflated = await inflateZlibBuffer(stored);
	return Buffer.from(inflated);
}

interface A5rEntry {
	name: string;
	type: string;
	segments: A5Segment[];
}

/** `A5rOpener.TryOpen`: consecutive audio segments are merged into one RIFF entry. */
async function buildA5rEntries(
	source: ByteSource,
	baseName: string,
): Promise<A5rEntry[] | undefined> {
	const segments = await readA5rSegments(source);
	if (!segments) return undefined;
	const entries: A5rEntry[] = [];
	let index = 0;
	while (index < segments.length) {
		let segment = segments[index] as A5Segment;
		const name = `${baseName}#${index.toString().padStart(5, "0")}`;
		if (segment.type === SEGMENT_AUDIO) {
			// A RIFF header marks the start of a split audio file; the following audio segments are
			// appended until the accumulated unpacked size reaches the declared RIFF size.
			let head: Buffer | undefined;
			try {
				head = await readA5Segment(source, recordOf(segment));
			} catch {
				head = undefined;
			}
			if (
				head &&
				head.length >= 8 &&
				head.toString("latin1", 0, 4) === "RIFF"
			) {
				const riffSize = head.readUInt32LE(4);
				const group: A5Segment[] = [];
				let unpackedTotal = 0;
				for (;;) {
					group.push(segment);
					unpackedTotal += segment.unpackedSize;
					index += 1;
					if (index >= segments.length || unpackedTotal >= riffSize) break;
					segment = segments[index] as A5Segment;
					if (segment.type !== SEGMENT_AUDIO) break;
				}
				entries.push({ name: `${name}.wav`, type: "audio", segments: group });
				continue;
			}
		}
		const image = segment.type === SEGMENT_IMAGE;
		entries.push({
			name: image ? `${name}.bmp` : name,
			type: image ? "image" : "",
			segments: [segment],
		});
		index += 1;
	}
	return entries;
}

function baseNameOf(sourcePath: string): string {
	const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
	const dot = fileName.lastIndexOf(".");
	return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function entrySizes(entry: A5rEntry): {
	size: number;
	packedSize: number;
	compressed: boolean;
	sizeKnown: boolean;
} {
	const compressed = entry.segments.some((segment) => segment.compressed);
	if (entry.segments.length === 1) {
		const segment = entry.segments[0] as A5Segment;
		return {
			size: segment.unpackedSize,
			packedSize: segment.size,
			compressed,
			sizeKnown: !compressed && segment.unpackedSize === segment.size,
		};
	}
	return {
		size: entry.segments.reduce((total, s) => total + s.unpackedSize, 0),
		packedSize: entry.segments.reduce((total, s) => total + s.size, 0),
		compressed,
		sizeKnown: !compressed,
	};
}

export const pinkyA5rDescriptor: FormatDescriptor = {
	id: "pinky-a5r",
	name: "Pinky Soft resource archive",
	extensions: ["a5r", "a5e"],
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
			source: "Legacy/Pinky/ArcA5R.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pinkyA5rFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pinkyA5rDescriptor,
	detection: {
		signatures: SIGNATURES.map((signature) => ({
			bytes: Buffer.from(signature, "latin1"),
		})),
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (
			(await buildA5rEntries(source, baseNameOf(sourcePath))) !== undefined
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await buildA5rEntries(source, baseNameOf(sourcePath));
		if (!entries) throw new GarbroError("INVALID_ARCHIVE", "Invalid A5R index");
		const fixed: FixedEntry[] = entries.map((entry, id) => {
			const sizes = entrySizes(entry);
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.segments[0]?.offset ?? 0n,
				size: BigInt(sizes.size),
				packedSize: BigInt(sizes.packedSize),
				compressed: sizes.compressed,
				metadata: {
					segments: entry.segments.map(recordOf),
					type: entry.type,
				},
			});
			return sizes.sizeKnown ? created : { ...created, sizeKnown: false };
		});
		return { entries: fixed, metadata: { entryCount: fixed.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.packedSize === 0n) return Readable.from([]);
		const metadata = entry.metadata as
			| { segments?: SegmentRecord[] }
			| undefined;
		const segments = metadata?.segments ?? [];
		if (segments.length === 0) return Readable.from([]);
		const parts: Buffer[] = [];
		for (const segment of segments)
			parts.push(await readA5Segment(source, segment));
		return Readable.from([Buffer.concat(parts)]);
	},
});
