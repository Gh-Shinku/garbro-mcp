// Format reference: GARBro Legacy/UMeSoft/ArcBIN.cs, class `BinOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
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
import { decodeIkeSize, unpackIke } from "./ike.js";

/** The count word packs the record count into its high half; the low half must be zero. */
const COUNT_SHIFT = 16;
const INDEX_OFFSET = 0xc;
const RECORD_SIZE = 0xc;
/** Payload offsets are stored in units of two kilobytes. */
const OFFSET_SHIFT = 11;
const NAME_WIDTH = 5;
/** Packed payloads carry an `ike` marker two bytes in and a 13-byte header. */
const IKE_MARKER_OFFSET = 2;
const IKE_HEADER_SIZE = 13;
const IKE_SIZE_OFFSET = 10;
/** The reference probes the payload signature fifteen bytes into the record. */
const SIGNATURE_OFFSET = 0xf;
const LOW_SIGNATURE_MASK = 0xffff;
const BMP_SIGNATURE = 0x4d42;
const RIFF_SIGNATURE = 0x46464952;
const OGGS_SIGNATURE = 0x5367674f;

/**
 * GARBro `AutoEntry.DetectFileType` special cases: Ogg and RIFF streams are audio and anything whose
 * low half spells `BM` is a bitmap. The reference then falls back to a registry-wide signature lookup
 * that would report ambiguous signatures as untyped, which the port leaves untyped as well.
 */
function detectSignatureType(signature: number): string | undefined {
	if (signature === OGGS_SIGNATURE || signature === RIFF_SIGNATURE)
		return "audio";
	if ((signature & LOW_SIGNATURE_MASK) === BMP_SIGNATURE) return "image";
	return undefined;
}

/**
 * GARBro `BinOpener.TryOpen`. The archive opens with a count word whose low half must be zero and
 * whose high half holds the record count plus one. Records start at 0x0C and are three words wide: an
 * identifier that becomes a zero-padded five-digit name, a payload offset in units of two kilobytes
 * and the stored size.
 *
 * After the index is read the reference probes every payload, and one that carries an `ike` marker two
 * bytes in is treated as packed: the three size bytes at +10 declare the unpacked size and the
 * thirteen-byte header is dropped from both the offset and the stored size. The payload signature is
 * then used for typing; packed records probe it two bytes into the payload, which is what the
 * reference's fixed fifteenth byte does.
 */
async function readUmeBinIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const countWord = (await source.readAt(0n, 4)).readInt32LE(0);
	if ((countWord & 0xffff) !== 0) return undefined;
	const count = (countWord >> COUNT_SHIFT) - 1;
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;

	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = String(index.readUInt32LE(record)).padStart(NAME_WIDTH, "0");
		const offset = BigInt(
			(index.readUInt32LE(record + 4) << OFFSET_SHIFT) >>> 0,
		);
		const storedSize = BigInt(index.readUInt32LE(record + 8));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		if (
			storedSize > BigInt(IKE_HEADER_SIZE) &&
			(await source.readAt(offset + BigInt(IKE_MARKER_OFFSET), 3)).toString(
				"latin1",
			) === "ike"
		) {
			const sizeBytes = await source.readAt(
				offset + BigInt(IKE_SIZE_OFFSET),
				3,
			);
			const unpackedSize = BigInt(
				decodeIkeSize(sizeBytes[0] ?? 0, sizeBytes[1] ?? 0, sizeBytes[2] ?? 0),
			);
			const signature = (
				await source.readAt(offset + BigInt(SIGNATURE_OFFSET), 4)
			).readUInt32LE(0);
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(name),
					offset: offset + BigInt(IKE_HEADER_SIZE),
					size: unpackedSize,
					packedSize: storedSize - BigInt(IKE_HEADER_SIZE),
					compressed: true,
					...signatureMetadata(signature),
				}),
			);
			continue;
		}
		const signature = (await source.readAt(offset, 4)).readUInt32LE(0);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
				packedSize: storedSize,
				...signatureMetadata(signature),
			}),
		);
	}
	return entries;
}

/** Carries the reference's signature typing into entry metadata when it applies. */
function signatureMetadata(signature: number): { metadata?: { type: string } } {
	const type = detectSignatureType(signature);
	return type === undefined ? {} : { metadata: { type } };
}

/** GARbro `BinOpener.OpenEntry`: packed payloads are decoded with the shared Ike reader. */
const binEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([unpackIke(stored, Number(entry.size))]);
};

export const umeSoftBinDescriptor: FormatDescriptor = {
	id: "umesoft-bin",
	name: "U-Me Soft resources archive",
	extensions: ["bin"],
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
			source: "Legacy/UMeSoft/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const umeSoftBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: umeSoftBinDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readUmeBinIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readUmeBinIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid U-Me Soft BIN layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: binEntryOpener,
});
