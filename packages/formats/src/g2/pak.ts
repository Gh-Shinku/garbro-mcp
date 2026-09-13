// Format reference: GARbro "ArcFormats/G2/ArcGCEX.cs", classes `PakOpener` and `GceReader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = "GCEX";
const INDEX_SIGNATURE = "GCE3";
const PACKED_INDEX_MARKER = 0x11;
const RECORD_SIZE = 0x20;
const PAYLOAD_START = 0x10n;
const FRAME_SIZE = 0x10000;

/** Thrown for streams the reference rejects with `InvalidFormatException` or `EndOfStreamException`. */
function invalidStream(): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", "Invalid GCE stream");
}

/** `GceReader`: an LZ77 stream driven by a separate control bit stream. */
function unpackGce(input: Buffer, unpackedSize: number): Buffer {
	const output = Buffer.alloc(unpackedSize);
	let dst = 0;
	let position = 0;
	while (position + 4 <= input.length) {
		const id = input.toString("latin1", position, position + 4);
		position += 4;
		if (position + 4 > input.length) throw invalidStream();
		const segmentLength = input.readInt32LE(position);
		position += 4;
		if (segmentLength < 0) throw invalidStream();
		if (id === "GCE1") {
			if (position + 16 > input.length) throw invalidStream();
			position += 4;
			const dataLength = input.readInt32LE(position);
			position += 4;
			position += 4;
			const cmdLength = input.readInt32LE(position);
			position += 4;
			if (dataLength < 0 || cmdLength < 0) throw invalidStream();
			const cmdPos = position + dataLength;
			if (cmdPos + cmdLength > input.length) throw invalidStream();
			const control = input.subarray(cmdPos, cmdPos + cmdLength);
			let controlPos = 0;
			let controlLeft = cmdLength;
			let bitPos = 8;
			const getBit = (): number => {
				bitPos -= 1;
				if (bitPos < 0) {
					controlPos += 1;
					bitPos = 7;
					controlLeft -= 1;
					if (controlLeft === 0) throw invalidStream();
				}
				return 1 & ((control[controlPos] ?? 0) >> bitPos);
			};
			const getLength = (): number => {
				let value = 0;
				if (getBit() === 0) {
					let digits = 0;
					while (getBit() === 0) digits += 1;
					value = 1 << digits;
					while (digits > 0) {
						digits -= 1;
						value |= getBit() << digits;
					}
				}
				return value;
			};
			// The frame records where each two byte context was last written, which is what a match
			// copies from.
			const frame = new Int32Array(FRAME_SIZE);
			let framePos = 0;
			const dstEnd = dst + segmentLength;
			while (dst < dstEnd) {
				let count = getLength();
				while (count > 0) {
					count -= 1;
					frame[framePos] = dst;
					if (position >= input.length) throw invalidStream();
					const value = input[position] ?? 0;
					position += 1;
					framePos = ((framePos << 8) | value) & 0xffff;
					if (dst >= output.length) throw invalidStream();
					output[dst] = value;
					dst += 1;
				}
				if (dst >= dstEnd) break;
				count = getLength() + 1;
				let source = frame[framePos] ?? 0;
				while (count > 0) {
					count -= 1;
					frame[framePos] = dst;
					const value = output[source] ?? 0;
					framePos = ((framePos << 8) | value) & 0xffff;
					if (dst >= output.length) throw invalidStream();
					output[dst] = value;
					dst += 1;
					source += 1;
				}
			}
			position = cmdPos + cmdLength;
		} else if (id === "GCE0") {
			if (position + segmentLength > input.length) throw invalidStream();
			if (dst + segmentLength > output.length) throw invalidStream();
			input.copy(output, dst, position, position + segmentLength);
			position += segmentLength;
			dst += segmentLength;
		} else {
			throw invalidStream();
		}
	}
	return output;
}

interface GceEntry {
	name: string;
	offset: bigint;
	size: number;
	unpackedSize: number;
}

interface GceArchive {
	entries: GceEntry[];
	indexPacked: boolean;
}

