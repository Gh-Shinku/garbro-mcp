// Format reference: GARBro ArcFormats/AdvScripter/ArcPAK.cs, class `PakOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("MD002", "latin1");
/** The reference also looks for this marker next to the version digit. */
const MARKER = Buffer.from("00V", "latin1");
const MARKER_FIELD = 0x21;
const VERSION_FIELD = 0x20;
const KEY_FIELD = 0x1c;
const COUNT_FIELD = 0x24;
const INDEX_START = 0x28;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;
const PACKED_FIELD = 0x20;
const OFFSET_FIELD = 0x24;
const UNPACKED_FIELD = 0x28;
const PACKED_SIZE_FIELD = 0x2c;
/** Versions that decrypt the first 28 bytes of a name field. */
const NAME_KEY_VERSIONS = new Set([4, 8, 9]);
/** Versions whose payloads are stored exclusive-ored with 0xFF before any decompression. */
const XORED_PAYLOAD_VERSIONS = new Set([5, 6, 7, 8]);
const PAYLOAD_MASK = 0xff;

function rotateRight(value: number, bits: number): number {
	return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/**
 * GARBro `PakOpener.IndexReader`. Versions 1 and 5 read the record fields verbatim; versions 2 and 6 use an
 * all-ones key; every other version takes its key from the header. Version 9 rotates the three fields right by
 * 17, 18 and 19 bits, every other remaining version shifts them right by 1, 2 and 3 bits.
 */
interface IndexScheme {
	/** Versions 1 and 5 read the three fields verbatim, without a key and without a transform. */
	plain: boolean;
	/** The key the three 32-bit fields are exclusive-ored with. */
	key: number;
	/** Version 9 rotates its fields instead of shifting them. */
	rotate: boolean;
	/** Whether the name field is exclusive-ored with the key bytes. */
	decryptName: boolean;
}

function schemeForVersion(version: number, headerKey: number): IndexScheme {
	if (version === 1 || version === 5)
		return { plain: true, key: 0, rotate: false, decryptName: false };
	const key = version === 2 || version === 6 ? 0xffffffff : headerKey;
	return {
		plain: false,
		key,
		rotate: version === 9,
		decryptName: NAME_KEY_VERSIONS.has(version),
	};
}

/**
 * Applies the version's key and bit transform to one record field. Version 9 rotates the field while every
 * other transformed version shifts it right, and the two use different amounts.
 */
function transformField(
	raw: number,
	scheme: IndexScheme,
	rotateBits: number,
	shiftBits: number,
): number {
	if (scheme.plain) return raw;
	const plain = (raw ^ scheme.key) >>> 0;
	return scheme.rotate ? rotateRight(plain, rotateBits) : plain >>> shiftBits;
}

/**
 * GARBro `PakOpener.TryOpen`. A version digit at 0x20 and a count at 0x24 open an index of 0x30-byte records
 * from 0x28. Each record holds a 0x20-byte name, a packed flag at 0x20 and the payload offset, unpacked size
 * and packed size at 0x24, 0x28 and 0x2C, all three transformed by the version's scheme.
 */
async function readAdvScripterPak(
	source: ByteSource,
): Promise<{ entries: FixedEntry[]; version: number } | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!header.subarray(MARKER_FIELD, MARKER_FIELD + MARKER.length).equals(MARKER)
	)
		return undefined;
	const digit = header[VERSION_FIELD] ?? 0;
	const version = digit - 0x30;
	if (version < 1 || version > 9) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const scheme = schemeForVersion(version, header.readUInt32LE(KEY_FIELD));
	const keyBytes = Buffer.alloc(4);
	keyBytes.writeUInt32LE(scheme.key ?? 0, 0);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const cursor = BigInt(INDEX_START + id * RECORD_SIZE);
		if (cursor + BigInt(RECORD_SIZE) > source.size) return undefined;
		const record = await source.readAt(cursor, RECORD_SIZE);
		if (scheme.decryptName) {
			// The reference decrypts the name in place, which is why the shift happens before it is read.
			for (let i = 0; i < 28; i += 1)
				record[i] = (record[i] ?? 0) ^ (keyBytes[i & 3] ?? 0);
		}
		const name = decodeCStringField(record, 0, NAME_SIZE);
		const packed = record.readInt32LE(PACKED_FIELD) !== 0;
		const rawOffset = record.readUInt32LE(OFFSET_FIELD);
		const rawUnpacked = record.readUInt32LE(UNPACKED_FIELD);
		const rawPacked = record.readUInt32LE(PACKED_SIZE_FIELD);
		const offset = BigInt(transformField(rawOffset, scheme, 17, 1));
		const unpackedSize = BigInt(transformField(rawUnpacked, scheme, 18, 2));
		const packedSize = BigInt(transformField(rawPacked, scheme, 19, 3));
		if (!checkPlacement(offset, packedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset,
				size: unpackedSize,
				packedSize,
				compressed: packed,
			}),
		);
	}
	return { entries, version };
}

class AdvScripterArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = advscripterPakDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #version: number;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: FixedEntry[],
		version: number,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.#version = version;
		this.metadata = { entryCount: entries.length, version };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const data = Buffer.from(
			await this.#source.readAt(entry.offset, Number(entry.packedSize)),
		);
		// Versions 5 to 8 mask the stored payload before the LZSS stream is decoded from it.
		if (XORED_PAYLOAD_VERSIONS.has(this.#version))
			for (let i = 0; i < data.length; i += 1)
				data[i] = (data[i] ?? 0) ^ PAYLOAD_MASK;
		if (entry.compressed) return Readable.from([inflateLzssAll(data)]);
		return Readable.from([data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const advscripterPakDescriptor: FormatDescriptor = {
	id: "advscripter-pak",
	name: "ADVScripter engine resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/AdvScripter/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const advscripterPakFormat: ArchiveFormat = {
	descriptor: advscripterPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readAdvScripterPak(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const result = await readAdvScripterPak(source);
		if (!result)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ADVScripter PAK layout",
			);
		return new AdvScripterArchiveHandle(
			source,
			sourcePath,
			result.entries,
			result.version,
		);
	},
};
