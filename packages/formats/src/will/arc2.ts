// Format reference: GARbro "ArcFormats/Will/ArcPulltop.cs", classes `Arc2Opener` and `PspFormat`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
/// Names that hold little endian UTF-16 code units.
const NAME_TERMINATOR = 2;

/** A byte rotate right inside the byte, mirroring `Binary.RotByteR (value, 2)`. */
function rotateByteRight2(value: number): number {
	return (((value >>> 2) | (value << 6)) & 0xff) >>> 0;
}

/** `Arc2Opener.IsScriptFile`. */
function isScriptFile(name: string): boolean {
	const extension = sourceExtension(name).toLowerCase();
	return extension === "ws2" || extension === "json";
}

/**
 * `Arc2Opener.OpenPsp`: a ring buffer LZSS whose matches carry an absolute frame index and always
 * copy at least two bytes. The shared `LzssStream` codec packs its offset and length the other way
 * around, so this variant stays format local.
 */
function unpackPsp(input: Buffer): Buffer {
	if (input.length < 4)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid PSP stream");
	const unpackedSize = input.readInt32LE(0);
	if (unpackedSize < 0)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid PSP stream");
	const output = Buffer.alloc(unpackedSize);
	const frame = Buffer.alloc(FRAME_SIZE);
	let position = 4;
	let dst = 0;
	let framePos = 1;
	while (dst < unpackedSize) {
		if (position >= input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PSP stream");
		const control = input[position] ?? 0;
		position += 1;
		for (let bit = 1; dst < unpackedSize && bit !== 0x100; bit <<= 1) {
			if ((control & bit) !== 0) {
				if (position >= input.length)
					throw new GarbroError("INVALID_ARCHIVE", "Invalid PSP stream");
				const value = input[position] ?? 0;
				position += 1;
				frame[framePos & FRAME_MASK] = value;
				framePos += 1;
				output[dst] = value;
				dst += 1;
			} else {
				if (position + 2 > input.length)
					throw new GarbroError("INVALID_ARCHIVE", "Invalid PSP stream");
				const high = input[position] ?? 0;
				const low = input[position + 1] ?? 0;
				position += 2;
				let source = ((high << 4) | (low >> 4)) & FRAME_MASK;
				for (let count = 2 + (low & 0x0f); count !== 0; count -= 1) {
					const value = frame[source & FRAME_MASK] ?? 0;
					source += 1;
					frame[framePos & FRAME_MASK] = value;
					framePos += 1;
					if (dst >= output.length)
						throw new GarbroError("INVALID_ARCHIVE", "Invalid PSP stream");
					output[dst] = value;
					dst += 1;
				}
			}
		}
	}
	return output;
}

interface Arc2Entry {
	name: string;
	offset: bigint;
	size: number;
}

async function readArc2Archive(
	source: ByteSource,
): Promise<Arc2Entry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = header.readUInt32LE(4);
	const baseOffset = HEADER_SIZE + indexSize;
	if (
		BigInt(indexSize) > BigInt(baseOffset) ||
		BigInt(baseOffset) >= source.size
	)
		return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: Arc2Entry[] = [];
	let position = 0;
	for (let i = 0; i < count; i += 1) {
		if (position >= index.length) return undefined;
		if (position + 8 > index.length) return undefined;
		const size = index.readUInt32LE(position);
		const offset =
			BigInt(baseOffset) + BigInt(index.readUInt32LE(position + 4));
		position += 8;
		const name: number[] = [];
		for (;;) {
			if (position >= index.length) return undefined;
			const unit = index.readUInt16LE(position);
			position += NAME_TERMINATOR;
			if (unit === 0) break;
			name.push(unit);
		}
		if (name.length === 0) return undefined;
		// Names are little endian UTF-16 code units, not CP932 bytes.
		let decoded = "";
		for (const unit of name) decoded += String.fromCharCode(unit);
		if (!checkPlacement(offset, BigInt(size), source.size)) return undefined;
		entries.push({ name: decoded, offset, size });
	}
	// The reference requires the record walk to consume the index exactly.
	if (position !== index.length) return undefined;
	return entries;
}

export const willArc2Descriptor: FormatDescriptor = {
	id: "will-arc2",
	name: "Will Co. game engine resource archive v2",
	extensions: ["arc", "ar2"],
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
			source: "ArcFormats/Will/ArcPulltop.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const willArc2Format: ArchiveFormat = defineFixedArchive({
	descriptor: willArc2Descriptor,
	// The reference declares no signature and lets detection decide.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readArc2Archive(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const archive = await readArc2Archive(source);
		if (!archive)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Will v2 index");
		const entries: FixedEntry[] = archive.map((entry, id) => {
			const extension = sourceExtension(entry.name).toLowerCase();
			const packed = extension === "psp";
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
				packedSize: BigInt(entry.size),
				compressed: packed,
			});
			return packed ? { ...created, sizeKnown: false } : created;
		});
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		if (entry.packedSize === 0n) return Readable.from([]);
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		const extension = sourceExtension(entry.path).toLowerCase();
		if (extension === "psp") return Readable.from([unpackPsp(stored)]);
		// Script files are byte rotated unless the archive itself is a model archive.
		const baseName = sourcePath.split(/[\\/]/).pop() ?? "";
		if (isScriptFile(entry.path) && !baseName.includes("Model")) {
			const rotated = Buffer.from(stored);
			for (let i = 0; i < rotated.length; i += 1)
				rotated[i] = rotateByteRight2(rotated[i] ?? 0) & 0xff;
			return Readable.from([rotated]);
		}
		return Readable.from([stored]);
	},
});