async function readGceIndex(
	source: ByteSource,
	indexOffset: bigint,
): Promise<{ index: Buffer; packed: boolean } | undefined> {
	const header = Buffer.from(await source.readAt(indexOffset + 4n, 0x20));
	const indexPacked = header.readInt32LE(0) === PACKED_INDEX_MARKER;
	let indexSize = header.readUInt32LE(4);
	if (indexPacked) {
		const unpackedSize = header.readInt32LE(0x1c);
		indexSize -= 0x28;
		if (indexSize < 0 || unpackedSize < 0) return undefined;
		const region = Buffer.from(
			await source.readAt(indexOffset + 0x28n, indexSize),
		);
		return { index: unpackGce(region, unpackedSize), packed: true };
	}
	indexSize -= 0x20;
	if (indexSize < 0) return undefined;
	return {
		index: Buffer.from(await source.readAt(indexOffset + 0x20n, indexSize)),
		packed: false,
	};
}

async function readGceArchive(
	source: ByteSource,
): Promise<GceArchive | undefined> {
	try {
		return await readGceArchiveInner(source);
	} catch {
		// The reference lets short reads and malformed index streams propagate; the port reports the
		// archive as unreadable instead.
		return undefined;
	}
}

async function readGceArchiveInner(
	source: ByteSource,
): Promise<GceArchive | undefined> {
	if (source.size < PAYLOAD_START) return undefined;
	const header = await source.readAt(0n, 16);
	if (header.toString("latin1", 0, 4) !== SIGNATURE) return undefined;
	if (header.readInt32LE(4) !== 0) return undefined;
	const indexOffset = header.readBigInt64LE(8);
	if (indexOffset < 0n || indexOffset >= source.size) return undefined;
	if (indexOffset + 4n > source.size) return undefined;
	const indexSignature = await source.readAt(indexOffset, 4);
	if (indexSignature.toString("latin1", 0, 4) !== INDEX_SIGNATURE)
		return undefined;
	if (indexOffset + 0x1cn > source.size) return undefined;
	const count = (await source.readAt(indexOffset + 0x18n, 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const packed = await readGceIndex(source, indexOffset);
	if (!packed) return undefined;
	const index = packed.index;
	const entries: GceEntry[] = [];
	let record = 0;
	let namePosition = RECORD_SIZE * count;
	let payloadOffset = PAYLOAD_START;
	for (let i = 0; i < count; i += 1) {
		if (namePosition + 2 > index.length) return undefined;
		const nameLength = index.readUInt16LE(namePosition);
		if (namePosition + 2 + nameLength > index.length) return undefined;
		if (record + RECORD_SIZE > index.length) return undefined;
		const size = index.readUInt32LE(record + 0x18);
		if (size !== 0) {
			const name = decodeCp932(
				index.subarray(namePosition + 2, namePosition + 2 + nameLength),
			);
			const unpackedSize = index.readUInt32LE(record + 0x10);
			if (!checkPlacement(payloadOffset, BigInt(size), source.size))
				return undefined;
			entries.push({
				name,
				offset: payloadOffset,
				size,
				unpackedSize,
			});
			payloadOffset += BigInt(size);
		}
		record += RECORD_SIZE;
		namePosition += 2 + nameLength;
	}
	return { entries, indexPacked: packed.packed };
}

export const g2PakDescriptor: FormatDescriptor = {
	id: "g2-pak",
	name: "G2 engine resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/G2/ArcGCEX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const g2PakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: g2PakDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(SIGNATURE, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGceArchive(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const archive = await readGceArchive(source);
		if (!archive)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GCEX index");
		const entries: FixedEntry[] = archive.entries.map((entry, id) => {
			const packed = entry.size !== entry.unpackedSize;
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.unpackedSize),
				packedSize: BigInt(entry.size),
				compressed: packed,
				metadata: { unpackedSize: entry.unpackedSize },
			});
			return packed ? { ...created, sizeKnown: false } : created;
		});
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				indexPacked: archive.indexPacked,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.packedSize === 0n) return Readable.from([]);
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (!entry.compressed) return Readable.from([stored]);
		// The reference leaves anything that is not a compressed segment as it is.
		if (stored.toString("latin1", 0, 3) !== "GCE")
			return Readable.from([stored]);
		const metadata = entry.metadata as { unpackedSize?: number } | undefined;
		return Readable.from([
			unpackGce(stored, metadata?.unpackedSize ?? stored.length),
		]);
	},
});
