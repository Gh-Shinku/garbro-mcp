// Format reference: GARBro ArcFormats/BlackRainbow/ArcIMP.cs, class `ImpOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { inflateLzss } from "@garbro-mcp/codecs";
import { writeBmp32 } from "../shared/bmp.js";
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
/** The head of a frame: the counts of the picture of it and the count of the places of the packed run. */
const FRAME_HEAD_SIZE = 0x10;
const WIDTH_AT = 0x00;
const HEIGHT_AT = 0x04;
const PACKED_SIZE_AT = 0x08;
/** The places of a colour of a picture of the engine, of four places of the file to a pixel. */
const PIXEL_SIZE = 4;
/** A picture this project is willing to hold. */
const MOST_PIXELS = 1 << 28;

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
					metadata: { type: "image", key },
				}),
			);
		}
		offset = nextOffset;
	}
	if (entries.length === 0) return undefined;
	return { entries, key };
}

/**
 * `ImpOpener.OpenImage` and the `ImpDecoder` behind it. The head of a frame names the counts of the picture,
 * the count of the places of the packed run of it and whether the covering place of a pixel stands of its
 * own; the run behind the head stands of the cipher of the archive and then of the walk of the places of the
 * file of the engine.
 */
const impEntryOpener: FixedEntryOpener = async (source, entry) => {
	const head = Buffer.from(await source.readAt(entry.offset, FRAME_HEAD_SIZE));
	if (head.length < FRAME_HEAD_SIZE) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"An IMP frame stands short of its head",
		);
	}
	const width = head.readUInt32LE(WIDTH_AT);
	const height = head.readUInt32LE(HEIGHT_AT);
	const packedSize = head.readUInt32LE(PACKED_SIZE_AT);
	if (0 === width || 0 === height || width * height > MOST_PIXELS) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`An IMP frame stands of ${width}x${height} places of a picture`,
		);
	}
	const pixels = width * height * PIXEL_SIZE;
	const length = FRAME_HEAD_SIZE + packedSize;
	if (entry.offset + BigInt(length) > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"An IMP frame reaches past the archive",
		);
	}
	const stored = Buffer.from(await source.readAt(entry.offset, length));
	// `ByteStringEncryptedStream`: every place of the file of the run stands of the key of the archive, of
	// the places of the file of the key taken in turn. The reference reads the run from the place behind the
	// head, so the places of the file of the key stand of that place taken against the count of the key.
	const key = Buffer.alloc(PIXEL_SIZE, 0x00);
	key.writeUInt32LE(Number(entry.metadata?.key ?? 0) >>> 0, 0);
	const phase = FRAME_HEAD_SIZE % key.length;
	for (let at = FRAME_HEAD_SIZE; at < stored.length; at += 1) {
		stored[at] =
			(stored[at] ?? 0) ^
			(key[(phase + at - FRAME_HEAD_SIZE) % key.length] ?? 0);
	}
	let plain: Buffer;
	try {
		plain = inflateLzss(stored.subarray(FRAME_HEAD_SIZE), {
			outputLength: pixels,
		});
	} catch (error) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The run of an IMP frame stands of no count of its own: ${(error as Error).message}`,
		);
	}
	// The reference hands the places of the picture over as four places of a colour to a pixel, of the
	// covering place of the pixel standing of its own where the head names one and of no count of its own
	// where it does not; this port keeps the places of the file of the frame either way.
	return Readable.from([writeBmp32(width, height, plain)]);
};

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
