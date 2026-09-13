// Format reference: GARbro Legacy/Eve/ArcGM.cs, classes `GmDatOpener` and `BprDecompressor`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'GM1.', the first four bytes of the version string `GM1.0`. */
const SIGNATURE = 0x2e314d47;
const VERSION_BYTE = 0x30;
/** The version string is a C string; the header behind it starts on a four byte boundary after four extra bytes. */
const VERSION_SCAN_LIMIT = 0x100;
const ALIGNMENT_BIAS = 4;
/** Two offset words, two size words, a count and two words the reference reads but ignores. */
const HEADER_BLOCK_SIZE = 18;
/** The index records start this far behind the declared index offset. */
const INDEX_BIAS = 0xc00;
/** Index records hold an offset, a size and a length prefixed name. */
const DATA_OFFSET_FIELD = 0;
/** The payload header is twenty-five bytes long and the compressed stream starts inside it. */
const ENTRY_HEADER_SIZE = 25;
const STREAM_OFFSET_IN_HEADER = 10;
const UNPACKED_SIZE_FIELD = 6;
const TYPE_FIRST = 0x42;
const TYPE_LAST = 0x45;
const TYPE_SWAPPED = 0x45;
const VERSION_CHAR = 0x31;
const SWAP_FIELDS: readonly [number, number][] = [
	[17, 23],
	[19, 24],
];
/** A payload that carries this marker behind its first stage is compressed twice. */
const BPR_MARKER = "BPR01";
const BPR_DATA_OFFSET = 5;
const BPR_END = 0xff;
const BPR_REPEAT = 1;

interface GmEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

/** Finds the NUL byte that ends the version string, or undefined when it is not inside the scanned window. */
function findVersionEnd(header: Buffer): number | undefined {
	for (let i = 0; i < header.length; i += 1) if (header[i] === 0) return i + 1;
	return undefined;
}

async function readGm(source: ByteSource): Promise<GmEntry[] | undefined> {
	const window = Math.min(Number(source.size), VERSION_SCAN_LIMIT);
	if (window < 5) return undefined;
	const head = Buffer.from(await source.readAt(0n, window));
	if (head.readUInt32LE(0) !== SIGNATURE) return undefined;
	if (head[4] !== VERSION_BYTE) return undefined;
	const versionEnd = findVersionEnd(head);
	if (versionEnd === undefined) return undefined;
	// GARbro aligns the position behind the version string, biased by four bytes, to a four byte boundary.
	const headerOffset = ((versionEnd + ALIGNMENT_BIAS) >> 2) << 2;
	if (BigInt(headerOffset) + BigInt(HEADER_BLOCK_SIZE) > source.size)
		return undefined;
	const header = Buffer.from(
		await source.readAt(BigInt(headerOffset), HEADER_BLOCK_SIZE),
	);
	const dataOffset = BigInt(header.readUInt16LE(DATA_OFFSET_FIELD));
	const indexOffset = BigInt(header.readUInt32LE(6));
	const count = header.readInt32LE(10);
	if (!isSaneCount(count)) return undefined;
	// The key length and the flags words that follow the count are read but never used by the reference.
	const recordsOffset = indexOffset + BigInt(INDEX_BIAS);
	if (recordsOffset >= source.size) return undefined;
	const entries: GmEntry[] = [];
	let cursor = 0;
	while (entries.length < count) {
		const start = recordsOffset + BigInt(cursor);
		if (start + 9n > source.size) return undefined;
		const record = Buffer.from(await source.readAt(start, 9));
		const nameLength = record[8] ?? 0;
		if (nameLength === 0) return undefined;
		const offset = BigInt(record.readUInt32LE(0)) + dataOffset;
		const size = BigInt(record.readUInt32LE(4));
		if (start + 9n + BigInt(nameLength) > source.size) return undefined;
		const rawName = Buffer.from(await source.readAt(start + 9n, nameLength));
		cursor += 9 + nameLength;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const end = rawName.indexOf(0);
		entries.push({
			name: decodeCp932(end === -1 ? rawName : rawName.subarray(0, end)),
			offset,
			size,
		});
	}
	return entries;
}

/**
 * GARbro `BprDecompressor`: a run length pass that opens the payload behind the `BPR01` marker. A control byte
 * of `0xFF` ends the stream, a control byte of one repeats the byte that follows and any other control byte
 * copies that many bytes from the stream as they are.
 */
function unpackBpr(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	let cursor = BPR_DATA_OFFSET;
	for (;;) {
		const control = data[cursor];
		cursor += 1;
		if (control === undefined || control === BPR_END) break;
		if (cursor + 4 > data.length) break;
		const count = data.readInt32LE(cursor);
		cursor += 4;
		if (count <= 0) break;
		if (control === BPR_REPEAT) {
			const value = data[cursor] ?? 0;
			cursor += 1;
			chunks.push(Buffer.alloc(count, value));
			continue;
		}
		const chunk = data.subarray(cursor, cursor + count);
		cursor += chunk.length;
		chunks.push(chunk);
		if (chunk.length < count) break;
	}
	return Buffer.concat(chunks);
}

/**
 * GARbro `GmDatOpener.OpenEntry`: a payload is compressed when its header starts with a letter between B and E
 * followed by a one. An `E` header swaps two pairs of bytes before the LZSS stream at offset ten is decoded,
 * and a decoded payload that starts with `BPR01` is run through a second pass.
 */
async function openGmEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const header = stored.subarray(0, ENTRY_HEADER_SIZE);
	const first = header[0] ?? 0;
	if (
		header.length < ENTRY_HEADER_SIZE ||
		first < TYPE_FIRST ||
		first > TYPE_LAST ||
		header[1] !== VERSION_CHAR
	)
		return Readable.from([stored]);
	if (first === TYPE_SWAPPED) {
		for (const [left, right] of SWAP_FIELDS) {
			const temporary = header[left] ?? 0;
			header[left] = header[right] ?? 0;
			header[right] = temporary;
		}
	}
	const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize <= 0)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Eve unpacked size");
	const stream = Buffer.concat([
		header.subarray(STREAM_OFFSET_IN_HEADER),
		stored.subarray(ENTRY_HEADER_SIZE),
	]);
	const data = inflateLzss(stream, { outputLength: unpackedSize });
	if (data.subarray(0, BPR_MARKER.length).toString("latin1") !== BPR_MARKER)
		return Readable.from([data]);
	return Readable.from([unpackBpr(data)]);
}

export const eveGmDescriptor: FormatDescriptor = {
	id: "eve-gm",
	name: "Eve resource archive",
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
			source: "Legacy/Eve/ArcGM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eveGmFormat = defineFixedArchive({
	descriptor: eveGmDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("GM1.0", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readGm(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readGm(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Eve layout");
		return {
			entries: entries.map((entry, id) =>
				createFixedEntry({
					id,
					path: entry.name,
					offset: entry.offset,
					size: entry.size,
					packedSize: entry.size,
					metadata: { type: "data" },
				}),
			),
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: openGmEntry,
});
