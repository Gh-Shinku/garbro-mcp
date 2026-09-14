// Format reference: GARbro "ArcFormats/FC01/ArcPAK.cs", class `PakOpener` (AGSI engine resource archive).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import {
	inflateLzssAll,
	MersenneTwister,
	MsbBitReader,
} from "@garbro-mcp/codecs";
import { createDecipheriv } from "node:crypto";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The word every one of these archives begins with, encrypted or not. */
const PACK_SIGNATURE: Buffer = Buffer.from("PACK", "ascii");
/** The word the reference also registers, the one an AGSI archive of its own starts with. */
const AGSI_SIGNATURE: Buffer = Buffer.from([0x28, 0x20, 0xa0, 0x24]);
const HEADER_SIZE = 12;
const INDEX_OFFSET = 12;
/** A record holds four words and a name, and the reference sets both of these bounds itself. */
const MIN_RECORD_SIZE = 0x10;
const MAX_RECORD_SIZE = 0x100;
const RECORD_HEADER_SIZE = 0x10;
/** The seed the reference decrypts an index with, and how it is used below. */
const INDEX_SEED = 7524;
const ROTATE_MASK = 7;
/** A method of three or more, up to five or seven, means the entry is encrypted as well as packed. */
const ENCRYPTED_METHODS = new Set([3, 4, 5, 7]);
/** How much of an encrypted entry is unwrapped with its key, and how much of a longer one. */
const ENCRYPTED_HEAD_SIZE = 1024;
const ENCRYPTED_HEAD_EXACT_SIZE = 1032;
const DES_BLOCK_SIZE = 8;
const STORED_METHODS = new Set([0, 3]);
const RLE_METHODS = new Set([1, 4]);
const BIT_STREAM_METHODS = new Set([2, 5]);
const LZSS_METHODS = new Set([6, 7]);
const SPECIAL_NAME = "copyright.dat";
const LZ_BIT_STREAM_FRAME_SIZE = 0x1000;
/** The longest a match can be, so the output can run past the size the record declares. */
const LZ_BIT_STREAM_MAX_OVERSHOOT = 16;

/** GARbro `Binary.RotByteL`: a byte turned left, its top bits coming back in at the bottom. */
function rotateByteLeft(value: number, count: number): number {
	const shift = count & ROTATE_MASK;
	return ((value << shift) | (value >>> (8 - shift))) & 0xff;
}

/** The reference's own rule: a shift of zero is a shift of one. */
function decodeShift(bits: number): number {
	const shift = bits & ROTATE_MASK;
	return shift === 0 ? 1 : shift;
}

/**
 * The header of an archive that does not begin with its own word is encrypted with two bytes taken from
 * eleven and eight bytes before the end of the file — a first key byte that walks along the header and a
 * second that gives the turn.
 */
function decryptHeader(header: Buffer, key: number, rotate: number): void {
	const shift = decodeShift(rotate);
	for (let index = 0; index < header.length; index += 1) {
		header[index] =
			(rotateByteLeft(header[index] ?? 0, shift) ^ (key + index)) & 0xff;
	}
}

/** The index of an encrypted archive is turned and mixed with the draws of a seeded twister. */
function decryptIndex(data: Buffer): void {
	const random = new MersenneTwister(INDEX_SEED);
	for (let index = 0; index < data.length; index += 1) {
		const key = random.rand() >>> 0;
		const shift = decodeShift(key);
		data[index] = (rotateByteLeft(data[index] ?? 0, shift) ^ key) & 0xff;
	}
}

interface AgsiRecord {
	unpackedSize: number;
	size: number;
	method: number;
	offset: number;
	name: string;
	encrypted: boolean;
	packed: boolean;
	special: boolean;
}

interface AgsiLayout {
	entries: FixedEntry[];
	count: number;
	indexEncrypted: boolean;
}

function parseRecord(
	record: Buffer,
	recordSize: number,
): AgsiRecord | undefined {
	const unpackedSize = record.readUInt32LE(0);
	const size = record.readUInt32LE(4);
	const method = record.readInt32LE(8);
	const offset = record.readUInt32LE(0x0c);
	const nameField = record.subarray(RECORD_HEADER_SIZE, recordSize);
	const end = nameField.indexOf(0x00);
	const name = nameField
		.subarray(0, end < 0 ? nameField.length : end)
		.toString("latin1");
	return {
		unpackedSize,
		size,
		method,
		offset,
		name,
		encrypted: ENCRYPTED_METHODS.has(method),
		packed: method !== 0 && method !== 3,
		special: name.toLowerCase() === SPECIAL_NAME,
	};
}

