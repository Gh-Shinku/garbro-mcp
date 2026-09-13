// Format reference: GARBro ArcFormats/Cmvs/ArcCPZ1.cs (LZSS variant in ArcCPZ.cs)
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CPZ1", "ascii");
const EXTENSION = "cpz";
const INDEX_OFFSET = 0x10;
const COUNT_OFFSET = 4;
const INDEX_SIZE_OFFSET = 8;
const RECORD_SIZE_OFFSET = 0x18;
const SIZE_OFFSET = 4;
const OFFSET_OFFSET = 8;
/** 64-byte key that obfuscates both the index and every payload. */
const KEY = Buffer.from([
	0x92, 0xcd, 0x97, 0x90, 0x8c, 0xd7, 0x8c, 0xd5, 0x8b, 0x4b, 0x93, 0xfa, 0x9a,
	0xd7, 0x8c, 0xbf, 0x8c, 0xc9, 0x8c, 0xeb, 0x8d, 0x69, 0x8d, 0x8b, 0x8c, 0xd2,
	0x8c, 0xd6, 0x8b, 0x6d, 0x8c, 0xe3, 0x8c, 0xfb, 0x8c, 0xd0, 0x8c, 0xc8, 0x8c,
	0xf0, 0x8b, 0xfe, 0x8c, 0xaa, 0x8c, 0xf4, 0x8b, 0x4b, 0x9c, 0x58, 0x8c, 0xd3,
	0x96, 0xc8, 0x8c, 0xcb, 0x8c, 0xce, 0x8c, 0xf3, 0x8c, 0xd6, 0x8b, 0x52,
]);
const KEY_MASK = 0x3f;
const KEY_SUBTRACT = 0x6c;
const PSS_MARKER = Buffer.from("PSS0", "ascii");
const LZSS_HEADER_SIZE = 0x30;
const LZSS_UNPACKED_SIZE_OFFSET = 0x28;
const LZSS_FRAME_SIZE = 0x800;
const LZSS_FRAME_MASK = 0x7ff;
const LZSS_FRAME_INIT = 0x7df;
const MATCH_BASE = 2;

export const cpz1Descriptor: FormatDescriptor = {
	id: "cmvs-cpz1",
	name: "CVNS engine resource archive",
	extensions: ["cpz"],
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
			source: "ArcFormats/Cmvs/ArcCPZ1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Cmvs/ArcCPZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `DecryptData`: XOR with a repeating 64-byte key, then subtract 0x6c. */
function decryptData(data: Buffer): void {
	for (let position = 0; position < data.length; position += 1) {
		data[position] =
			(((data[position] ?? 0) ^ (KEY[position & KEY_MASK] ?? 0)) -
				KEY_SUBTRACT) &
			0xff;
	}
}

/**
 * GARbro `CpzOpener.UnpackLzss`: a 0x800-byte frame with an initial position of 0x7df, a control
 * byte holding eight flags, and a declared unpacked size behind a 0x30-byte header.
 */
function unpackLzss(data: Buffer): Buffer {
	const unpackedSize = data.readInt32LE(LZSS_UNPACKED_SIZE_OFFSET);
	const output = Buffer.alloc(LZSS_HEADER_SIZE + Math.max(0, unpackedSize));
	const headerLength = Math.min(LZSS_HEADER_SIZE, data.length);
	data.copy(output, 0, 0, headerLength);
	const frame = Buffer.alloc(LZSS_FRAME_SIZE);
	let framePosition = LZSS_FRAME_INIT;
	let source = LZSS_HEADER_SIZE;
	let destination = LZSS_HEADER_SIZE;
	let control = 1;
	while (destination < output.length && source < data.length) {
		if (control === 1) control = (data[source++] ?? 0) | 0x100;
		if ((control & 1) !== 0) {
			const value = data[source++] ?? 0;
			output[destination++] = value;
			frame[framePosition++] = value;
			framePosition &= LZSS_FRAME_MASK;
		} else {
			const low = data[source++] ?? 0;
			const high = data[source++] ?? 0;
			const offset = low | ((high & 0xe0) << 3);
			const count = (high & 0x1f) + MATCH_BASE;
			for (
				let index = 0;
				index < count && destination < output.length;
				index += 1
			) {
				const value = frame[(offset + index) & LZSS_FRAME_MASK] ?? 0;
				output[destination++] = value;
				frame[framePosition++] = value;
				framePosition &= LZSS_FRAME_MASK;
			}
		}
		control >>= 1;
	}
	return output;
}

interface CpzIndex {
	entries: FixedEntry[];
}

/**
 * GARBro `Cpz1Opener.TryOpen`. The index is encrypted with the same transform as the payloads and
 * holds variable-length records described by their own leading size: the stored size at +4, the data
 * offset at +8, and the name behind +0x18. Data offsets are relative to the end of the index.
 *
 * Payloads that start with `PSS0` after decryption are LZSS-packed and carry their unpacked size at
 * +0x28, so the port exposes the final size while listing.
 */
async function readCpz1Index(
	source: ByteSource,
	sourcePath: string,
): Promise<CpzIndex | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = header.readUInt32LE(INDEX_SIZE_OFFSET);
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	decryptData(index);
	const baseOffset = BigInt(INDEX_OFFSET + indexSize);

	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (position + 4 > index.length) return undefined;
		const recordSize = index.readInt32LE(position);
		if (recordSize <= 0 || recordSize > index.length - position)
			return undefined;
		const nameOffset = position + RECORD_SIZE_OFFSET;
		const terminator = index.indexOf(0, nameOffset);
		const nameEnd = terminator === -1 ? index.length : terminator;
		const name = decodeCp932(index.subarray(nameOffset, nameEnd));
		const size = BigInt(index.readUInt32LE(position + SIZE_OFFSET));
		const offset =
			baseOffset + BigInt(index.readUInt32LE(position + OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			path: normalizeEntryPath(name).path,
			offset,
			size,
			encrypted: true,
		});
		const stored = await source.readAt(offset, Number(size));
		decryptData(stored);
		if (
			stored.length >= LZSS_HEADER_SIZE &&
			stored.subarray(0, PSS_MARKER.length).equals(PSS_MARKER)
		) {
			const unpackedSize = stored.readInt32LE(LZSS_UNPACKED_SIZE_OFFSET);
			if (unpackedSize >= 0) {
				entry.size = BigInt(LZSS_HEADER_SIZE + unpackedSize);
				entry.compressed = true;
				entry.metadata = { lzss: true };
			}
		}
		entries.push(entry);
		position += recordSize;
	}
	return { entries };
}

/** GARbro `Cpz1Opener.OpenEntry`: decrypt every payload and unpack the LZSS variant. */
const cpz1EntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	decryptData(payload);
	if (entry.compressed === true) return Readable.from([unpackLzss(payload)]);
	return Readable.from([payload]);
};

export const cpz1Format: ArchiveFormat = defineFixedArchive({
	descriptor: cpz1Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCpz1Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readCpz1Index(source, sourcePath);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid CVNS CPZ1 layout");
		return {
			entries: index.entries,
			metadata: { entryCount: index.entries.length },
		};
	},
	openEntry: cpz1EntryOpener,
});
