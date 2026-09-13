// Format reference: GARBro ArcFormats/Pajamas/ArcGameDat.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("GAMEDAT PAC", "ascii");
const VERSION_OFFSET = 0x0b;
const COUNT_OFFSET = 0x0c;
const NAME_OFFSET = 0x10;
const INDEX_RECORD_SIZE = 8;
const MAX_COUNT = 0xfffff;
/** Version markers and the name field width each one selects. */
const VERSIONS = new Map([
	[0x4b, 16],
	[0x32, 32],
]);
const ENCRYPTED_NAME = "textdata.bin";
/** Marker of the obfuscated script payloads. */
const ENCRYPTED_MARKER = Buffer.from([0x95, 0x6b, 0x3c, 0x9d, 0x63]);
const KEY_START = 0xc5;
const KEY_STEP = 0x5c;

export const gameDatDescriptor: FormatDescriptor = {
	id: "pajamas-gamedat",
	name: "Pajamas Adventure System resource archive",
	extensions: ["dat", "pak"],
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
			source: "ArcFormats/Pajamas/ArcGameDat.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `DatOpener.TryOpen`. The header carries the `GAMEDAT PAC` signature and a version marker
 * that selects a 16- or 32-byte name field. Names come first and the index behind them holds a
 * 32-bit offset relative to the data base plus the stored size.
 *
 * `textdata.bin` payloads are obfuscated with a rolling XOR that starts at 0xc5 and adds 0x5c per
 * byte; GARbro only applies it when the payload starts with the expected marker.
 */
async function readGameDatIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(NAME_OFFSET)) return undefined;
	const header = await source.readAt(0n, NAME_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const nameLength = VERSIONS.get(header[VERSION_OFFSET] ?? 0);
	if (nameLength === undefined) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 0 || count > MAX_COUNT) return undefined;
	const namesSize = nameLength * count;
	const baseOffset = NAME_OFFSET + namesSize + INDEX_RECORD_SIZE * count;
	if (BigInt(baseOffset) > source.size) return undefined;
	const block = await source.readAt(
		BigInt(NAME_OFFSET),
		namesSize + INDEX_RECORD_SIZE * count,
	);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const name = decodeCStringField(block, id * nameLength, nameLength);
		const index = namesSize + id * INDEX_RECORD_SIZE;
		const offset = BigInt(baseOffset) + BigInt(block.readUInt32LE(index));
		const size = BigInt(block.readUInt32LE(index + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries;
}

const gameDatEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (
		!entry.path.toLowerCase().endsWith(ENCRYPTED_NAME) ||
		entry.size < BigInt(ENCRYPTED_MARKER.length)
	)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.size));
	if (!payload.subarray(0, ENCRYPTED_MARKER.length).equals(ENCRYPTED_MARKER))
		return Readable.from([payload]);
	let key = KEY_START;
	for (let position = 0; position < payload.length; position += 1) {
		payload[position] = (payload[position] ?? 0) ^ key;
		key = (key + KEY_STEP) & 0xff;
	}
	return Readable.from([payload]);
};

export const gameDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGameDatIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readGameDatIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Pajamas GAMEDAT layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: gameDatEntryOpener,
});
