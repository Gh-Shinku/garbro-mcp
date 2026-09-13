// Format reference: GARBro ArcFormats/BlackRainbow/ArcIMP.cs, class `ImpOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/**
 * The signature doubles as the scheme selector: the reference looks the archive key up in a table of
 * known schemes, so only the games it knows about are recognized.
 */
const KNOWN_SCHEMES = new Map<number, number>([
	[0x3d66, 0xce032adb], // Kannagi
	[0x59e8, 0xd36050ec], // From M
]);

const INDEX_OFFSET = 4;
const FIRST_PAYLOAD_OFFSET = 0x404;
const ENTRY_COUNT = 0xff;
const NAME_WIDTH = 3;
/** Ranges of this size or less are treated as absent frames. */
const MIN_ENTRY_SIZE = 0x10n;

function schemeBytes(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value >>> 0, 0);
	return buffer;
}

/**
 * GARbro `ImpOpener.TryOpen`. The signature at 0x00 picks the XOR key, and the four bytes at 0x04
 * begin a table of 0xFF range end offsets. Every frame runs from the previous offset to the next one
 * and is named after the archive with a three digit index; frames of 0x10 bytes or less are skipped.
 *
 * The reference reads offsets without validating them against the archive size. Increasing offsets
 * describe frames normally, while a repeated or decreasing offset yields a zero or wrapped size, which
 * the size filter then drops or keeps exactly as the reference does.
 */
async function readImpIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<{ entries: FixedEntry[]; key: number } | undefined> {
	if (source.size < BigInt(FIRST_PAYLOAD_OFFSET)) return undefined;
	// The table holds one more offset than there are frames: the first one, then every frame end.
	const header = await source.readAt(0n, INDEX_OFFSET + (ENTRY_COUNT + 1) * 4);
	const signature = header.readUInt32LE(0);
	const key = KNOWN_SCHEMES.get(signature);
	if (key === undefined) return undefined;

	const baseName = basename(sourcePath ?? "").replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let offset = header.readUInt32LE(INDEX_OFFSET);
	for (let id = 0; id < ENTRY_COUNT; id += 1) {
		const nextOffset = header.readUInt32LE(INDEX_OFFSET + (id + 1) * 4);
		const size = BigInt((nextOffset - offset) >>> 0);
		if (size > MIN_ENTRY_SIZE) {
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(
						`${baseName}#${String(id).padStart(NAME_WIDTH, "0")}`,
					),
					offset: BigInt(FIRST_PAYLOAD_OFFSET) + BigInt(offset),
					size,
					metadata: { type: "image" },
				}),
			);
		}
		offset = nextOffset;
	}
	if (entries.length === 0) return undefined;
	return { entries, key };
}

/** The reference archive has no opener of its own, so frames are handed out as stored. */
const impEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.packedSize);

export const blackRainbowImpDescriptor: FormatDescriptor = {
	id: "black-rainbow-imp",
	name: "BlackRainbow image archive",
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
			source: "ArcFormats/BlackRainbow/ArcIMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const blackRainbowImpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blackRainbowImpDescriptor,
	detection: {
		signatures: [...KNOWN_SCHEMES.keys()].map((value) => ({
			bytes: schemeBytes(value),
		})),
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readImpIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readImpIndex(source, sourcePath);
		if (!index) throw new GarbroError("INVALID_ARCHIVE", "Unknown IMP scheme");
		return {
			entries: index.entries,
			metadata: { entryCount: index.entries.length, key: index.key },
		};
	},
	openEntry: impEntryOpener,
});
