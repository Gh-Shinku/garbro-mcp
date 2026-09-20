// Reference: GARbro "ArcFormats/AZSys/ArcAZSys.cs", the classes `ArcOpener`, `AsbArchive` and `IndexReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { crc32, inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

/** The plain-text AZSystem archive magic (`ARC\x1a`), the reference's `Signature` constant. */
const SIGNATURE = 0x1a435241;
const ARC_MARK = "ARC\x1a";
const ASB_MARK = "ASB\x1a";
const HEAD_SIZE = 0x30;
const EXT_COUNT_AT = 4;
const COUNT_AT = 8;
const INDEX_LENGTH_AT = 0x0c;
const MOST_EXT = 8;
const MOST_COUNT = 0xfffff;
const MOST_INDEX_HEAD = 0x14;
const INDEX_CHECK_AT = 0x14;
const CONTROL_LENGTH_AT = 4;
const COMPRESSED_ONE_LENGTH_AT = 8;
const COMPRESSED_TWO_LENGTH_AT = 0x0c;
const OUTPUT_LENGTH_AT = 0x10;
const RECORD_SIZE = 0x40;
const RECORD_OFFSET_AT = 0x00;
const RECORD_SIZE_AT = 4;
const RECORD_NAME_AT = 0x10;
const RECORD_NAME_SIZE = 0x30;
/** Layout and bit-field constants of the packed index and of the ASB entries. */
const BACK_LENGTH_AT = 13;
const BACK_LENGTH_LEAST = 3;
const BACK_OFFSET_PLACES = 0x1fff;
const MASK_PLACES = 0x80;
const LEAST_RUN = 1;
const ASB_KEY_AT = 4;
const ASB_UNPACKED_AT = 8;
const ASB_HEAD = 12;
const ASB_SPOT_AT = 16;
const ASB_SPOT = 0xda78;
const KEY_SHIFT = 12;
const KEY_SECOND_SHIFT = 11;
const WORD = 4;
const CP932 = new TextDecoder("shift_jis");

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `Binary.CopyOverlapped`: copies `count` bytes from `source` to `target`; when the ranges overlap progressively, the copy repeats with period `target - source`. */
export function copyOverlapped(
	out: Buffer,
	source: number,
	target: number,
	count: number,
): void {
	if (target <= source) {
		for (let i = 0; i < count; i += 1) out[target + i] = out[source + i] ?? 0;
		return;
	}
	// The reference re-reads bytes it has already written, so an overlapping copy repeats with period `span`.
	const span = target - source;
	for (let i = 0; i < count; i += 1)
		out[target + i] = out[source + (i % span)] ?? 0;
}

/** `IndexReader.Unpack`: LZSS over two streams driven by an MSB-first control bitmask; `outputLength` must be `count * RECORD_SIZE`. */
export function unpackAzIndex(
	packed: Buffer,
	count: number,
): Buffer | undefined {
	if (packed.length < MOST_INDEX_HEAD + WORD) return undefined;
	const controlLength = packed.readInt32LE(CONTROL_LENGTH_AT);
	const oneLength = packed.readInt32LE(COMPRESSED_ONE_LENGTH_AT);
	const twoLength = packed.readInt32LE(COMPRESSED_TWO_LENGTH_AT);
	const outputLength = packed.readInt32LE(OUTPUT_LENGTH_AT);
	const control = MOST_INDEX_HEAD;
	const one = control + controlLength;
	const two = one + oneLength;
	if (
		controlLength < 0 ||
		oneLength < 0 ||
		twoLength < 0 ||
		outputLength < 0 ||
		outputLength !== count * RECORD_SIZE ||
		one + oneLength > packed.length ||
		two + twoLength > packed.length
	)
		return undefined;
	const out = Buffer.alloc(outputLength, 0x00);
	let at = control;
	let oneAt = one;
	let twoAt = two;
	let dst = 0;
	let mask = MASK_PLACES;
	while (dst < outputLength && at < packed.length) {
		if (((packed[at] ?? 0) & mask) !== 0) {
			if (oneAt + 2 > two) return undefined;
			const back = packed.readUInt16LE(oneAt);
			oneAt += 2;
			const length = (back >> BACK_LENGTH_AT) + BACK_LENGTH_LEAST;
			const offset = (back & BACK_OFFSET_PLACES) + 1;
			if (offset > dst) return undefined;
			copyOverlapped(
				out,
				dst - offset,
				dst,
				Math.min(length, outputLength - dst),
			);
			dst += length;
		} else {
			if (twoAt >= packed.length) return undefined;
			const length = (packed[twoAt] ?? 0) + LEAST_RUN;
			twoAt += 1;
			if (twoAt + length > packed.length) return undefined;
			const copied = Math.min(length, outputLength - dst);
			packed.copy(out, dst, twoAt, twoAt + copied);
			twoAt += length;
			dst += length;
		}
		mask >>= 1;
		if (mask === 0) {
			at += 1;
			mask = MASK_PLACES;
		}
	}
	return out;
}

/** One record of the unpacked index. */
export interface AzArcEntry {
	path: string;
	offset: number;
	size: number;
	asb: boolean;
}

