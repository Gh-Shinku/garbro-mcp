// Format reference: GARbro "ArcFormats/AliceSoft/ArcAFA.cs", class `AfaOpener` (the version one and two
// index; the version three `AfaIndexReader` is not ported yet).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("AFAH", "ascii");
const MAGIC = Buffer.from("AlicArch", "ascii");
const INFO = Buffer.from("INFO", "ascii");
const VERSION_OFFSET = 0x10;
const BASE_OFFSET_OFFSET = 0x18;
const INFO_OFFSET = 0x1c;
const PACKED_SIZE_OFFSET = 0x20;
const UNPACKED_SIZE_OFFSET = 0x24;
const COUNT_OFFSET = 0x28;
/** The compressed index follows the fixed header. */
const INDEX_OFFSET = 0x2c;
const HEADER_SIZE = INDEX_OFFSET;
/** Versions below two carry one extra skipped word per record. */
const OLD_VERSION = 2;
/** An `AFF\0` payload holds a keyed prefix in front of the plain body. */
const AFF_HEADER_SIZE = 0x10;
const AFF_MARKER = Buffer.from("AFF\0", "ascii");
const AFF_PREFIX_SIZE = 0x40;
/** `AfaOpener.AffKey`: the key that masks the first bytes of an `AFF` payload. */
const AFF_KEY = Buffer.from([
	0xc8, 0xbb, 0x8f, 0xb7, 0xed, 0x43, 0x99, 0x4a, 0xa2, 0x7e, 0x5b, 0xb0, 0x68,
	0x18, 0xf8, 0x88,
]);

interface AfaEntry {
	path: string;
	rawPath?: string;
	offset: bigint;
	size: bigint;
	affPrefix: number;
}

/** GARbro `AfaOpener.TryOpen`: a zlib compressed index of length prefixed names. */
async function readAfaIndex(
	source: ByteSource,
): Promise<AfaEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (!head.subarray(8, 16).equals(MAGIC)) return undefined;
	if (!head.subarray(INFO_OFFSET, INFO_OFFSET + 4).equals(INFO))
		return undefined;
	const version = head.readInt32LE(VERSION_OFFSET);
	const baseOffset = BigInt(head.readUInt32LE(BASE_OFFSET_OFFSET));
	const packedSize = head.readUInt32LE(PACKED_SIZE_OFFSET);
	const unpackedSize = head.readInt32LE(UNPACKED_SIZE_OFFSET);
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (
		BigInt(INDEX_OFFSET) + BigInt(packedSize) > source.size ||
		packedSize === 0
	)
		return undefined;
	const packed = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), packedSize),
	);
	let index: Buffer;
	try {
		index = await inflateZlibBuffer(packed);
	} catch {
		return undefined;
	}
	try {
		const entries: AfaEntry[] = [];
		let position = 0;
		for (let i = 0; i < count; i += 1) {
			if (position + 8 > index.length) return undefined;
			const nameLength = index.readInt32LE(position);
			const indexStep = index.readInt32LE(position + 4);
			position += 8;
			if (nameLength <= 0 || nameLength > indexStep) return undefined;
			if (indexStep > unpackedSize) return undefined;
			if (position + indexStep + 8 > index.length) return undefined;
			const name = decodeCp932(index.subarray(position, position + nameLength));
			position += indexStep;
			// Two words are always skipped, and older versions skip a third one.
			position += 8;
			if (version < OLD_VERSION) position += 4;
			if (position + 8 > index.length) return undefined;
			const offset = BigInt(index.readUInt32LE(position)) + baseOffset;
			const size = BigInt(index.readUInt32LE(position + 4));
			position += 8;
			if (!checkPlacement(offset, size, source.size)) return undefined;
			const entry: AfaEntry = {
				...normalizeEntryPath(name),
				offset,
				size,
				affPrefix: 0,
			};
			if (size > BigInt(AFF_HEADER_SIZE)) {
				const marker = Buffer.from(
					await source.readAt(offset, AFF_MARKER.length),
				);
				if (marker.equals(AFF_MARKER)) {
					const dataSize = Number(size) - AFF_HEADER_SIZE;
					entry.affPrefix = Math.min(AFF_PREFIX_SIZE, dataSize);
				}
			}
			entries.push(entry);
		}
		return entries;
	} catch {
		return undefined;
	}
}

/** `AfaOpener.OpenEntry`: the `AFF` prefix is unmasked with the repeating key, the rest is plain. */
function decodeAffPrefix(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1)
		output[index] =
			(output[index] ?? 0) ^ (AFF_KEY[index % AFF_KEY.length] ?? 0);
	return output;
}

export const alicesoftAfaDescriptor: FormatDescriptor = {
	id: "alicesoft-afa",
	name: "AliceSoft System 4 resource archive",
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
			source: "ArcFormats/AliceSoft/ArcAFA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const alicesoftAfaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: alicesoftAfaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAfaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readAfaIndex(source);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AliceSoft AFA layout");
		const entries: FixedEntry[] = parsed.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: entry.offset,
				size: entry.size,
				encrypted: entry.affPrefix > 0,
				...(entry.affPrefix > 0
					? {
							metadata: { affPrefix: entry.affPrefix } as Record<
								string,
								unknown
							>,
						}
					: {}),
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const prefixSize =
			(entry.metadata as { affPrefix?: number } | undefined)?.affPrefix ?? 0;
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (prefixSize <= 0) return Readable.from([data]);
		// The keyed prefix sits behind a sixteen byte header and is shorter than the payload.
		const start = AFF_HEADER_SIZE;
		const end = start + prefixSize;
		const prefix = decodeAffPrefix(data.subarray(start, end));
		return Readable.from([
			Buffer.concat([data.subarray(0, start), prefix, data.subarray(end)]),
		]);
	},
});
