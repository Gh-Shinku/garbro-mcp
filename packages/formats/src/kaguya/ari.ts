// Format reference: GARbro ArcFormats/Kaguya/ArcKaguya.cs, classes `ArcOpener`, `AriEntry`,
// `IndexReader` and `LzReader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("WFL1", "latin1");
const HEADER_SIZE = 4;
const NAME_LENGTH_SIZE = 4;
const MODE_SIZE = 2;
const SIZE_FIELD_SIZE = 4;
/** The declared unpacked size sits in front of a packed payload, in the inline and in the side index. */
const PACKED_PREFIX_SIZE = 4;
const RECORD_FIXED_SIZE = MODE_SIZE + SIZE_FIELD_SIZE;
const MAX_NAME_SIZE = 0x100;
const NAME_KEY = 0xff;
const MODE_PACKED = 1;
const MODE_AUDIO = 2;
const SIDE_INDEX_EXTENSION = "ari";
const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_INIT_POSITION = 1;
const LITERAL_BIT = 1;
const WINDOW_BITS = 12;
const COUNT_BITS = 4;
const COUNT_BIAS = 2;
const AUDIO_EXTENSIONS = [".ogg"];
const IMAGE_EXTENSIONS = [".ap", ".aps", ".aps3"];

interface AriEntry {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
	packed: boolean;
	mode: number;
}

/** `IndexReader.DecryptName`: the name bytes are complemented and decoded as CP932. */
export function decryptAriName(bytes: Buffer): string {
	const plain = Buffer.alloc(bytes.length);
	for (const [index, byte] of bytes.entries()) plain[index] = byte ^ NAME_KEY;
	return decodeCp932(plain).replace(/^[\\/]+/, "");
}

/** `LzReader.Unpack`: an msb first stream with 8 bit literals and a 0x1000 byte sliding frame. */
export function inflateKaguyaLz(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(Math.max(outputLength, 0));
	const frame = Buffer.alloc(FRAME_SIZE);
	const bits = new MsbBitReader(input);
	let framePosition = FRAME_INIT_POSITION;
	let target = 0;
	while (target < output.length) {
		const bit = bits.tryReadBits(1);
		if (bit === -1) break;
		if (bit === LITERAL_BIT) {
			const value = bits.tryReadBits(8);
			if (value === -1) break;
			output[target] = value;
			target += 1;
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & FRAME_MASK;
			continue;
		}
		const windowOffset = bits.tryReadBits(WINDOW_BITS);
		if (windowOffset === -1 || windowOffset === 0) break;
		const rawCount = bits.tryReadBits(COUNT_BITS);
		if (rawCount === -1) break;
		const count = rawCount + COUNT_BIAS;
		for (let index = 0; index < count; index += 1) {
			const value = frame[(windowOffset + index) & FRAME_MASK] ?? 0;
			if (target < output.length) {
				output[target] = value;
				target += 1;
			}
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & FRAME_MASK;
		}
	}
	return output.subarray(0, Math.min(target, output.length));
}

/**
 * Reads a record table from either the archive itself or its side index. The records carry the name, the mode
 * and the stored size; the payloads follow the record table in the archive, so the payload cursor advances
 * through both the records and the payloads, while the record cursor only moves through the records. In the
 * inline form the two cursors are the same.
 */
