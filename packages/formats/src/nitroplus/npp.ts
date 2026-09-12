// Format reference: GARbro ArcFormats/NitroPlus/ArcNPP.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("nitP", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x90;
const OFFSET_OFFSET = 0x00;
const SIZE_OFFSET = 0x04;
const UNPACKED_SIZE_OFFSET = 0x08;
const PACKED_OFFSET = 0x0c;
const SUBDIR_OFFSET = 0x10;
const NAME_OFFSET = 0x50;
const FIELD_SIZE = 0x40;

export const nppDescriptor: FormatDescriptor = {
	id: "nitroplus-npp",
	name: "Nitro+ resource archive",
	extensions: [],
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
			source: "ArcFormats/NitroPlus/ArcNPP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isPacked(entry: FixedEntry): boolean {
	return entry.metadata?.packed === true;
}

function unpackedSizeOf(entry: FixedEntry): number {
	const value = entry.metadata?.unpackedSize;
	const size = typeof value === "string" ? Number(value) : Number(entry.size);
	if (!Number.isSafeInteger(size) || size < 0 || size > 0x7fffffff) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Nitro+ NPP entry declares an invalid unpacked size",
		);
	}
	return size;
}

const nppEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!isPacked(entry))
		return source.createReadStream(entry.offset, entry.size);
	const expectedLength = unpackedSizeOf(entry);
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	const output = inflateLzss(compressed, { outputLength: expectedLength });
	if (output.length !== expectedLength) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Nitro+ NPP LZSS stream ended before the declared size",
		);
	}
	return Readable.from([output]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readNpp(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Nitro+ NPP header");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const subdir = decodeCStringField(
			index,
			recordOffset + SUBDIR_OFFSET,
			FIELD_SIZE,
		);
		const name = decodeCStringField(
			index,
			recordOffset + NAME_OFFSET,
			FIELD_SIZE,
		);
		const path = subdir ? `${subdir}\\${name}` : name;
		if (path.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Nitro+ NPP entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const unpackedSize = BigInt(
			index.readUInt32LE(recordOffset + UNPACKED_SIZE_OFFSET),
		);
		const packed = index.readInt16LE(recordOffset + PACKED_OFFSET) !== 0;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Nitro+ NPP entry points outside the archive: ${path}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(path),
				offset,
				size,
				compressed: packed,
				metadata: {
					packed,
					unpackedSize: unpackedSize.toString(),
				},
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const nppFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nppDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readNpp,
	openEntry: nppEntryOpener,
});
