// Format reference: GARBro ArcFormats/Ankh/ArcGRP.cs, class `GrpOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream, inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { GrpUnpacker, unpackTpw } from "./grp-unpack.js";

const FIRST_OFFSET_SIZE = 4;
const TABLE_ALIGNMENT = 3n;
const NAME_WIDTH = 4;
const HEADER_SIZE = 16;
/** Shorter payloads have no header to inspect. */
const MIN_DETECT_SIZE = 8n;
const TPW_MARKER = Buffer.from("TPW", "ascii");
const TPW_UNPACKED_SIZE_OFFSET = 4;
/** The TPW unpacked-size word already exposes the bitmap marker of the folded image. */
const TPW_SIGNATURE_OFFSET = 11;
const HDJ_MARKER = Buffer.from("HDJ\0", "binary");
const HDJ_SIGNATURE_OFFSET = 12;
const HDJ_HEADER_SIZE = 8;
const ZFD_MARKER = Buffer.from("zfd ", "ascii");
const ZFD_UNPACKED_SIZE_OFFSET = 4;
const ZFD_HEADER_SIZE = 8;
const OGG_MARKER = Buffer.from("OggS", "ascii");
const PREFIX_SIZE = 4;
const RIFF_MARKER = Buffer.from("RIFF", "ascii");
const RIFF_DIRECT_OFFSET = 8;
const RIFF_PREFIXED_OFFSET = 5;
/** The byte in front of an inline RIFF header, or behind it, names the packing. */
const RIFF_MARKER_OFFSET = 4;
const PCM_MARKER = 0x57;
const NIBBLE_MASK = 0xf;
const MIN_WRAPPED_SIZE = 12n;
const PCM_UNPACKED_SIZE_OFFSET = 0;
const PCM_PACK_TYPE_OFFSET = 5;
const PCM_CHANNELS_OFFSET = 6;
const PCM_HEADER_SIZE_OFFSET = 7;
const PCM_HEADER_SIZE = 8;
/** The two accepted pack types, the ADPCM and the sample one. */
const PCM_PACK_TYPES = ["A", "S"];
const MP3_SYNC = 0xfbff;
const BMP_MARKER = Buffer.from("BM", "ascii");
const MIDI_MARKER = Buffer.from("MThd", "ascii");
const RAW_AUDIO_SIGNATURES = [0x010001, 0x020001];
const RAW_AUDIO_EXTRA_OFFSET = 0x10;
const RAW_AUDIO_SIZE_OFFSET = 0x12;
const RAW_AUDIO_HEADER_SIZE = 0x16;
const BMP_SIGNATURE = 0x4d42;

/** GARbro `AutoEntry.DetectFileType`, limited to the special cases the catalog resolves uniquely. */
const DETECTED_TYPES: readonly {
	signature: number;
	type: string;
	extension: string;
}[] = [
	{ signature: 0x5367674f, type: "audio", extension: "ogg" },
	{ signature: 0x46464952, type: "audio", extension: "wav" },
];

function detectFileType(
	signature: number,
): { type: string; extension: string } | undefined {
	if (signature === 0) return undefined;
	const match = DETECTED_TYPES.find(
		(candidate) => candidate.signature === signature,
	);
	if (match) return { type: match.type, extension: match.extension };
	if ((signature & 0xffff) === BMP_SIGNATURE)
		return { type: "image", extension: "bmp" };
	return undefined;
}

/**
 * GARbro `GrpOpener.TryOpen`. The first word is both the offset of the first payload and the end of the
 * word-aligned offset table that follows the four-byte count, so the entry count is derived from it: the
 * table holds one offset per entry and its last word is the file end.
 *
 * Every entry spans from its own table word to the next one — the file end for the last one — and is
 * named `<archive>#<index>` with a four-digit index. Zero-length ranges are skipped, but they still
 * consume an index.
 */