async function readAriEntries(options: {
	readRecord: (offset: number, length: number) => Promise<Buffer>;
	totalSize: bigint;
	recordLimit: number;
	inline: boolean;
}): Promise<AriEntry[] | undefined> {
	const { readRecord, totalSize, recordLimit, inline } = options;
	const entries: AriEntry[] = [];
	let recordCursor = 0;
	let payloadCursor = BigInt(HEADER_SIZE);
	while (
		inline
			? payloadCursor + BigInt(NAME_LENGTH_SIZE) < totalSize
			: recordCursor + NAME_LENGTH_SIZE < recordLimit
	) {
		const base = inline ? Number(payloadCursor) : recordCursor;
		const header = await readRecord(base, NAME_LENGTH_SIZE);
		const nameLength = header.readInt32LE(0);
		if (
			nameLength <= 0 ||
			nameLength > MAX_NAME_SIZE ||
			base + nameLength + RECORD_FIXED_SIZE >
				(inline ? Number(totalSize) : recordLimit)
		)
			return undefined;
		const nameBytes = await readRecord(base + NAME_LENGTH_SIZE, nameLength);
		const name = decryptAriName(nameBytes);
		if (name.length === 0) return undefined;
		recordCursor = base + NAME_LENGTH_SIZE + nameLength;
		payloadCursor += BigInt(NAME_LENGTH_SIZE + nameLength + RECORD_FIXED_SIZE);
		const record = await readRecord(recordCursor, RECORD_FIXED_SIZE);
		const mode = record.readUInt16LE(0);
		const size = BigInt(record.readUInt32LE(MODE_SIZE));
		recordCursor += RECORD_FIXED_SIZE;
		let unpackedSize = 0n;
		if (mode === MODE_PACKED) {
			const declared = await readRecord(
				Number(payloadCursor),
				PACKED_PREFIX_SIZE,
			);
			unpackedSize = BigInt(declared.readUInt32LE(0));
			payloadCursor += BigInt(PACKED_PREFIX_SIZE);
		}
		if (!checkPlacement(payloadCursor, size, totalSize)) return undefined;
		entries.push({
			name,
			offset: payloadCursor,
			size,
			unpackedSize,
			packed: mode === MODE_PACKED,
			mode,
		});
		payloadCursor += size;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function bufferReader(data: Buffer) {
	return async (offset: number, length: number): Promise<Buffer> =>
		data.subarray(offset, offset + length);
}

function sourceReader(source: ByteSource) {
	return async (offset: number, length: number): Promise<Buffer> =>
		Buffer.from(await source.readAt(BigInt(offset), length));
}

async function readSideIndex(
	sourcePath: string,
): Promise<{ data: Buffer; name: string } | undefined> {
	const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
	const dot = fileName.lastIndexOf(".");
	const base = dot > 0 ? fileName.slice(0, dot) : fileName;
	if (base.length === 0) return undefined;
	if (fileName.toLowerCase().endsWith(`.${SIDE_INDEX_EXTENSION}`))
		return undefined;
	const data = await readCompanionFile(
		sourcePath,
		`${base}.${SIDE_INDEX_EXTENSION}`,
	);
	if (!data) return undefined;
	return { data, name: `${base}.${SIDE_INDEX_EXTENSION}` };
}

/** `IndexReader.ReadIndex`: the side index wins, the inline table is the fallback. */
async function readAri(
	source: ByteSource,
	sourcePath: string,
): Promise<AriEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const head = await source.readAt(0n, HEADER_SIZE);
	if (!head.equals(SIGNATURE)) return undefined;
	const side = await readSideIndex(sourcePath);
	if (side) {
		const entries = await readAriEntries({
			readRecord: bufferReader(side.data),
			totalSize: source.size,
			recordLimit: side.data.length,
			inline: false,
		});
		if (entries) return entries;
	}
	return readAriEntries({
		readRecord: sourceReader(source),
		totalSize: source.size,
		recordLimit: Number(source.size),
		inline: true,
	});
}

function entryType(entry: AriEntry): string {
	if (entry.mode === MODE_AUDIO) return "audio";
	if (entry.mode === MODE_PACKED) return "image";
	const name = entry.name.toLowerCase();
	if (AUDIO_EXTENSIONS.some((extension) => name.endsWith(extension)))
		return "audio";
	if (IMAGE_EXTENSIONS.some((extension) => name.endsWith(extension)))
		return "image";
	return "data";
}

function toFixedEntries(entries: readonly AriEntry[]): FixedEntry[] {
	return entries.map((entry, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.packed ? entry.unpackedSize : entry.size,
			packedSize: entry.size,
			compressed: entry.packed,
			metadata: { type: entryType(entry) },
		}),
	);
}

export const kaguyaAriDescriptor: FormatDescriptor = {
	id: "kaguya-ari",
	name: "KaGuYa script engine resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Kaguya/ArcKaguya.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kaguyaAriFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaguyaAriDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAri(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAri(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa ARI layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (!entry.compressed) return Readable.from([stored]);
		return Readable.from([inflateKaguyaLz(stored, Number(entry.size))]);
	},
});
