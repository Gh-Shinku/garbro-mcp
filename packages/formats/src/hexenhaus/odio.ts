// Format reference: GARbro ArcFormats/Hexenhaus/ArcODIO.cs (with Ror4EncryptedStream from ArcWAG.cs)
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
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ODIO", "ascii");
const VERSION_OFFSET = 4;
const MARKER_OFFSET = 0x0a;
const MARKER = 0xccae01ff;
const FIRST_OFFSET_OFFSET = 0x12;
const RECORD_SIZE = 6;
/** Header length of the "ONCE" audio container that wraps obfuscated payloads. */
const ONCE_HEADER_SIZE = 0x2c;
const ONCE_MARKER = Buffer.from("ONCE", "ascii");

export const odioDescriptor: FormatDescriptor = {
	id: "hexenhaus-odio",
	name: "Hexenhaus audio archive",
	extensions: ["bin"],
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
			source: "ArcFormats/Hexenhaus/ArcODIO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Hexenhaus/ArcWAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `BinOpener.TryOpen`. The header ends with the first data offset, which also sizes the
 * 6-byte record table; every entry runs up to the next recorded offset and the last one to the end
 * of the file.
 */
async function readOdioIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, FIRST_OFFSET_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (header.readUInt32LE(VERSION_OFFSET) !== 0) return undefined;
	if (header.readUInt32LE(MARKER_OFFSET) !== MARKER) return undefined;
	const firstOffset = header.readUInt32LE(FIRST_OFFSET_OFFSET);
	if (BigInt(firstOffset) > source.size) return undefined;
	if (firstOffset < FIRST_OFFSET_OFFSET) return undefined;
	const count = Math.floor((firstOffset - FIRST_OFFSET_OFFSET) / RECORD_SIZE);
	if (!isSaneCount(count)) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let offset = BigInt(firstOffset);
	let position = FIRST_OFFSET_OFFSET;
	for (let id = 0; id < count; id += 1) {
		position += RECORD_SIZE;
		const next =
			id + 1 === count
				? source.size
				: BigInt((await source.readAt(BigInt(position), 4)).readUInt32LE(0));
		const stored = next - offset;
		if (stored < 0n || !checkPlacement(offset, stored, source.size))
			return undefined;
		// GARbro unwraps "ONCE" containers while opening an entry. The range is inspected here so
		// that extraction can verify the declared unpacked size.
		const wrapped =
			stored >= BigInt(ONCE_HEADER_SIZE) &&
			(await source.readAt(offset, ONCE_MARKER.length)).equals(ONCE_MARKER);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}.ogg`),
				offset,
				size: wrapped ? stored - BigInt(ONCE_HEADER_SIZE) : stored,
				packedSize: stored,
				compressed: wrapped,
			}),
		);
		offset = next;
	}
	return entries;
}

/** GARbro `BinOpener.OpenEntry`: "ONCE" containers drop a 0x2c-byte header and rotate each byte. */
const odioEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(
		entry.offset + BigInt(ONCE_HEADER_SIZE),
		Number(entry.packedSize - BigInt(ONCE_HEADER_SIZE)),
	);
	for (let position = 0; position < payload.length; position += 1) {
		const value = payload[position] ?? 0;
		payload[position] = ((value >> 4) | (value << 4)) & 0xff;
	}
	return Readable.from([payload]);
};

export const odioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: odioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readOdioIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readOdioIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Hexenhaus ODIO archive",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: odioEntryOpener,
});
