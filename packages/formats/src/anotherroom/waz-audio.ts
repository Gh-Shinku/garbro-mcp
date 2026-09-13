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
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readWave, type WavLayout, writeWave } from "../shared/wav.js";

/**
 * The reference's signature is `0x464952FF`: the first byte is the LZSS control byte for eight literals,
 * and the next three are the start of the literal run, which reads `RIF`.
 */
const SIGNATURE = Buffer.from([0xff, 0x52, 0x49, 0x46]);
/** Guards against a hostile stream asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

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

async function readLayout(source: ByteSource): Promise<WavLayout | undefined> {
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
		return Readable.from([writeWave(layout.format, pcm)]);
	},
});
