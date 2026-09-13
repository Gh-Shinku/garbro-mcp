// Format reference: GARbro "Legacy/UMeSoft/AudioIKE.cs", class `IkeAudio` (ike-compressed WAVE).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readWave, writeWave } from "../shared/wav.js";
import { decodeIkeSize, unpackIke } from "./ike.js";

/** `0x6B69899D` little endian, which is `9D 89 69 6B`. */
const SIGNATURE = Buffer.from([0x9d, 0x89, 0x69, 0x6b]);
/** The header the reference reads before it decompresses anything. */
const HEADER_SIZE = 0x13;
/** Where the codec starts: `IkeReader.CreateStream` seeks here. */
const STREAM_OFFSET = 0x0d;
/** Its first two bytes are the flag word, so the first literal lands at 0x0F. */
const WAVE_MARKER_OFFSET = 0x0f;
const WAVE_MARKER = "RIFF";
const SIZE_BYTES_OFFSET = 10;
const MARKER_OFFSET = 2;
const MARKER = "ike";
/** The codec's own limit, so a header cannot make it allocate the world. */
const MAX_UNPACKED_SIZE = 0x4000000;

interface IkeLayout {
	unpackedSize: number;
}

/**
 * `TryOpen` reads nineteen bytes and requires three things: the marker `ike` at offset two, the four bytes
 * `RIFF` at offset fifteen, and a size the codec's three byte encoding can express.
 *
 * The two offsets look a hundred bytes apart and are in fact adjacent. The codec starts at 0x0D, and its
 * stream begins with a sixteen bit word of flag bits before any literal byte, so the first literal of the
 * compressed stream — the `R` of the WAVE header it decodes — sits at 0x0F. That is why checking `RIFF`
 * there is the same statement as checking that the first decoded literal is a wave header, and a test makes
 * the relation explicit rather than leaving it looking like a coincidence.
 */
async function readFields(source: ByteSource): Promise<IkeLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		// The registry gate is not a precondition for a direct `detect` call, so the tag is checked again.
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		if (head.toString("latin1", MARKER_OFFSET, MARKER_OFFSET + 3) !== MARKER)
			return undefined;
		if (
			head.toString(
				"latin1",
				WAVE_MARKER_OFFSET,
				WAVE_MARKER_OFFSET + WAVE_MARKER.length,
			) !== WAVE_MARKER
		)
			return undefined;
		const unpackedSize = decodeIkeSize(
			head[SIZE_BYTES_OFFSET] ?? 0,
			head[SIZE_BYTES_OFFSET + 1] ?? 0,
			head[SIZE_BYTES_OFFSET + 2] ?? 0,
		);
		if (unpackedSize <= 0 || unpackedSize > MAX_UNPACKED_SIZE) return undefined;
		return { unpackedSize };
	} catch {
		return undefined;
	}
}

export const ikeAudioDescriptor: FormatDescriptor = {
	id: "ume-soft-ike-audio",
	name: "ike-compressed WAVE audio",
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
			source: "Legacy/UMeSoft/AudioIKE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikeAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikeAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Ike audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The extraction is decompressed, so its length is not the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "ike",
				unpackedSize: layout.unpackedSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Ike audio");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const decoded = unpackIke(stored, layout.unpackedSize);
		// `Wav.TryOpen` supplies the format's real verdict: without a readable wave behind the codec the
		// reference returns null and the file is not this format at all. A listing cannot afford to
		// decompress, so the port reports the same verdict at extraction time.
		const wave = readWave(decoded);
		if (!wave)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ike audio wave data");
		// The decompressed wave is re-emitted canonically rather than passed through, which also drops any
		// trailing bytes the producer left after the data chunk. The layout names the payload rather than
		// carrying it, so the slice is taken here.
		const pcm = decoded.subarray(
			wave.dataOffset,
			wave.dataOffset + wave.dataSize,
		);
		return Readable.from([writeWave(wave.format, pcm)]);
	},
});
