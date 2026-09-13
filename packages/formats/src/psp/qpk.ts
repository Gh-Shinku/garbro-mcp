// Format reference: GARbro ArcFormats/Psp/ArcQPK.cs, class `PakOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("QPK\0", "ascii");
const INDEX_SIGNATURE = Buffer.from("QPI\0", "ascii");
/** The reference starts reading records at 0x1C and counts `(fileSize - 0x10) / 0x20` records. */
const INDEX_HEADER_SIZE = 0x1c;
const COUNT_FIELD = 4;
const RECORD_SIZE = 8;
/** Entries flagged with the high bit, or declaring a zero size, are dropped from the listing. */
const SKIP_FLAG = 0x80000000;
const PACKED_FLAG = 0x40000000;
const UNPACKED_MASK = 0x3fffffff;
const CZL_MARKER = Buffer.from("CZL\0", "ascii");
/** `CZL\0`, the compressed size and a zlib stream. */
const CZL_HEADER_SIZE = 12;
/** The reference gives entries of a `TGA` archive an image type and a `.tga` extension. */
const TGA_BASE_NAME = "TGA";

export const pspQpkDescriptor: FormatDescriptor = {
	id: "psp-qpk",
	name: "PSP resource archive",
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
			source: "ArcFormats/Psp/ArcQPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** An index record that survived the reference's skip flags. */
interface IndexRecord {
	name: string;
	offset: bigint;
	flags: number;
	isImage: boolean;
}

/**
 * GARbro `PakOpener.TryOpen`. The archive carries the `QPK\0` signature and nothing else; records
 * live in a sibling `.QPI` index that starts with `QPI\0`, holds a count at 0x04, and is read from
 * 0x1C. Names are synthesized from the archive base name and the record position, entries of a `TGA`
 * archive are typed as images, and each record's stored size is not part of the index: the reference
 * derives it from the distance to the next entry, ending at the end of the archive.
 */
async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(SIGNATURE.length)) return undefined;
	if (!(await source.readAt(0n, SIGNATURE.length)).equals(SIGNATURE))
		return undefined;
	// The reference asks for the exact `QPI` spelling, which relies on a case-insensitive filesystem.
	const indexName = basename(changeExtension(sourcePath, "QPI"));
	const index = await readCompanionFile(sourcePath, indexName);
	if (!index || index.length < INDEX_HEADER_SIZE) return undefined;
	if (!index.subarray(0, INDEX_SIGNATURE.length).equals(INDEX_SIGNATURE))
		return undefined;
	const count = index.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	// The reference reads records through a bounds-checked view, so a short index is a hard failure.
	if (index.length < INDEX_HEADER_SIZE + count * RECORD_SIZE) return undefined;

	const baseName = basename(changeExtension(sourcePath, ""));
	const isTga = baseName === TGA_BASE_NAME;
	const records: IndexRecord[] = [];
	for (let position = 0; position < count; position += 1) {
		const recordOffset = INDEX_HEADER_SIZE + position * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const flags = index.readUInt32LE(recordOffset + 4);
		if (offset > source.size) return undefined;
		if ((flags & SKIP_FLAG) !== 0 || flags === 0) continue;
		records.push({
			name: `${baseName}#${String(position).padStart(5, "0")}${isTga ? ".tga" : ""}`,
			offset,
			flags,
			isImage: isTga,
		});
	}

	// Back-fill the stored sizes: the last entry runs to the end of the archive, every other entry
	// runs to the next offset. The reference clamps the resulting stream to the available bytes.
	const declaredSizes: bigint[] = [];
	let lastOffset = source.size;
	for (let position = records.length - 1; position >= 0; position -= 1) {
		const record = records[position];
		if (!record) continue;
		declaredSizes[position] = lastOffset - record.offset;
		lastOffset = record.offset;
	}

	const entries: FixedEntry[] = [];
	for (const [position, record] of records.entries()) {
		const declaredStored = declaredSizes[position] ?? 0n;
		const available = source.size - record.offset;
		const fits = declaredStored >= 0n && declaredStored <= available;
		const storedSize = fits ? declaredStored : available;
		let offset = record.offset;
		let size = storedSize;
		let packedSize = storedSize;
		let compressed = false;
		let clamped = !fits;
		let metadata: Record<string, unknown> | undefined;
		if (record.isImage) metadata = { type: "image" };
		if ((record.flags & PACKED_FLAG) !== 0) {
			const probeLength = Number(
				source.size - record.offset < BigInt(CZL_HEADER_SIZE)
					? source.size - record.offset
					: BigInt(CZL_HEADER_SIZE),
			);
			const probe =
				probeLength > 0
					? await source.readAt(record.offset, probeLength)
					: Buffer.alloc(0);
			if (
				probe.length >= CZL_HEADER_SIZE &&
				probe.subarray(0, CZL_MARKER.length).equals(CZL_MARKER)
			) {
				compressed = true;
				size = BigInt(record.flags & UNPACKED_MASK);
				const payloadOffset = record.offset + BigInt(CZL_HEADER_SIZE);
				const declaredCompressed = BigInt(
					probe.readUInt32LE(CZL_MARKER.length),
				);
				const payloadAvailable = source.size - payloadOffset;
				packedSize =
					declaredCompressed < payloadAvailable
						? declaredCompressed
						: payloadAvailable;
				clamped = packedSize !== declaredCompressed;
				offset = payloadOffset;
			}
		}
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(record.name),
			offset,
			size,
			packedSize,
			compressed,
			...(metadata === undefined ? {} : { metadata }),
		});
		if (clamped) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/**
 * GARbro `PakOpener.OpenEntry`. Entries flagged as packed are decoded when their stored data starts
 * with `CZL\0`, which is followed by the compressed size and a zlib stream. Everything else,
 * including flagged entries without the marker, is emitted verbatim.
 */
export const pspQpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pspQpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PSP QPK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source, entry) {
		if (!entry.compressed)
			return source.createReadStream(entry.offset, entry.packedSize);
		return createZlibInflateStream(
			source.createReadStream(entry.offset, entry.packedSize),
		);
	},
});