/** The result of a successful head and index walk. */
export interface AzArcLayout {
	entries: AzArcEntry[];
	containsScripts: boolean;
}

/**
/** `ArcOpener.TryOpen`: validates the head, unpacks the index and walks the `0x40`-byte records. */
export function readAzArcLayout(data: Buffer): AzArcLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (data.readUInt32LE(0) !== SIGNATURE) return undefined;
	const extCount = data.readInt32LE(EXT_COUNT_AT);
	const count = data.readInt32LE(COUNT_AT);
	const indexLength = data.readUInt32LE(INDEX_LENGTH_AT);
	if (
		extCount < 1 ||
		extCount > MOST_EXT ||
		count <= 0 ||
		count > MOST_COUNT ||
		indexLength <= MOST_INDEX_HEAD ||
		indexLength >= data.length ||
		HEAD_SIZE + indexLength > data.length
	)
		return undefined;
	const packed = Buffer.from(data.subarray(HEAD_SIZE, HEAD_SIZE + indexLength));
	const checksum = packed.readUInt32LE(0);
	if (checksum !== crc32(packed.subarray(INDEX_CHECK_AT)))
		throw invalidArchive("CRC32 mismatch");
	const index = unpackAzIndex(packed, count);
	if (!index) return undefined;
	const base = HEAD_SIZE + indexLength;
	const entries: AzArcEntry[] = [];
	let containsScripts = false;
	for (let i = 0; i < count; i += 1) {
		const at = i * RECORD_SIZE;
		if (at + RECORD_SIZE > index.length) break;
		const nameBytes = index.subarray(
			at + RECORD_NAME_AT,
			at + RECORD_NAME_AT + RECORD_NAME_SIZE,
		);
		const end = nameBytes.indexOf(0);
		const name = CP932.decode(end < 0 ? nameBytes : nameBytes.subarray(0, end));
		if (name.length === 0) continue;
		const offset = base + index.readUInt32LE(at + RECORD_OFFSET_AT);
		const size = index.readUInt32LE(at + RECORD_SIZE_AT);
		if (!checkPlacement(BigInt(offset), BigInt(size), BigInt(data.length)))
			continue;
		const asb = name.toLowerCase().endsWith(".asb");
		containsScripts = containsScripts || asb;
		entries.push({ ...normalizeEntryPath(name), offset, size, asb });
	}
	if (entries.length === 0) return undefined;
	return { entries, containsScripts };
}

/**
/** `ArcOpener.OpenEntry` for an ASB script entry: only reachable when a user key is supplied, since the reference's `KnownKeys` dictionary starts empty. */
export async function unpackAzAsbEntry(
	data: Buffer,
	entry: AzArcEntry,
	asbKey: number,
): Promise<Buffer | undefined> {
	if (asbKey === 0) return undefined;
	if (entry.size < 20) return undefined;
	if (
		data
			.subarray(entry.offset, entry.offset + ASB_MARK.length)
			.toString("latin1") !== ASB_MARK
	)
		return undefined;
	const packed = data.readUInt32LE(entry.offset + ASB_KEY_AT);
	const unpacked = data.readUInt32LE(entry.offset + ASB_UNPACKED_AT);
	if (ASB_HEAD + packed !== entry.size) return undefined;
	let key = (asbKey ^ unpacked) >>> 0;
	key = (key ^ (((key << KEY_SHIFT) | key) << KEY_SECOND_SHIFT)) >>> 0;
	const first = data.readUInt16LE(entry.offset + ASB_SPOT_AT);
	if (((first - key) & 0xffff) !== ASB_SPOT) return undefined;
	const stored = Buffer.from(
		data.subarray(entry.offset + ASB_HEAD, entry.offset + ASB_HEAD + packed),
	);
	for (let at = 0; at + WORD <= (stored.length & ~(WORD - 1)); at += WORD)
		stored.writeUInt32LE((stored.readUInt32LE(at) - key) >>> 0, at);
	const checksum = stored.readUInt32LE(0);
	if (checksum !== crc32(stored.subarray(WORD))) return undefined;
	return Buffer.from(await inflateZlibBuffer(stored.subarray(WORD)));
}

export const azArcDescriptor: FormatDescriptor = {
	id: "azsys-arc-archive",
	name: "AZ system resource archive",
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
			source: "ArcFormats/AZSys/ArcAZSys.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const azArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: azArcDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(ARC_MARK, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readAzArcLayout(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readAzArcLayout(data);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		return {
			entries: layout.entries.map((entry, id) =>
				createFixedEntry({
					id,
					path: entry.path,
					offset: BigInt(entry.offset),
					size: BigInt(entry.size),
				}),
			),
			metadata: {
				containsScripts: layout.containsScripts,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readAzArcLayout(data);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		const found = layout.entries.find(
			(candidate) =>
				candidate.path === entry.path &&
				BigInt(candidate.offset) === entry.offset,
		);
		if (!found) throw invalidArchive(`Archive entry not found: ${entry.path}`);
		// The reference reads each word out of the archive stream as it goes; the port decrypts a copy in place.
		return Readable.from([
			Buffer.from(data.subarray(found.offset, found.offset + found.size)),
		]);
	},
});
