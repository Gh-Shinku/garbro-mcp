// Format reference: GARbro ArcFormats/Entis/ArcPAC.cs, class `PacOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	encodeCp932,
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
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** The format only opens files named `.pac`. */
const EXTENSION = "pac";
/** Names occupy 0x18 bytes and the two size words follow them. */
const NAME_SIZE = 0x18;
/** A name padded with spaces to the field end rejects the archive instead of ending the loop. */
const NAME_TERMINATOR = 0x20;
/** Payload offsets are relative to this base. */
const DATA_BASE = 0x40000;
/** The entry list is bounded and both an empty and a full list reject the archive. */
const MAX_ENTRIES = 0x2000;
/** GARbro `PacOpener.DefaultPassword`; cp932-encoded at load time. */
const PASSWORD =
	"パブロ・ディエゴ・ホセ・フランチスコ・ド・ポール・ジャン・ネボムチェーノ・クリスバン・ クリスピアノ・ド・ラ・ンチシュ・トリニダット・ルイス・イ・ピカソのシプリアーノ･サンティシマ･トリニダードは三位一体の事だったりする";
const PASSWORD_BYTES = encodeCp932(PASSWORD);

export const entisPacDescriptor: FormatDescriptor = {
	id: "entis-pac",
	name: "Terios resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Entis/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PacOpener.TryOpen`. The index is a flat run of 0x18-byte name fields followed by a 32-bit
 * offset and size; a name field whose first byte is a space ends the list. Every name byte must be at
 * least 0x20 and the field must contain a space terminator, so a name that fills all 0x18 bytes
 * rejects the archive. Payload offsets are relative to 0x40000, and the list must be non-empty and
 * shorter than 0x2000 entries.
 */
async function readEntisIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = 0n;
	while (indexOffset < source.size && entries.length < MAX_ENTRIES) {
		if (indexOffset + BigInt(NAME_SIZE) > source.size) return undefined;
		const nameField = await source.readAt(indexOffset, NAME_SIZE);
		if (nameField[0] === NAME_TERMINATOR) break;
		let nameLength = 0;
		for (; nameLength < NAME_SIZE; nameLength += 1) {
			const value = nameField[nameLength] ?? 0;
			if (value < NAME_TERMINATOR) return undefined;
			if (value === NAME_TERMINATOR) break;
		}
		if (nameLength === NAME_SIZE) return undefined;
		if (indexOffset + BigInt(NAME_SIZE + 8) > source.size) return undefined;
		const fields = await source.readAt(indexOffset + BigInt(NAME_SIZE), 8);
		const name = decodeCStringField(nameField, 0, nameLength);
		const offset = BigInt(DATA_BASE) + BigInt(fields.readUInt32LE(0));
		const storedSize = BigInt(fields.readUInt32LE(4));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		// GARbro decrypts payloads whose first byte is zero and emits everything else verbatim.
		const encrypted =
			storedSize > 0n && (await source.readAt(offset, 1))[0] === 0;
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size: encrypted ? storedSize - 1n : storedSize,
			packedSize: storedSize,
			encrypted,
		});
		entries.push(entry);
		indexOffset += BigInt(NAME_SIZE + 8);
	}
	if (entries.length === 0 || entries.length === MAX_ENTRIES) return undefined;
	return entries;
}

/**
 * GARbro `PacOpener.OpenEntry`. A payload that starts with a zero byte loses that byte and every
 * remaining byte is exclusive-ored with the bitwise complement of the next password byte, cycling
 * through the 217-byte cp932 password. Other payloads are emitted verbatim.
 */
const entisEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.encrypted)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset + 1n,
		bigintToBufferLength(entry.packedSize - 1n, "Terios entry"),
	);
	const output = Buffer.alloc(stored.length);
	for (let index = 0; index < stored.length; index += 1) {
		const key = ~(PASSWORD_BYTES[index % PASSWORD_BYTES.length] ?? 0) & 0xff;
		output[index] = (stored[index] ?? 0) ^ key;
	}
	return Readable.from([output]);
};

export const entisPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: entisPacDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEntisIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readEntisIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Terios PAC layout");
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				encryption: "password-xor",
			},
		};
	},
	openEntry: entisEntryOpener,
});