/**
 * GARbro `IndexReader.Create` and `ReadIndex`. The archive begins with its word, or with a header that
 * decryption turns back into one; behind either sits a table of records, encrypted in the first case and
 * plain in the second, and the data begins where that table ends.
 *
 * The reference declines the whole file when one of the records is marked as encrypted and the game it
 * belongs to has no encryption scheme known to it — the two key bytes alone cannot say what the scheme is.
 * The schemes live in a file a user supplies, so every such archive is declined here as well.
 */
async function readAgsiLayout(
	source: ByteSource,
): Promise<AgsiLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	let indexEncrypted = false;
	if (!header.subarray(0, 4).equals(PACK_SIGNATURE)) {
		// The keys sit near the end of the file, so a file that has been cut short cannot be read this way.
		if (source.size < BigInt(HEADER_SIZE)) return undefined;
		const tail = Buffer.from(await source.readAt(source.size - 9n, 9));
		if (tail.length < 9) return undefined;
		decryptHeader(header, tail[0] ?? 0, tail[3] ?? 0);
		if (!header.subarray(0, 4).equals(PACK_SIGNATURE)) return undefined;
		indexEncrypted = true;
	}
	const count = header.readInt32LE(4);
	const recordSize = header.readInt32LE(8);
	if (!isSaneCount(count)) return undefined;
	if (recordSize <= MIN_RECORD_SIZE || recordSize > MAX_RECORD_SIZE)
		return undefined;
	const dataOffset = BigInt(HEADER_SIZE + count * recordSize);
	if (dataOffset >= source.size) return undefined;
	const indexSize = count * recordSize;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), indexSize),
	);
	if (index.length !== indexSize) return undefined;
	if (indexEncrypted) decryptIndex(index);
	const entries: FixedEntry[] = [];
	for (let position = 0; position < count; position += 1) {
		const record = parseRecord(
			index.subarray(position * recordSize, (position + 1) * recordSize),
			recordSize,
		);
		if (!record || record.name.length === 0) return undefined;
		// The reference declines any archive holding an entry it would have to unwrap with a scheme it does
		// not know, so the sizes it can otherwise check are never reached for one.
		if (record.encrypted) return undefined;
		const offset = BigInt(record.offset) + dataOffset;
		if (!checkPlacement(offset, BigInt(record.size), source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id: position,
				path: record.name,
				offset,
				size: BigInt(record.size),
				compressed: record.packed,
				metadata: {
					method: record.method,
					unpackedSize: record.unpackedSize,
					// `Copyright.Dat` is the one name the reference treats specially.
					...(record.special ? { special: true } : {}),
				} as Record<string, unknown>,
			}),
		);
	}
	return { entries, count, indexEncrypted };
}

/**
 * GARbro `LzBitStream`, the method two and five decoder: a bit stream read from the most significant bit
 * down, in which a set bit is a literal byte and a clear one a match of an offset of twelve bits and a
 * length of four bits more than two, taken from a frame of `0x1000` bytes that starts at one rather than at
 * nothing. The reference stops at the size the record declares, but a match already under way is copied to
 * its end, so the output can run a few bytes past it.
 */
export function decodeLzBitStream(
	input: Uint8Array,
	outputLength: number,
): Buffer {
	const bits = new MsbBitReader(input);
	const output: Buffer = Buffer.alloc(
		outputLength + LZ_BIT_STREAM_MAX_OVERSHOOT,
		0x00,
	);
	const frame: Buffer = Buffer.alloc(LZ_BIT_STREAM_FRAME_SIZE, 0x00);
	let framePosition = 1;
	let destination = 0;
	while (destination < outputLength) {
		const flag = bits.tryReadBits(1);
		if (flag < 0) break;
		if (flag !== 0) {
			const value = bits.tryReadBits(8);
			if (value < 0) break;
			frame[framePosition++ & (LZ_BIT_STREAM_FRAME_SIZE - 1)] = value;
			output[destination] = value;
			destination += 1;
			continue;
		}
		const offset = bits.tryReadBits(12);
		if (offset < 0) break;
		const length = bits.tryReadBits(4);
		if (length < 0) break;
		let remaining = length + 2;
		let source = offset;
		destination += remaining;
		while (remaining > 0) {
			const value = frame[source++ & (LZ_BIT_STREAM_FRAME_SIZE - 1)] ?? 0;
			frame[framePosition++ & (LZ_BIT_STREAM_FRAME_SIZE - 1)] = value;
			if (destination - remaining < output.length) {
				output[destination - remaining] = value;
			}
			remaining -= 1;
		}
	}
	return Buffer.from(output.subarray(0, destination));
}

