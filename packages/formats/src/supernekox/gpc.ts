// Format reference: GARbro "ArcFormats/SuperNekoX/ArcGPC.cs", class `GpcOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { detectFileType } from "../shared/detect-type.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = 0x37637047; // 'Gpc7'
const SIGNATURE_SIZE = 4;
const COUNT_FIELD = 4;
const OFFSET_TABLE = 8;
const ENTRY_HEADER_SIZE = 8;
const LITERAL_LIMIT = 0x1d;
const TGA_SIGNATURES = [0x020000, 0x0a0000];
/** The inner layer only applies to payloads inside this size window. */
const INNER_MIN_SIZE = 4;
const INNER_MAX_SIZE = 0x10000;

/**
 * `GpcOpener.UnpackEntry`: command bytes below 0x20 start a literal run, larger ones a match that is
 * selected by the two top bits of the command byte.
 */
function unpackGpc(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let source = 0;
	let dst = 0;
	const readByte = (): number => {
		const value = source < input.length ? (input[source] ?? 0) : 0;
		source += 1;
		return value;
	};
	const copyMatch = (offset: number, count: number): void => {
		for (let i = 0; i < count && dst < output.length; i += 1) {
			const from = dst - offset - 1;
			output[dst] = from >= 0 && from < output.length ? (output[from] ?? 0) : 0;
			dst += 1;
		}
	};
	while (dst < output.length) {
		if (source >= input.length) break;
		const ctl = readByte();
		if (ctl >= 0x20) {
			let count: number;
			let offset: number;
			if (ctl >= 0x80) {
				count = (ctl >> 5) & 3;
				offset = ((ctl & 0x1f) << 8) | readByte();
			} else if ((ctl & 0x60) === 0x20) {
				offset = (ctl >> 2) & 7;
				count = ctl & 3;
			} else if ((ctl & 0x60) === 0x40) {
				offset = ((ctl & 0x1f) << 8) | readByte();
				count = readByte() + 4;
			} else {
				offset = ((ctl & 0x1f) << 8) | readByte();
				count =
					((readByte() << 24) |
						(readByte() << 16) |
						(readByte() << 8) |
						readByte()) >>>
					0;
			}
			copyMatch(offset, Math.min(count + 3, output.length - dst));
		} else {
			let count: number;
			if (ctl < LITERAL_LIMIT) {
				count = ctl + 1;
			} else if (ctl === LITERAL_LIMIT) {
				count = readByte() + 0x1e;
			} else if (ctl === LITERAL_LIMIT + 1) {
				count = ((readByte() << 8) | readByte()) + 286;
			} else {
				count =
					((readByte() << 24) |
						(readByte() << 16) |
						(readByte() << 8) |
						readByte()) >>>
					0;
			}
			count = Math.min(count, output.length - dst);
			for (let i = 0; i < count; i += 1) {
				if (source < input.length) output[dst] = input[source] ?? 0;
				source += 1;
				dst += 1;
			}
		}
	}
	return output;
}

/** `GpcOpener.UnpackLz77`: a control byte read most significant bit first, a set bit marks a match. */
function unpackGpcInner(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let source = 0;
	let dst = 0;
	let bits = 0;
	let mask = 0;
	while (dst < output.length) {
		mask >>= 1;
		if (mask === 0) {
			if (source >= input.length) break;
			bits = input[source] ?? 0;
			source += 1;
			mask = 0x80;
		}
		if ((bits & mask) !== 0) {
			if (source + 2 > input.length) break;
			const low = input[source] ?? 0;
			const high = input[source + 1] ?? 0;
			source += 2;
			const offset = (high << 4) | (low >> 4);
			let count = Math.min((low & 0xf) + 3, output.length - dst);
			while (count > 0) {
				const from = dst - offset - 1;
				output[dst] =
					from >= 0 && from < output.length ? (output[from] ?? 0) : 0;
				dst += 1;
				count -= 1;
			}
		} else {
			if (source >= input.length) break;
			output[dst] = input[source] ?? 0;
			source += 1;
			dst += 1;
		}
	}
	return output;
}

/** `GpcOpener.OpenEntry`: the inner layer wraps the whole payload behind a four byte header. */
function unwrapInnerLayer(data: Buffer): Buffer | undefined {
	if (data.length <= INNER_MIN_SIZE || data.length >= INNER_MAX_SIZE)
		return undefined;
	const unpackedSize = data.readUInt16LE(0);
	const packedSize = data.readUInt16LE(2);
	if (packedSize !== data.length - 4) return undefined;
	return unpackGpcInner(data.subarray(4), unpackedSize);
}

