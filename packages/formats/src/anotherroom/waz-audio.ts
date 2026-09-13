// Format reference: GARbro "Legacy/AnotherRoom/AudioWAZ.cs", class `WazAudio` (an LZSS stream that holds
// a wave file). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeRiffHeader } from "../kapp/asd.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference's signature is `0x464952FF`: the first byte is the LZSS control byte for eight literals,
 * and the next three are the start of the literal run, which reads `RIF`.
 */
const SIGNATURE = Buffer.from([0xff, 0x52, 0x49, 0x46]);
const RIFF_HEADER_SIZE = 12;
/** Guards against a hostile stream asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

interface WavFormat {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

interface WazLayout {
	format: WavFormat;
	/** The `data` chunk payload inside the decompressed wave file. */
	dataOffset: number;
	dataSize: number;
}

/**
 * The equivalent of GARbro's `Wav.TryOpen`, which walks the chunks of the decompressed stream and takes
 * the format from the `fmt ` chunk and the PCM from the `data` chunk. Chunks are word aligned, and a
 * `data` size reaching past the stream is shortened rather than rejected, which is how a region behaves.
 */
function readWave(buffer: Buffer): WazLayout | undefined {
	if (buffer.length < RIFF_HEADER_SIZE) return undefined;
	if (buffer.toString("latin1", 0, 4) !== "RIFF") return undefined;
	if (buffer.toString("latin1", 8, 12) !== "WAVE") return undefined;
	let format: WavFormat | undefined;
	let dataOffset = -1;
	let dataSize = 0;
	let pos = RIFF_HEADER_SIZE;
	while (pos + 8 <= buffer.length) {
		const id = buffer.toString("latin1", pos, pos + 4);
		const size = buffer.readUInt32LE(pos + 4);
		const body = pos + 8;
		if (id === "fmt " && size >= 16 && body + 16 <= buffer.length) {
			format = {
				formatTag: buffer.readUInt16LE(body),
				channels: buffer.readUInt16LE(body + 2),
				sampleRate: buffer.readUInt32LE(body + 4),
				averageBytesPerSecond: buffer.readUInt32LE(body + 8),
				blockAlign: buffer.readUInt16LE(body + 12),
				bitsPerSample: buffer.readUInt16LE(body + 14),
			};
		} else if (id === "data") {
			dataOffset = body;
			dataSize = Math.max(0, Math.min(size, buffer.length - body));
		}
		// Chunks are padded to an even length.
		pos = body + size + (size & 1);
	}
	if (!format || dataOffset < 0) return undefined;
	return { format, dataOffset, dataSize };
}

/** Decompresses the stored stream; the reference wraps the whole file from offset zero. */
async function readWaveFile(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(SIGNATURE.length)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		return Buffer.from(inflateLzssAll(stored, { maxOutputLength: MAX_OUTPUT }));
	} catch {
		return undefined;
	}
}

async function readLayout(source: ByteSource): Promise<WazLayout | undefined> {
	const wave = await readWaveFile(source);
	if (!wave) return undefined;
	return readWave(wave);
}

export const wazAudioDescriptor: FormatDescriptor = {
	id: "anotherroom-waz-audio",
	name: "LZSS-compressed WAV audio",
	extensions: ["waz"],
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
			source: "Legacy/AnotherRoom/AudioWAZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wazAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wazAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AnotherRoom WAZ audio");
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
			// The stored stream is compressed and the output is reserialised.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "lzss",
				formatTag: layout.format.formatTag,
				channels: layout.format.channels,
				sampleRate: layout.format.sampleRate,
				bitsPerSample: layout.format.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const wave = await readWaveFile(source);
		if (!wave)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AnotherRoom WAZ audio");
		const layout = readWave(wave);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AnotherRoom WAZ audio");
		// `RawPcmInput` reserialises the sound as a canonical wave file from the `fmt ` chunk's fields.
		const pcm = Buffer.from(
			wave.subarray(layout.dataOffset, layout.dataOffset + layout.dataSize),
		);
		const riff = writeRiffHeader(
			{
				formatTag: layout.format.formatTag,
				channels: layout.format.channels,
				sampleRate: layout.format.sampleRate,
				averageBytesPerSecond: layout.format.averageBytesPerSecond,
				blockAlign: layout.format.blockAlign,
				bitsPerSample: layout.format.bitsPerSample,
			},
			pcm.length,
		);
		return Readable.from([Buffer.concat([riff, pcm])]);
	},
});