/**
 * GARbro `PakOpener.OpenEncryptedEntry`. A thousand and twenty four bytes of an entry are unwrapped with the
 * key its game's own table supplies, or a thousand and thirty two of a longer one; whatever follows the head
 * of a longer entry is left as it stands. The last four bytes of the unwrapped head say how many of its bytes
 * belong to the entry, except for the one name the reference treats specially, where that count is the entry's
 * own unpacked size.
 *
 * The unwrapped head is read with the cipher's own padding of zeroes, which carries a last part block over, so
 * a head whose length is not a whole number of blocks is completed with zeroes of its own first.
 */
function decryptEntryHead(
	body: Buffer,
	unpackedSize: number,
	special: boolean,
	key: Uint8Array,
): Buffer {
	const headSize =
		body.length > ENCRYPTED_HEAD_SIZE ? ENCRYPTED_HEAD_EXACT_SIZE : body.length;
	const padded: Buffer = Buffer.alloc(
		Math.ceil(headSize / DES_BLOCK_SIZE) * DES_BLOCK_SIZE,
		0x00,
	);
	body.copy(padded, 0, 0, Math.min(body.length, headSize, padded.length));
	// The reference asks for plain DES in electronic code book mode, which OpenSSL 3 keeps out of its default
	// provider. Running the same key through the three key slots of triple DES is the same cipher: the middle
	// step unwraps exactly what the first one wrapped.
	const cipher = createDecipheriv(
		"des-ede3",
		Buffer.concat([Buffer.from(key), Buffer.from(key), Buffer.from(key)]),
		null,
	);
	cipher.setAutoPadding(false);
	const unwrapped = Buffer.concat([cipher.update(padded), cipher.final()]);
	const head: Buffer = Buffer.alloc(headSize, 0x00);
	unwrapped.copy(head, 0, 0, Math.min(unwrapped.length, headSize));
	const headerSize = special ? unpackedSize : head.readInt32LE(headSize - 4);
	if (!special && headerSize > unpackedSize) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AGSI encryption scheme");
	}
	if (headerSize < 0 || headerSize > headSize) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AGSI entry length");
	}
	if (!special && body.length > headSize) {
		// The rest of a longer entry is carried as it stands, behind the unwrapped head.
		return Buffer.concat([
			head.subarray(0, headerSize),
			body.subarray(headSize),
		]);
	}
	return Buffer.from(head.subarray(0, headerSize));
}

/**
 * The bytes of one entry before its packing method is applied: as they stand, or unwrapped with the key the
 * caller supplies. The reference reads a non-encrypted entry plainly even when its archive has a key.
 */
export async function readAgsiEntryPayload(
	source: ByteSource,
	entry: FixedEntry,
	key?: Uint8Array,
): Promise<Buffer> {
	const body = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const method = Number(entry.metadata?.method ?? 0);
	if (key === undefined || !ENCRYPTED_METHODS.has(method)) return body;
	return decryptEntryHead(
		body,
		Number(entry.metadata?.unpackedSize ?? 0),
		entry.metadata?.special === true,
		key,
	);
}

/**
 * GARbro `PakOpener.OpenEntry`'s own switch: which of the packing methods turns an entry's bytes into what it
 * holds. The reference's run length decompressor is the one method it never implemented.
 */
export function decodeAgsiMethod(
	payload: Buffer,
	method: number,
	unpackedSize: number,
): Buffer {
	if (STORED_METHODS.has(method)) return payload;
	if (RLE_METHODS.has(method)) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"the reference does not implement the AGSI run length decoder",
		);
	}
	if (BIT_STREAM_METHODS.has(method)) {
		return decodeLzBitStream(payload, unpackedSize);
	}
	if (LZSS_METHODS.has(method)) {
		// The reference hands the whole body to its own LZSS stream and reads it to the end.
		return inflateLzssAll(payload);
	}
	throw new GarbroError(
		"INVALID_ARCHIVE",
		`Unknown AGSI packing method ${method}`,
	);
}

export const fc01PakDescriptor: FormatDescriptor = {
	id: "fc01-pak-agsi",
	name: "AGSI engine resource archive",
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
			source: "ArcFormats/FC01/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fc01PakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fc01PakDescriptor,
	detection: {
		signatures: [{ bytes: PACK_SIGNATURE }, { bytes: AGSI_SIGNATURE }],
		// The reference registers a zero word beside the two, which asks for every file to be tried.
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readAgsiLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readAgsiLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AGSI archive layout");
		void sourcePath;
		return {
			entries: layout.entries,
			metadata: {
				entryCount: layout.count,
				indexEncrypted: layout.indexEncrypted,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		// The port declines every archive whose entries would need a key, so none reaches this point.
		const payload = await readAgsiEntryPayload(source, entry);
		return Readable.from([
			decodeAgsiMethod(
				payload,
				Number(entry.metadata?.method ?? 0),
				Number(entry.metadata?.unpackedSize ?? 0),
			),
		]);
	},
});
