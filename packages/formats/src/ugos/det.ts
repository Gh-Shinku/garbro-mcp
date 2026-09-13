// Format reference: GARbro ArcFormats/uGOS/ArcDET.cs, classes `DetOpener`, `DetIndexReader` and
// `RleDecompressor`. GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The archive has no signature; its extension and its two companion files identify it. */
const ARCHIVE_EXTENSION = "det";
const NAME_EXTENSION = "nme";
const INDEX_EXTENSIONS = ["atm", "at2"];
/** The older index layout has no unpacked size field. */
const SMALL_RECORD_SIZE = 0x10;
const LARGE_RECORD_SIZE = 0x14;
const NAME_OFFSET_FIELD = 0;
const ENTRY_OFFSET_FIELD = 4;
const ENTRY_SIZE_FIELD = 8;
const UNPACKED_SIZE_FIELD = 0x10;
/** A name with this suffix marks an image. */
const IMAGE_SUFFIX = ".bmp.txt";
/** The RLE stream keeps a 0x100 byte sliding history. */
const HISTORY_SIZE = 0x100;
const HISTORY_MASK = 0xff;
const REPEAT_ESCAPE = 0xff;
const REPEAT_MIN_COUNT = 3;
const REPEAT_COUNT_BITS = 3;
const REPEAT_DISTANCE_SHIFT = 2;

/**
 * GARbro `RleDecompressor.Unpack`. Every byte also enters a 0x100 byte history. `0xFF` escapes: a second
 * `0xFF` is a literal byte, anything else copies three to six bytes from `(control >> 2) + 1` bytes behind
 * the current history position. The stream ends when its input ends.
 */
export function inflateDetRle(
	input: Uint8Array,
	outputLength?: number,
): Buffer {
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const history = Buffer.alloc(HISTORY_SIZE);
	const parts: Buffer[] = [];
	let pending = Buffer.alloc(64 * 1024);
	let pendingLength = 0;
	let historyPosition = 0;
	let limit = outputLength ?? Number.POSITIVE_INFINITY;
	const emit = (value: number): void => {
		if (limit <= 0) return;
		if (pendingLength === pending.length) {
			parts.push(pending);
			pending = Buffer.alloc(64 * 1024);
			pendingLength = 0;
		}
		pending[pendingLength++] = value;
		history[historyPosition++ & HISTORY_MASK] = value;
		limit -= 1;
	};
	let position = 0;
	while (position < source.length && limit > 0) {
		const control = source[position++] ?? 0;
		if (control !== REPEAT_ESCAPE) {
			emit(control);
			continue;
		}
		if (position >= source.length) break;
		const repeated = source[position++] ?? 0;
		if (repeated === REPEAT_ESCAPE) {
			emit(REPEAT_ESCAPE);
			continue;
		}
		let offset = historyPosition - ((repeated >> REPEAT_DISTANCE_SHIFT) + 1);
		let count = (repeated & REPEAT_COUNT_BITS) + REPEAT_MIN_COUNT;
		while (count > 0 && limit > 0) {
			emit(history[offset++ & HISTORY_MASK] ?? 0);
			count -= 1;
		}
	}
	parts.push(pending.subarray(0, pendingLength));
	return Buffer.concat(parts);
}

interface DetRecord {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize?: bigint;
}

/**
 * GARbro `DetIndexReader.ReadIndex`. The index is a flat array of records whose names live in a companion
 * `.nme` file, addressed by an offset into that file. The compact layout stores no unpacked size, which is
 * why the reader retries it with the larger record size.
 */
async function readIndex(
	indexFile: Buffer,
	names: Buffer,
	arcSize: bigint,
	recordSize: number,
): Promise<DetRecord[] | undefined> {
	const count = Math.trunc(indexFile.length / recordSize);
	if (!isSaneCount(count)) return undefined;
	const records: DetRecord[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * recordSize;
		if (position + recordSize > indexFile.length) return undefined;
		const nameOffset = indexFile.readInt32LE(position + NAME_OFFSET_FIELD);
		if (nameOffset < 0 || nameOffset >= names.length) return undefined;
		const end = names.indexOf(0, nameOffset);
		const name = decodeCp932(
			end === -1 ? names.subarray(nameOffset) : names.subarray(nameOffset, end),
		);
		const offset = BigInt(
			indexFile.readUInt32LE(position + ENTRY_OFFSET_FIELD),
		);
		const size = BigInt(indexFile.readUInt32LE(position + ENTRY_SIZE_FIELD));
		if (!checkPlacement(offset, size, arcSize)) return undefined;
		const record: DetRecord = { name, offset, size };
		if (recordSize >= LARGE_RECORD_SIZE)
			record.unpackedSize = BigInt(
				indexFile.readUInt32LE(position + UNPACKED_SIZE_FIELD),
			);
		records.push(record);
	}
	return records;
}

async function readDetIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== ARCHIVE_EXTENSION) return undefined;
	const names = await readCompanionFile(
		sourcePath,
		changeExtension(sourcePath, NAME_EXTENSION),
	);
	if (!names) return undefined;
	let indexFile: Buffer | undefined;
	let recordSize = SMALL_RECORD_SIZE;
	for (const extension of INDEX_EXTENSIONS) {
		indexFile = await readCompanionFile(
			sourcePath,
			changeExtension(sourcePath, extension),
		);
		if (indexFile) {
			if (extension === INDEX_EXTENSIONS[1]) recordSize = LARGE_RECORD_SIZE;
			break;
		}
	}
	if (!indexFile) return undefined;
	let records = await readIndex(indexFile, names, source.size, recordSize);
	if (!records && recordSize !== LARGE_RECORD_SIZE)
		records = await readIndex(indexFile, names, source.size, LARGE_RECORD_SIZE);
	if (!records) return undefined;
	const entries: FixedEntry[] = [];
	for (const record of records) {
		const compressed = true;
		const fixed = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(record.name),
			offset: record.offset,
			size: record.unpackedSize ?? record.size,
			packedSize: record.size,
			compressed,
			metadata: {
				type: record.name.toLowerCase().endsWith(IMAGE_SUFFIX)
					? "image"
					: "data",
			},
		});
		// Without the larger record layout the reference never learns the unpacked size.
		entries.push(
			record.unpackedSize === undefined
				? { ...fixed, sizeKnown: false }
				: fixed,
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const detDescriptor: FormatDescriptor = {
	id: "ugos-det",
	name: "μ-GameOperationSystem resource archive",
	extensions: ["det"],
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
			source: "ArcFormats/uGOS/ArcDET.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const detFormat = defineFixedArchive({
	descriptor: detDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readDetIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDetIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid μ-GameOperationSystem DET layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	/** `DetOpener.OpenEntry`: every listed entry is ready to be decoded from its stored range. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		return Readable.from([
			inflateDetRle(
				stored,
				entry.sizeKnown === false ? undefined : Number(entry.size),
			),
		]);
	},
});
