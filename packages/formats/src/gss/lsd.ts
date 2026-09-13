// Format reference: GARbro "ArcFormats/Gss/ArcARC.cs", class `LsdOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ArchiveFormat,
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

const BIN_SIGNATURE = "LSDARC V.100";
const BIN_COUNT_FIELD = 0xc;
const BIN_INDEX_START = 0x10;
const INDEX_RECORD_OVERHEAD = 13;
const PAYLOAD_SIGNATURE = "LSD\u001a";
const PAYLOAD_HEADER_SIZE = 12;
const PAYLOAD_SIZE_FIELD = 6;
const PACK_METHOD_FIELD = 5;

interface LsdEntry {
	name: string;
	offset: bigint;
	size: number;
	unpackedSize: number;
	packed: boolean;
}

/** `LsdOpener.UnpackR`: a byte oriented RLE with literal, fill and skip commands. */
function unpackLsdR(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let source = 0;
	let dst = 0;
	const readByte = (): number => {
		const value = source < input.length ? (input[source] ?? 0) : 0;
		source += 1;
		return value;
	};
	const copyLiterals = (count: number): void => {
		const available = Math.min(count, input.length - source);
		const end = Math.max(0, Math.min(dst + available, output.length));
		if (end > dst) input.copy(output, dst, source, source + (end - dst));
		source += Math.max(0, available);
		dst += count;
	};
	const fillBytes = (count: number, value: number): void => {
		const end = Math.min(dst + count, output.length);
		for (let i = dst; i < end; i += 1) output[i] = value;
		dst += count;
	};
	while (dst < output.length) {
		if (source >= input.length) break;
		const raw = readByte();
		let count: number;
		let ctl: number;
		if ((raw & 0xc0) === 0xc0) {
			count = raw & 0x0f;
			ctl = raw & 0xf0;
		} else {
			count = raw & 0x3f;
			ctl = raw & 0xc0;
		}
		if (ctl === 0xf0) return output;
		switch (ctl) {
			case 0x40:
				copyLiterals(count);
				break;
			case 0xd0:
				copyLiterals((count << 8) | readByte());
				break;
			case 0x80:
				fillBytes(count, readByte());
				break;
			case 0xe0:
				fillBytes((count << 8) | readByte(), readByte());
				break;
			case 0x00:
				dst += count;
				break;
			case 0xc0:
				dst += (count << 8) | readByte();
				break;
			default:
				break;
		}
	}
	return output;
}

async function readBinIndex(
	sourcePath: string,
): Promise<{ entries: LsdEntry[]; indexSize: number } | undefined> {
	if (sourceExtension(sourcePath) !== "arc") return undefined;
	const binName = changeExtension(sourcePath.split(/[\\/]/).pop() ?? "", "BIN");
	const bin =
		(await readCompanionFile(sourcePath, binName)) ??
		(await readCompanionFile(sourcePath, changeExtension(binName, "bin")));
	if (!bin || bin.length < BIN_INDEX_START) return undefined;
	if (bin.toString("latin1", 0, BIN_SIGNATURE.length) !== BIN_SIGNATURE)
		return undefined;
	const count = bin.readInt32LE(BIN_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const entries: LsdEntry[] = [];
	let position = BIN_INDEX_START;
	for (let id = 0; id < count; id += 1) {
		if (position + INDEX_RECORD_OVERHEAD > bin.length) return undefined;
		const packed = bin.readInt32LE(position) !== 0;
		const offset = BigInt(bin.readUInt32LE(position + 4));
		const unpackedSize = bin.readUInt32LE(position + 8);
		const size = bin.readUInt32LE(position + 12);
		const { value: name, end } = readCStringFieldAt(bin, position + 16);
		if (end === undefined) return undefined;
		position = end;
		entries.push({
			name,
			offset,
			size,
			unpackedSize,
			packed,
		});
	}
	return { entries, indexSize: position };
}

/** Reads a null terminated CP932 name out of an already loaded buffer. */
function readCStringFieldAt(
	buffer: Buffer,
	offset: number,
): { value: string; end: number | undefined } {
	const terminator = buffer.indexOf(0, offset);
	if (terminator === -1) return { value: "", end: undefined };
	return {
		value: decodeCp932(buffer.subarray(offset, terminator)),
		end: terminator + 1,
	};
}

export const gssLsdDescriptor: FormatDescriptor = {
	id: "gss-lsd",
	name: "GSS engine resource archive",
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
			source: "ArcFormats/Gss/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gssLsdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gssLsdDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		const index = await readBinIndex(sourcePath);
		if (!index || index.entries.length === 0) return false;
		return index.entries.every((entry) =>
			checkPlacement(entry.offset, BigInt(entry.size), source.size),
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readBinIndex(sourcePath);
		if (!index || index.entries.length === 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LSD index");
		for (const entry of index.entries) {
			if (!checkPlacement(entry.offset, BigInt(entry.size), source.size))
				throw new GarbroError("INVALID_ARCHIVE", "Invalid LSD placement");
		}
		const entries: FixedEntry[] = index.entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.packed ? entry.unpackedSize : entry.size),
				packedSize: BigInt(entry.size),
				compressed: entry.packed,
				metadata: { indexUnpackedSize: entry.unpackedSize },
			});
			return entry.packed ? { ...created, sizeKnown: false } : created;
		});
		return {
			entries,
			metadata: { entryCount: entries.length, indexSize: index.indexSize },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (!entry.compressed) return Readable.from([stored]);
		if (stored.length < PAYLOAD_HEADER_SIZE) return Readable.from([stored]);
		if (stored.toString("latin1", 0, 4) !== PAYLOAD_SIGNATURE)
			return Readable.from([stored]);
		const unpackedSize = stored.readUInt32LE(PAYLOAD_SIZE_FIELD);
		const packMethod = String.fromCharCode(stored[PACK_METHOD_FIELD] ?? 0);
		const payload = stored.subarray(PAYLOAD_HEADER_SIZE);
		if (packMethod === "R")
			return Readable.from([unpackLsdR(payload, unpackedSize)]);
		if (packMethod === "D" || packMethod === "H" || packMethod === "W")
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`LSD pack method ${packMethod} is not implemented`,
			);
		const output = Buffer.alloc(unpackedSize);
		payload.copy(output, 0, 0, Math.min(payload.length, unpackedSize));
		return Readable.from([output]);
	},
});
