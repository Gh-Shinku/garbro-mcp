// Format reference: GARBro Legacy/BRoom/ArcCPC.cs
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CPCG", "ascii");
const COUNT_XOR = 0xff559977;
const FLAG_OFFSET = 8;
const FLAG_XOR = 0x8a;
const KEY_INDEX_OFFSET = 9;
const KEY_INDEX_XOR = 0xce;
const INDEX_OFFSET = 12;
const RECORD_SIZE = 0x38;
const NAME_SIZE = 0x30;
const SIZE_OFFSET = 4;
const NAME_OFFSET = 8;
const PLAIN_OFFSET_XOR = 0x35846;
const PLAIN_SIZE_XOR = 0x57982525;
const INDEX_KEY_MASK = 0x3f;

/** Key tables shipped with the reference implementation. */
const NAME_KEY = Buffer.from([
	0x13, 0x60, 0xfc, 0x4d, 0xde, 0xd0, 0x79, 0xb3, 0x51, 0xc5, 0xec, 0x9e, 0x06,
	0x82, 0x63, 0x73, 0x21, 0xab, 0xbf, 0x1a, 0x32, 0x9c, 0xba, 0xfa, 0x5d, 0xff,
	0x29, 0x25, 0xb8, 0x7f, 0xcf, 0xf4, 0x75, 0x93, 0x05, 0x40, 0x0c, 0xa3, 0x6a,
	0x04, 0x98, 0x67, 0x47, 0xef, 0x8b, 0xad, 0x56, 0x65,
]);
const INDEX_KEY = [
	0x27f6, 0x940b, 0x611f, 0xd845, 0xe733, 0xe871, 0x8a11, 0x360e, 0xc7aa,
	0x31bb, 0xb23a, 0xc957, 0x28d2, 0xbf73, 0x1dff, 0x29eb, 0xd3c2, 0x6cc6,
	0xdf7b, 0xa22e, 0xb82b, 0x9256, 0xceec, 0xdc08, 0xa96a, 0xe52d, 0x5f96,
	0x7959, 0x81a4, 0x990d, 0x6826, 0xaf38, 0x1b01, 0x2a19, 0x679d, 0x494e,
	0x555c, 0xe623, 0xb797, 0x6214, 0x3cad, 0xdecd, 0x775b, 0x16a7, 0x37cc,
	0xe3ae, 0xd6d5, 0x9f9b, 0x8c1e, 0xcaf3, 0x8bb1, 0x6dc5, 0x1320, 0xba1a,
	0x42bc, 0xed2f, 0xdab9, 0xa89c, 0x53f9, 0x4691, 0xf4e4, 0xfbd1, 0xe982,
	0xbeb4,
];
const OFFSET_KEY = [0x89d9a054, 0x74e297e9, 0xeeca074f, 0xf2a42ce8, 0x2d6fbe0e];
const LENGTH_KEY = [0x101c2885, 0x5f7e52f8, 0x3812a6b4, 0x99696ca1, 0x6b0ba9a7];

export const cpcDescriptor: FormatDescriptor = {
	id: "broom-cpc",
	name: "Studio B-Room resource archive",
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
			source: "Legacy/BRoom/ArcCPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `CpcOpener.TryOpen`. The record count at 4 and the encryption flag at 8 are XOR-obfuscated,
 * as is the key selector at 9. Records are 0x38 bytes with an offset, a size, and a 0x30-byte name
 * that is decrypted byte-wise until a NUL.
 *
 * Encrypted archives mix a per-record key from a 64-entry table with the offset and length tables
 * selected by the key index; unencrypted ones use fixed position-dependent keys. GARbro's bound check
 * on the key index is off by one, so the port rejects an index that is not smaller than the table.
 */
async function readCpcIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = (header.readUInt32LE(4) ^ COUNT_XOR) >>> 0;
	if (!isSaneCount(count)) return undefined;
	const encrypted = ((header[FLAG_OFFSET] ?? 0) ^ FLAG_XOR) !== 0;
	const keyIndex = (header[KEY_INDEX_OFFSET] ?? 0) ^ KEY_INDEX_XOR;
	if (encrypted && keyIndex >= OFFSET_KEY.length) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		let offset = index.readUInt32LE(record);
		let size = index.readUInt32LE(record + SIZE_OFFSET);
		if (encrypted) {
			const key = INDEX_KEY[id & INDEX_KEY_MASK] ?? 0;
			offset = (offset ^ key ^ (OFFSET_KEY[keyIndex] ?? 0)) >>> 0;
			size = (size ^ key ^ (LENGTH_KEY[keyIndex] ?? 0)) >>> 0;
		} else {
			offset = (offset ^ (id & 0xffffffff) ^ PLAIN_OFFSET_XOR) >>> 0;
			size = (size ^ (id & 0xffffffff) ^ PLAIN_SIZE_XOR) >>> 0;
		}
		const nameField = Buffer.from(
			index.subarray(record + NAME_OFFSET, record + NAME_OFFSET + NAME_SIZE),
		);
		let nameLength = 0;
		for (; nameLength < NAME_SIZE; nameLength += 1) {
			nameField[nameLength] =
				(nameField[nameLength] ?? 0) ^ (NAME_KEY[nameLength] ?? 0);
			if (nameField[nameLength] === 0) break;
		}
		const name = decodeCp932(nameField.subarray(0, nameLength));
		if (name.trim().length === 0) return undefined;
		if (!checkPlacement(BigInt(offset), BigInt(size), source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: BigInt(offset),
				size: BigInt(size),
				encrypted,
			}),
		);
	}
	return entries;
}

export const cpcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cpcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCpcIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCpcIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio B-Room CPC layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
