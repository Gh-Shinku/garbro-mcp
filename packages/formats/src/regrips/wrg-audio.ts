// Format reference: GARbro "Legacy/Regrips/AudioWRG.cs", class `WrgAudio` (a wave file whose bytes are
// inverted). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** `RIFF` with every byte inverted, which is what the reference's signature comes out as. */
const SIGNATURE = Buffer.from([0xad, 0xb6, 0xb9, 0xb9]);
const SCRAMBLE_KEY = 0xff;

function descramble(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ SCRAMBLE_KEY;
	return output;
}

/** `TryOpen` inverts the whole stream and then hands it to `Wav.TryOpen`. */
async function readWaveFile(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(SIGNATURE.length)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		return descramble(stored);
	} catch {
		return undefined;
	}
}

async function readLayout(source: ByteSource) {
	const wave = await readWaveFile(source);
	if (!wave) return undefined;
	return readWave(wave);
}

export const wrgAudioDescriptor: FormatDescriptor = {
	id: "regrips-wrg-audio",
	name: "Regrips encrypted WAVE file",
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
			source: "Legacy/Regrips/AudioWRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wrgAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wrgAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips WRG audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The sound is reserialised as a canonical wave file, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				encrypted: true,
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips WRG audio");
		const layout = readWave(wave);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips WRG audio");
		const pcm = Buffer.from(
			wave.subarray(layout.dataOffset, layout.dataOffset + layout.dataSize),
		);
		return Readable.from([writeWave(layout.format, pcm)]);
	},
});