function detectEntryType(payload: Buffer | undefined): string | undefined {
	if (!payload || payload.length < SIGNATURE_SIZE) return undefined;
	const signature = payload.readUInt32LE(0);
	if (TGA_SIGNATURES.includes(signature)) return "image";
	return detectFileType(signature)?.type;
}

interface GpcEntry {
	name: string;
	offset: bigint;
	stored: number;
	size: number;
	outerPacked: boolean;
	outerUnpackedSize: number;
	innerUnpackedSize?: number;
	type?: string;
}

async function readGpcEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<GpcEntry[] | undefined> {
	if (source.size < BigInt(OFFSET_TABLE)) return undefined;
	const header = await source.readAt(0n, OFFSET_TABLE);
	if (header.readUInt32LE(0) >>> 0 !== SIGNATURE) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const tableSize = count * SIGNATURE_SIZE;
	if (BigInt(OFFSET_TABLE + tableSize) > source.size) return undefined;
	const table = await source.readAt(BigInt(OFFSET_TABLE), tableSize);
	const dataOffset = BigInt(OFFSET_TABLE + tableSize);
	const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
	const dot = fileName.lastIndexOf(".");
	const baseName = (dot > 0 ? fileName.slice(0, dot) : fileName) || "entry";
	const entries: GpcEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = table.readUInt32LE(id * SIGNATURE_SIZE);
		const nextOffset =
			id + 1 < count
				? table.readUInt32LE((id + 1) * SIGNATURE_SIZE)
				: Number(source.size);
		if (BigInt(recordOffset) < dataOffset) return undefined;
		if (BigInt(nextOffset) < BigInt(recordOffset)) return undefined;
		const spanSize = nextOffset - recordOffset;
		if (!checkPlacement(BigInt(recordOffset), BigInt(spanSize), source.size))
			return undefined;
		if (BigInt(recordOffset + ENTRY_HEADER_SIZE) > source.size)
			return undefined;
		const headerBytes = await source.readAt(
			BigInt(recordOffset),
			ENTRY_HEADER_SIZE,
		);
		const packedSize = headerBytes.readUInt32LE(0);
		const unpackedSize = headerBytes.readUInt32LE(4);
		const stored = packedSize === 0 ? unpackedSize : packedSize;
		const offset = BigInt(recordOffset + ENTRY_HEADER_SIZE);
		if (!checkPlacement(offset, BigInt(stored), source.size)) return undefined;
		const outerPacked = packedSize !== 0;
		const raw = Buffer.from(await source.readAt(offset, stored));
		// The reference unpacks packed payloads before typing them and before looking for the inner layer.
		const inspected = outerPacked ? unpackGpc(raw, unpackedSize) : raw;
		const inner = unwrapInnerLayer(inspected);
		const type = detectEntryType(inspected);
		entries.push({
			name: `${baseName}#${String(id).padStart(4, "0")}`,
			offset,
			stored,
			size: inner?.length ?? (outerPacked ? unpackedSize : stored),
			outerPacked,
			outerUnpackedSize: unpackedSize,
			...(inner ? { innerUnpackedSize: inner.length } : {}),
			...(type ? { type } : {}),
		});
	}
	return entries;
}

export const supernekoxGpc7Descriptor: FormatDescriptor = {
	id: "supernekox-gpc7",
	name: "Super NekoX engine resource archive",
	extensions: ["gpc"],
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
			source: "ArcFormats/SuperNekoX/ArcGPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const supernekoxGpc7Format: ArchiveFormat = defineFixedArchive({
	descriptor: supernekoxGpc7Descriptor,
	detection: { signatures: [{ bytes: Buffer.from("Gpc7", "latin1") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGpcEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGpcEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Gpc7 index");
		const fixed: FixedEntry[] = entries.map((entry, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
				packedSize: BigInt(entry.stored),
				compressed: entry.outerPacked || entry.innerUnpackedSize !== undefined,
				metadata: {
					outerPacked: entry.outerPacked,
					unpackedSize: entry.outerUnpackedSize,
					...(entry.innerUnpackedSize !== undefined
						? { innerUnpackedSize: entry.innerUnpackedSize }
						: {}),
					...(entry.type ? { type: entry.type } : {}),
				},
			}),
		);
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { outerPacked?: boolean; unpackedSize?: number }
			| undefined;
		let data: Buffer = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (metadata?.outerPacked)
			data = unpackGpc(data, metadata.unpackedSize ?? data.length);
		const inner = unwrapInnerLayer(data);
		return Readable.from([inner ?? data]);
	},
});
