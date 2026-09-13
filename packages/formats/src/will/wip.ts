// Format reference: GARbro ArcFormats/Will/ArcWIP.cs, class `WipOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("WIPF", "ascii");
const HEADER_SIZE = 0x20;
const COUNT_FIELD = 4;
const BPP_FIELD = 6;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x18;
/** The per-frame size sits in the last word of each index record. */
const FRAME_SIZE_FIELD = 0x14;
/** Extracted frames are the archive header with the frame count forced to one. */
const FRAME_COUNT = 1;
/** The reference adds a palette block to 8-bit frames. */
const PALETTE_SIZE = 0x400;
const EIGHT_BPP = 8;

interface WipMetadata extends Record<string, unknown> {
	type: "image";
	bpp: number;
	/** Position of the frame inside the index, so extraction can rebuild its header. */
	indexOffset: number;
}

function wipMetadata(entry: FixedEntry): WipMetadata {
	const metadata = entry.metadata ?? {};
	return {
		type: "image",
		bpp: Number(metadata.bpp ?? 0),
		indexOffset: Number(metadata.indexOffset ?? 0),
	};
}

/**
 * GARbro `WipOpener.TryOpen`. The file starts with a 0x20-byte `WIPF` header whose frame count and
 * bit depth are read from 0x04 and 0x06. A 0x18-byte record per frame follows at 0x08; the last word
 * of each record is the stored frame size, and frames are laid out back to back after the records.
 * The reference validates each frame before adding a 0x400-byte palette block for 8-bit images, so
 * the offsets accumulate the padded size while the placement check uses the raw size. Every frame is
 * reported as an image whose extracted form is the archive header with the frame count patched to one
 * and the frame's own record copied into it, followed by the stored bytes.
 */
async function readWipIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt16LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const bpp = header.readInt16LE(BPP_FIELD);
	const indexEnd = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (indexEnd > source.size) return undefined;

	const baseName = basename(changeExtension(sourcePath, ""));
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	let offset = indexEnd;
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const storedSize = BigInt(index.readUInt32LE(record + FRAME_SIZE_FIELD));
		if (offset + storedSize > source.size) return undefined;
		const frameSize =
			bpp === EIGHT_BPP ? storedSize + BigInt(PALETTE_SIZE) : storedSize;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}.wip`),
				offset,
				size: BigInt(HEADER_SIZE) + frameSize,
				packedSize: frameSize,
				compressed: true,
				metadata: {
					type: "image",
					bpp,
					indexOffset: id,
				} satisfies WipMetadata,
			}),
		);
		offset += frameSize;
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARbro `WipOpener.OpenEntry`. The reference wraps the stored frame in a `PrefixStream` with the
 * 0x20-byte archive header, whose frame count is forced to one and whose last 0x18 bytes are the
 * frame's own index record, so the output is that synthesized header followed by the stored bytes.
 */
const wipEntryOpener: FixedEntryOpener = async (source, entry) => {
	const { indexOffset } = wipMetadata(entry);
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	header.writeInt16LE(FRAME_COUNT, COUNT_FIELD);
	const record = await source.readAt(
		BigInt(INDEX_OFFSET + indexOffset * RECORD_SIZE),
		RECORD_SIZE,
	);
	record.copy(header, INDEX_OFFSET);
	const stored = source.createReadStream(entry.offset, entry.packedSize);
	return Readable.from(
		(async function* () {
			yield header;
			for await (const chunk of stored) yield chunk;
		})(),
	);
};

export const willWipDescriptor: FormatDescriptor = {
	id: "will-wip",
	name: "Will Co. multi-frame image",
	extensions: ["wip"],
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
			source: "ArcFormats/Will/ArcWIP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const willWipFormat: ArchiveFormat = defineFixedArchive({
	descriptor: willWipDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readWipIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readWipIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Will WIP layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: wipEntryOpener,
});