async function readGrpIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_OFFSET_SIZE)) return undefined;
	const firstOffset = BigInt(
		(await source.readAt(0n, FIRST_OFFSET_SIZE)).readUInt32LE(0),
	);
	if (firstOffset < 8n || firstOffset >= source.size) return undefined;
	if ((firstOffset & TABLE_ALIGNMENT) !== 0n) return undefined;
	const count = Number((firstOffset - 4n) / 4n);
	if (!isSaneCount(count)) return undefined;

	const baseName = basename(sourcePath ?? "").replace(/\.[^.]*$/, "");
	const table = await source.readAt(BigInt(FIRST_OFFSET_SIZE), count * 4);
	const entries: FixedEntry[] = [];
	let nextOffset = firstOffset;
	for (let id = 0; id < count && nextOffset < source.size; id += 1) {
		const offset = nextOffset;
		nextOffset = BigInt(table.readUInt32LE(id * 4));
		if (nextOffset < offset) return undefined;
		const size = nextOffset - offset;
		if (size === 0n) continue;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(NAME_WIDTH, "0")}`,
				),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** Reads a little-endian word, reporting zero outside the source instead of failing. */
async function readWordAt(source: ByteSource, offset: bigint): Promise<number> {
	if (offset < 0n || offset + 4n > source.size) return 0;
	return (await source.readAt(offset, 4)).readUInt32LE(0);
}

/** Reads a short marker outside the source as an empty comparison. */
async function hasMarker(
	source: ByteSource,
	offset: bigint,
	marker: Buffer,
): Promise<boolean> {
	if (offset < 0n || offset + BigInt(marker.length) > source.size) return false;
	return (await source.readAt(offset, marker.length)).equals(marker);
}

/** GARbro `Entry.ChangeType`: the resource type and the extension of its first resource. */
function retypeEntry(
	entry: FixedEntry,
	type: string,
	extension: string | undefined,
): void {
	entry.metadata = { type };
	if (extension) entry.path = changeExtension(entry.path, extension);
}

/**
 * GARbro `GrpOpener.DetectFileTypes`. Every payload longer than eight bytes is inspected through a
 * reused sixteen-byte header, so a short read leaves the previous entry's bytes in place exactly as the
 * reference does.
 *
 * The inspection recognizes the archive's own containers — TPW, HDJ and zfd — which reveal whether the
 * payload is compressed, where it starts and how large it expands, and otherwise types the entry from an
 * inline Ogg, RIFF/WAV, MP3 or raw-PCM header.
 */
async function detectFileTypes(
	source: ByteSource,
	entries: readonly FixedEntry[],
): Promise<void> {
	const header = Buffer.alloc(HEADER_SIZE);
	for (const entry of entries) {
		if (entry.packedSize <= MIN_DETECT_SIZE) continue;
		const available = Math.min(
			Number(entry.packedSize),
			HEADER_SIZE,
			Number(source.size - entry.offset),
		);
		if (available > 0) {
			const stored = await source.readAt(entry.offset, available);
			stored.copy(header, 0);
		}
		if (header.subarray(0, TPW_MARKER.length).equals(TPW_MARKER)) {
			// A non-zero fourth byte means the payload is folded and carries its size at 0x04.
			const packed = (header[3] ?? 0) !== 0;
			let probeOffset = entry.offset + BigInt(TPW_UNPACKED_SIZE_OFFSET);
			if (packed) {
				entry.size = BigInt(await readWordAt(source, probeOffset));
				entry.compressed = true;
				entry.sizeKnown = true;
				probeOffset = entry.offset + BigInt(TPW_SIGNATURE_OFFSET);
			} else {
				entry.offset += BigInt(PREFIX_SIZE);
				entry.size -= BigInt(PREFIX_SIZE);
				entry.packedSize = entry.size;
			}
			if (await hasMarker(source, probeOffset, BMP_MARKER))
				retypeEntry(entry, "image", "bmp");
		} else if (
			header
				.subarray(PREFIX_SIZE, PREFIX_SIZE + HDJ_MARKER.length)
				.equals(HDJ_MARKER)
		) {
			if (
				header
					.subarray(
						HDJ_SIGNATURE_OFFSET,
						HDJ_SIGNATURE_OFFSET + BMP_MARKER.length,
					)
					.equals(BMP_MARKER)
			)
				retypeEntry(entry, "image", "bmp");
			else if (
				header
					.subarray(
						HDJ_SIGNATURE_OFFSET,
						HDJ_SIGNATURE_OFFSET + MIDI_MARKER.length,
					)
					.equals(MIDI_MARKER)
			)
				entry.path = changeExtension(entry.path, "mid");
			entry.size = BigInt(header.readUInt32LE(0));
			entry.compressed = true;
			entry.sizeKnown = true;
		} else if (header.subarray(0, ZFD_MARKER.length).equals(ZFD_MARKER)) {
			retypeEntry(entry, "image", "tga");
			entry.size = BigInt(header.readUInt32LE(ZFD_UNPACKED_SIZE_OFFSET));
			entry.compressed = true;
			entry.sizeKnown = false;
		} else if (
			header
				.subarray(PREFIX_SIZE, PREFIX_SIZE + OGG_MARKER.length)
				.equals(OGG_MARKER)
		) {
			retypeEntry(entry, "audio", "ogg");
			entry.offset += BigInt(PREFIX_SIZE);
			entry.size -= BigInt(PREFIX_SIZE);
			entry.packedSize = entry.size;
		} else if (
			entry.packedSize > MIN_WRAPPED_SIZE &&
			(header
				.subarray(RIFF_DIRECT_OFFSET, RIFF_DIRECT_OFFSET + 4)
				.equals(RIFF_MARKER) ||
				(((header[RIFF_MARKER_OFFSET] ?? 0) & NIBBLE_MASK) === NIBBLE_MASK &&
					header
						.subarray(RIFF_PREFIXED_OFFSET, RIFF_PREFIXED_OFFSET + 4)
						.equals(RIFF_MARKER)))
		) {
			retypeEntry(entry, "audio", "wav");
			entry.size = BigInt(header.readUInt32LE(0));
			entry.compressed = true;
			// A packed payload is decoded to its end, so its length is not fixed.
			entry.sizeKnown = !(
				((header[RIFF_MARKER_OFFSET] ?? 0) & NIBBLE_MASK) ===
				NIBBLE_MASK
			);
		} else {
			await detectPlainEntry(source, entry, header);
		}
	}
}

/** GARbro's fallback typing: catalog detection, MP3 frame sync, then a raw PCM layout test. */
async function detectPlainEntry(
	source: ByteSource,
	entry: FixedEntry,
	header: Buffer,
): Promise<void> {
	const signature = header.readUInt32LE(0);
	const detected = detectFileType(signature);
	if (detected) {
		retypeEntry(entry, detected.type, detected.extension);
		return;
	}
	if ((signature & 0xffff) === MP3_SYNC) {
		retypeEntry(entry, "audio", "mp3");
		return;
	}
	if (entry.packedSize <= BigInt(RAW_AUDIO_HEADER_SIZE)) return;
	const probe = await source.readAt(entry.offset, RAW_AUDIO_HEADER_SIZE);
	if (!RAW_AUDIO_SIGNATURES.includes(probe.readUInt32LE(0))) return;
	if (probe.readUInt16LE(RAW_AUDIO_EXTRA_OFFSET) !== 0) return;
	if (
		BigInt(
			RAW_AUDIO_HEADER_SIZE + probe.readUInt32LE(RAW_AUDIO_SIZE_OFFSET),
		) !== entry.packedSize
	)
		return;
	retypeEntry(entry, "audio", undefined);
}

/** GARbro `GrpOpener.OpenAudio`: a header in front of a packed sample stream. */
async function openAudio(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable | undefined> {
	if (entry.packedSize < BigInt(PCM_HEADER_SIZE)) return undefined;
	const header = await source.readAt(entry.offset, PCM_HEADER_SIZE);
	const unpackedSize = header.readInt32LE(PCM_UNPACKED_SIZE_OFFSET);
	const packType = String.fromCharCode(header[PCM_PACK_TYPE_OFFSET] ?? 0);
	const channels = header[PCM_CHANNELS_OFFSET] ?? 0;
	const headerSize = header[PCM_HEADER_SIZE_OFFSET] ?? 0;
	if (
		unpackedSize <= 0 ||
		headerSize > unpackedSize ||
		!PCM_PACK_TYPES.includes(packType)
	)
		return undefined;
	const stored = await source.readAt(
		entry.offset + BigInt(PCM_HEADER_SIZE),
		Number(entry.packedSize) - PCM_HEADER_SIZE,
	);
	const copied = Math.min(headerSize, stored.length);
	const output = Buffer.alloc(unpackedSize);
	stored.copy(output, 0, 0, copied);
	const unpacker = new GrpUnpacker(stored.subarray(copied));
	if (packType === "A") unpacker.unpackA(output, headerSize, channels);
	else unpacker.unpackS(output, headerSize, channels);
	return Readable.from([output]);
}

/**
 * GARbro `GrpOpener.OpenEntry`. A packed entry is dispatched on its container: TPW unfolds into the
 * declared size, HDJ and zfd run through their own decoders, an inline RIFF payload is either packed
 * samples or an LZSS stream behind a one-byte prefix, and anything else stays an LZSS stream. The
 * reference swallows every decoding error and hands out the stored payload instead, which the port
 * mirrors.
 */
const grpEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.compressed && entry.packedSize > MIN_DETECT_SIZE) {
		try {
			const prefix = await source.readAt(entry.offset, PREFIX_SIZE * 2);
			if (prefix.subarray(0, TPW_MARKER.length).equals(TPW_MARKER)) {
				const stored = await source.readAt(
					entry.offset,
					Number(entry.packedSize),
				);
				const output = Buffer.alloc(Number(entry.size));
				unpackTpw(stored, output);
				return Readable.from([output]);
			}
			if (
				prefix
					.subarray(PREFIX_SIZE, PREFIX_SIZE + HDJ_MARKER.length)
					.equals(HDJ_MARKER)
			) {
				const stored = await source.readAt(
					entry.offset + BigInt(HDJ_HEADER_SIZE),
					Number(entry.packedSize) - HDJ_HEADER_SIZE,
				);
				const output = Buffer.alloc(Number(entry.size));
				new GrpUnpacker(stored).unpackHdj(output);
				return Readable.from([output]);
			}
			if (prefix.subarray(0, ZFD_MARKER.length).equals(ZFD_MARKER)) {
				const stored = await source.readAt(
					entry.offset + BigInt(ZFD_HEADER_SIZE),
					Number(entry.packedSize) - ZFD_HEADER_SIZE,
				);
				return createZlibInflateStream(Readable.from([stored]));
			}
			if (entry.packedSize > MIN_WRAPPED_SIZE) {
				const type =
					(
						await source.readAt(entry.offset + BigInt(RIFF_MARKER_OFFSET), 1)
					)[0] ?? 0;
				if (
					type === PCM_MARKER &&
					(await hasMarker(
						source,
						entry.offset + BigInt(RIFF_DIRECT_OFFSET),
						RIFF_MARKER,
					))
				) {
					const audio = await openAudio(source, entry);
					if (audio) return audio;
				} else if (
					(type & NIBBLE_MASK) === NIBBLE_MASK &&
					(await hasMarker(
						source,
						entry.offset + BigInt(RIFF_PREFIXED_OFFSET),
						RIFF_MARKER,
					))
				) {
					const stored = await source.readAt(
						entry.offset + BigInt(PREFIX_SIZE),
						Number(entry.packedSize) - PREFIX_SIZE,
					);
					return Readable.from([inflateLzssAll(stored)]);
				}
			}
		} catch {
			// The reference logs the failure and returns the stored payload.
		}
	}
	return source.createReadStream(entry.offset, entry.packedSize);
};

export const ankhGrpDescriptor: FormatDescriptor = {
	id: "ankh-grp",
	name: "Ice Soft resource archive",
	extensions: ["grp", "bin", "dat", "vc"],
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
			source: "ArcFormats/Ankh/ArcGRP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ankhGrpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ankhGrpDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readGrpIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGrpIndex(source, sourcePath).catch(
			() => undefined,
		);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GRP layout");
		await detectFileTypes(source, entries);
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: grpEntryOpener,
});
