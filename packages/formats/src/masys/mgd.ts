// Format reference: GARbro ArcFormats/Masys/ArcMGD.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE_MASK = 0x00ffffff;
const SIGNATURE = 0x0044474d;
const FLAG_OFFSET = 3;
const INDEX_OFFSET = 0x22;
const NAME_ENTRY_SIZE = 2;
const ENTRY_TAIL_SIZE = 8;
const SIZE_OFFSET = 0;
const OFFSET_OFFSET = 4;
/** Records whose flag is 100 store their names XORed with this key, repeated every 0xf bytes. */
const NAME_KEY = Buffer.from("Powerd by Masys", "ascii");
const KEY_PERIOD = 0x0f;
const ENCRYPTED_FLAG = 100;

export const mgdDescriptor: FormatDescriptor = {
	id: "masys-mgd",
	name: "Masys resource archive",
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
			source: "ArcFormats/Masys/ArcMGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function decryptName(bytes: Buffer): void {
	for (let position = 0; position < bytes.length; position += 1) {
		bytes[position] =
			(bytes[position] ?? 0) ^ (NAME_KEY[position % KEY_PERIOD] ?? 0);
	}
}

/**
 * GARbro `MgdOpener.TryOpen`. The `MGD` signature shares its word with a 16-bit flag at 3, and the
 * record count sits at 0x20. Records start at 0x22 with a length-prefixed name, followed by the
 * stored size and the data offset. A flag of 100 marks XOR-encrypted names.
 *
 * GARbro derives entry types from payload signatures; the port keeps the stored names.
 */
async function readMgdIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if ((header.readUInt32LE(0) & SIGNATURE_MASK) !== SIGNATURE) return undefined;
	const count = header.readInt16LE(0x20);
	if (count <= 0) return undefined;
	const encrypted = header.readUInt16LE(FLAG_OFFSET) === ENCRYPTED_FLAG;
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position + BigInt(NAME_ENTRY_SIZE) > source.size) return undefined;
		const nameSize = (await source.readAt(position + 1n, 1))[0] ?? 0;
		if (nameSize === 0) return undefined;
		if (position + BigInt(NAME_ENTRY_SIZE + nameSize) > source.size)
			return undefined;
		const nameBytes = Buffer.from(
			await source.readAt(position + BigInt(NAME_ENTRY_SIZE), nameSize),
		);
		if (encrypted) decryptName(nameBytes);
		position += BigInt(NAME_ENTRY_SIZE + nameSize);
		if (position + BigInt(ENTRY_TAIL_SIZE) > source.size) return undefined;
		const tail = await source.readAt(position, ENTRY_TAIL_SIZE);
		const size = BigInt(tail.readUInt32LE(SIZE_OFFSET));
		const offset = BigInt(tail.readUInt32LE(OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(decodeCp932(nameBytes)),
				offset,
				size,
				encrypted,
			}),
		);
		position += BigInt(ENTRY_TAIL_SIZE);
	}
	return entries;
}

export const mgdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mgdDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMgdIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readMgdIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Masys MGD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
