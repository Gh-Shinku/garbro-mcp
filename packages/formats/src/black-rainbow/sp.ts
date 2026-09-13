// Format reference: GARBro ArcFormats/BlackRainbow/ArcSPPAK.cs, classes `SpPakOpener` and `SpArchive`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Each known signature selects the byte its payloads are keyed with. */
const SCHEMES = new Map<number, number>([
	[0x69695669, 0x07],
	[0x8492e36f, 0x9c],
]);
const SIGNATURES = [...SCHEMES.keys()].map((value) => {
	const bytes = Buffer.alloc(4);
	bytes.writeUInt32LE(value, 0);
	return bytes;
});
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const POINTER_SIZE = 4;
/** The payloads begin behind the offset table, which the header sits in front of. */
const DATA_OFFSET = INDEX_OFFSET;
const NAME_DIGITS = 4;
const ROTATION = 2;

export const spPakDescriptor: FormatDescriptor = {
	id: "black-rainbow-sp",
	name: "BlackRainbow script archive",
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
			source: "ArcFormats/BlackRainbow/ArcSPPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Rotates a byte right, the direction the reference's helper uses. */
function rotateByteRight(value: number, count: number): number {
	const shift = count & 7;
	return (((value >>> shift) | (value << (8 - shift))) & 0xff) >>> 0;
}

/** The inverse rotation, used by fixtures to reproduce a stored payload. */
export function rotateByteLeft(value: number, count: number): number {
	const shift = count & 7;
	return (((value << shift) | (value >>> (8 - shift))) & 0xff) >>> 0;
}

/**
 * GARBro `SpPakOpener.TryOpen`. Only two signatures are known, and each names the byte that every payload is
 * keyed with, so the port refuses any other value rather than guessing. The entry count sits at 4 and the offset
 * table begins at 8, with the payloads directly behind it.
 *
 * Records hold an offset relative to that data start, and only the offsets are stored: sizes are the gaps between
 * consecutive ones and the last entry runs to the end of the file. Entries carry generated names of the archive's
 * own name and a four-digit index, since the format stores none. The reference performs no placement check on
 * those derived spans, while the port validates them.
 *
 * Extraction applies the signature's key byte and then rotates each result right by two bits.
 */
async function readSpIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; key: number } | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const key = SCHEMES.get(header.readUInt32LE(0));
	if (key === undefined) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const tableSize = count * POINTER_SIZE;
	if (BigInt(INDEX_OFFSET + tableSize) > source.size) return undefined;
	const table = await source.readAt(BigInt(INDEX_OFFSET), tableSize);
	const dataOffset = BigInt(DATA_OFFSET + tableSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");

	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = dataOffset + BigInt(table.readUInt32LE(id * POINTER_SIZE));
		if (offset > source.size) return undefined;
		offsets.push(offset);
	}

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = offsets[id] ?? 0n;
		const next = offsets[id + 1] ?? source.size;
		if (next < offset) return undefined;
		const size = next - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(NAME_DIGITS, "0")}`,
			),
			offset,
			size,
			encrypted: true,
		});
		entry.metadata = { key };
		entries.push(entry);
	}
	return { entries, key };
}

/** GARBro `SpPakOpener.OpenEntry`: the key byte, then a two-bit rotation to the right. */
async function openSpEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const key = typeof entry.metadata?.key === "number" ? entry.metadata.key : 0;
	const data = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < data.length; position += 1) {
		data[position] = rotateByteRight((data[position] ?? 0) ^ key, ROTATION);
	}
	return Readable.from([data]);
}

export const spPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: spPakDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSpIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const parsed = await readSpIndex(source, sourcePath);
		if (!parsed)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid BlackRainbow SP layout",
			);
		return {
			entries: parsed.entries,
			metadata: { entryCount: parsed.entries.length, key: parsed.key },
		};
	},
	openEntry: openSpEntry,
});
