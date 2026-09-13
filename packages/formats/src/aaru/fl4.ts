// Format reference: GARbro Legacy/Aaru/ArcFL4.cs, class `Fl4Opener` and `RleDecompressor`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { inflateAaruRle } from "./rle.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'FL4.0', the version string the archive opens with. */
const SIGNATURE = "FL4.0";
/** The data offset, the index size and the index offset live in the header. */
const DATA_OFFSET_FIELD = 8;
const INDEX_SIZE_FIELD = 0xa;
const INDEX_OFFSET_FIELD = 0xe;
const HEADER_SIZE = 0x1a;
/** Index records hold an offset, a size, a name length and the name. */
const RECORD_HEADER_SIZE = 9;
const TERMINATOR = 0xffffffff;
/** Payload headers the reader decides on at open time. */
const PD2A_MARKER = "PD2A";
const PD_MARKER = "PD";
const RLE_MARKER = "RD1.0";
const PD2A_HEADER_SIZE = 0x10;
const PD2A_SIZE_FIELD = 0xc;
const PD_HEADER_SIZE = 0xa;
const PD_SIZE_FIELD = 6;
const RLE_STREAM_FIELD = 6;
const RLE_CHUNKS_FIELD = 0xa;

/** The two LZSS variants decode to the end of their stream instead of a declared size. */
const METHOD_PD2A = "PD2A";
const METHOD_PD = "PD";
const METHOD_RLE = "RD1.0";

interface Fl4Entry {
	name: string;
	offset: bigint;
	storedSize: bigint;
	method: string;
	unpackedSize?: bigint;
	streamOffset: number;
	chunks?: number;
}

async function readFl4(source: ByteSource): Promise<Fl4Entry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (header.subarray(0, SIGNATURE.length).toString("latin1") !== SIGNATURE)
		return undefined;
	const dataOffset = BigInt(header.readUInt16LE(DATA_OFFSET_FIELD));
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_FIELD));
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset + indexSize > source.size) return undefined;
	if (indexSize < 4n) return undefined;
	const index = Buffer.from(
		await source.readAt(indexOffset, Number(indexSize)),
	);
	let position = index.readInt32LE(0);
	if (position <= 0) return undefined;
	const entries: Fl4Entry[] = [];
	while (position < index.length) {
		if (position + RECORD_HEADER_SIZE > index.length) return undefined;
		const relative = index.readUInt32LE(position);
		if (relative === TERMINATOR) break;
		const storedSize = BigInt(index.readUInt32LE(position + 4));
		const nameLength = index[position + 8] ?? 0;
		position += RECORD_HEADER_SIZE;
		if (position + nameLength > index.length) return undefined;
		const name = decodeCp932(index.subarray(position, position + nameLength));
		position += nameLength;
		const offset = BigInt(relative) + dataOffset;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push({
			name,
			offset,
			storedSize,
			method: "raw",
			streamOffset: 0,
		});
	}
	if (entries.length === 0) return undefined;
	// The reference probes the payload header when an entry is opened; the port resolves it while listing so
	// that the reported sizes and the extracted payload always agree.
	for (const entry of entries) {
		// The reference reads these fields straight from its view, so the probe is bounded by the file only.
		const available =
			source.size - entry.offset > BigInt(PD2A_HEADER_SIZE)
				? PD2A_HEADER_SIZE
				: Number(
						source.size - entry.offset > 0n ? source.size - entry.offset : 0n,
					);
		const probe = Buffer.from(await source.readAt(entry.offset, available));
		const marker = probe.subarray(0, RLE_MARKER.length).toString("latin1");
		if (marker.startsWith(PD2A_MARKER) && probe.length >= PD2A_HEADER_SIZE) {
			entry.method = METHOD_PD2A;
			entry.streamOffset = PD2A_HEADER_SIZE;
			entry.unpackedSize = BigInt(probe.readUInt32LE(PD2A_SIZE_FIELD));
			continue;
		}
		if (marker.startsWith(PD_MARKER) && probe.length >= PD_HEADER_SIZE) {
			entry.method = METHOD_PD;
			entry.streamOffset = PD_HEADER_SIZE;
			entry.unpackedSize = BigInt(probe.readUInt32LE(PD_SIZE_FIELD));
			continue;
		}
		if (marker.startsWith(RLE_MARKER) && probe.length >= RLE_CHUNKS_FIELD + 4) {
			entry.method = METHOD_RLE;
			entry.streamOffset = probe.readUInt16LE(RLE_STREAM_FIELD);
			entry.chunks = probe.readInt32LE(RLE_CHUNKS_FIELD);
		}
	}
	return entries;
}

function toFixedEntries(entries: readonly Fl4Entry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const fixed = createFixedEntry({
			id,
			path: entry.name,
			offset: entry.offset,
			size: entry.unpackedSize ?? entry.storedSize,
			packedSize: entry.storedSize,
			compressed: entry.method !== "raw",
			metadata: {
				type: "data",
				method: entry.method,
				streamOffset: entry.streamOffset,
				...(entry.chunks === undefined ? {} : { chunks: entry.chunks }),
			},
		});
		// The reference only knows the size of an LZSS payload from its header and never learns the size of
		// an RLE payload, so the latter stays unknown.
		if (entry.method === METHOD_RLE) return { ...fixed, sizeKnown: false };
		return fixed;
	});
}

/**
 * GARbro `Fl4Opener.OpenEntry`: the two LZSS variants start behind their headers and decode to the end of the
 * stream, while an `RD1.0` payload starts at an offset stored in its own header and holds a chunk count.
 */
async function openFl4Entry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	const method = String(entry.metadata?.method ?? "raw");
	if (method === METHOD_PD2A || method === METHOD_PD) {
		const start = Number(entry.metadata?.streamOffset ?? 0);
		return Readable.from([inflateLzssAll(stored.subarray(start))]);
	}
	if (method !== METHOD_RLE) return Readable.from([stored]);
	const start = Number(entry.metadata?.streamOffset ?? 0);
	const chunks = Number(entry.metadata?.chunks ?? 0);
	// The stream offset and the chunk count come from the payload header, so a payload that declares a start
	// behind itself would corrupt the read; the reference lets that read throw.
	if (start > stored.length)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Aaru RLE offset");
	return Readable.from([inflateAaruRle(stored.subarray(start), chunks)]);
}

export const aaruFl4Descriptor: FormatDescriptor = {
	id: "aaru-fl4",
	name: "Aaru resource archive",
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
			source: "Legacy/Aaru/ArcFL4.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aaruFl4Format = defineFixedArchive({
	descriptor: aaruFl4Descriptor,
	detection: { signatures: [{ bytes: Buffer.from(SIGNATURE, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readFl4(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readFl4(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Aaru FL4 layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: openFl4Entry,
});
