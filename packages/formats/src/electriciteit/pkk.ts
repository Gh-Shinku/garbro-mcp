// Format reference: GARBro Legacy/Electriciteit/ArcPKK.cs, class `PkkOpener`, with
// `ByteStringEncryptedStream` from ArcFormats/SimpleEncryption.cs.
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
} from "../shared/fixed-archive.js";

/** The two encrypted forms of the header's version word, which GARbro registers as signatures. */
const SIGNATURES = [
	Buffer.from([0x6f, 0xcd, 0x5e, 0x69]),
	Buffer.from([0x6e, 0xcd, 0x5e, 0x69]),
];
const EXTENSIONS = ["pkk", "skn"];
const HEADER_SIZE = 0x14;
const VERSION_OFFSET = 0;
const INDEX_OFFSET_FIELD = 0xc;
const COUNT_OFFSET = 0x10;
const RECORD_SIZE = 0x28;
const NAME_OFFSET = 8;
const NAME_SIZE = 0x20;
const SIZE_FIELD = 0;
const OFFSET_FIELD = 4;
/** The largest accepted version word; GARbro accepts zero and one. */
const MAX_VERSION = 1;

/**
 * The key GARbro decrypts headers, indexes and payloads with. Its length is a power of two and every
 * buffer restarts at its first byte, so the cipher is a plain repeating-key XOR.
 */
const KEY = Buffer.from(
	[
		"6ecd5e69c7575fb75056a850529f50529d4f519c4e4f9b4e4f9c50529c53549d",
		"5756a15e5dad666ac26e73d37277da7578dc787cdd7b7ddd7d80dd8081dc8585",
		"dc8788dc8a8adb8c8cda8d8ed98f8ed28f8bc79088ba9186b09386ae9285ad90",
		"84ac8d82a98a7fa7877aa5877aa1a08e9ec6ae9ed8bc9ed4b593c8a483c29c7a",
		"c29877c09577c09176c28d76c68b76c58673c48271c27e71c17d72bf7b71bd79",
		"70bb7870bb7770ba7571b87571b87571b77570b6736fb3716fb2706fb17070b1",
		"6f71af6e72ae6e72af6d74b06d74b06c74b06c74b16c76b26d77b56e7ab36d7a",
		"b26b79b36c7a5552955854955a55975b57975c57965f5797605998625a98635a",
		"98635a98655b97655b97665b96665a9566599467599467599467589366579164",
		"578f63568f63548e61518e5e4e8c5b4c8b5748895144874a3f83453a803d327d",
		"372d7b3128772b2375231c6f1b186a16146614136411126011116011125f1111",
		"5d0f115d11115e11115f14126014136117146217156015135e1010550f0e520f",
		"0e540f0e56110e530f0d4b10104a15135419176117145f15105c150f5b150f5b",
		"120f5b110f5c110f5c110f5b100f5c100f5d0f0f5d0f0f5d0f0f5d0f0f5d0f0f",
		"5c0f0f5b0f0f5b0f0f5a0f0f590f0f590f0f5c0f0f5c0f0f5d0f0f5d0f0f5d0f",
		"0f5f0f10600f10600f10610f10640f106611116712116813116914116a15116a",
	].join(""),
	"hex",
);
const KEY_MASK = KEY.length - 1;

export const pkkDescriptor: FormatDescriptor = {
	id: "electriciteit-pkk",
	name: "Electriciteit resource archive",
	extensions: EXTENSIONS,
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
			source: "Legacy/Electriciteit/ArcPKK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/SimpleEncryption.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function decrypt(data: Buffer): Buffer {
	for (let position = 0; position < data.length; position += 1)
		data[position] = (data[position] ?? 0) ^ (KEY[position & KEY_MASK] ?? 0);
	return data;
}

/**
 * GARBro `PkkOpener.TryOpen`. The first 0x14 bytes are a decryptable header holding a version word at
 * 0, the index offset at 0xC and the entry count at 0x10; the version must be zero or one, which is why
 * the reference registers the two encrypted forms of that word as its signatures.
 *
 * The index follows, `count` records of 0x28 bytes, and is decrypted as a unit so its key starts over.
 * A record skips its first eight bytes for the name, which is a null-terminated CP932 string of at most
 * 0x20 bytes, and holds the stored size at 0 and a data offset relative to the end of the index at 4.
 *
 * Payloads are encrypted with the same repeating-key XOR, restarted at the key's first byte because the
 * reference wraps them in `ByteStringEncryptedStream` with a base position of zero, so extraction
 * inverts the same stream the header used. The length is unchanged, hence sizes stay exact.
 */
async function readPkkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = decrypt(await source.readAt(0n, HEADER_SIZE));
	const version = header.readUInt32LE(VERSION_OFFSET);
	if (version > MAX_VERSION) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 0 || count > 0xfffff) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset < BigInt(HEADER_SIZE) || indexOffset >= source.size)
		return undefined;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = decrypt(await source.readAt(indexOffset, indexSize));
	const dataOffset = indexOffset + BigInt(indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record + NAME_OFFSET, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const offset =
			BigInt(index.readUInt32LE(record + OFFSET_FIELD)) + dataOffset;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
			}),
		);
	}
	return entries;
}

/** GARbro `PkkOpener.OpenEntry`: payloads repeat the header's key XOR from the key's first byte. */
async function openPkkEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = decrypt(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	return Readable.from([stored]);
}

export const pkkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pkkDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPkkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readPkkIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Electriciteit PKK layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openPkkEntry,
});
