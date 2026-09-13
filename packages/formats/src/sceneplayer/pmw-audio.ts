// Format reference: GARbro "ArcFormats/ScenePlayer/AudioPMW.cs", class `PmwAudio` (a wave file inside a zlib
// stream that is masked with a single byte — the audio counterpart of the PMP bitmap reader). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
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

/** The mask the whole file is stored under, the same key the PMP bitmap reader uses. */
const XOR_KEY = 0x21;
/** The masked form of the zlib CMF byte, which is the only check the reference makes on the header. */
const MASKED_CMF = 0x78 ^ XOR_KEY;
/** A bound on the decompressed size, which the reference does not impose. */
const MAX_OUTPUT = 0x10000000;

function unmask(input: Buffer): Buffer {
	const output = Buffer.alloc(input.length);
	for (let i = 0; i < input.length; i += 1)
		output[i] = (input[i] ?? 0) ^ XOR_KEY;
	return output;
}

interface PmwLayout {
	wave: WavLayout;
	pcm: Buffer;
}

/**
 * `TryOpen` reads the first byte, unmasks it and requires `0x78`, the zlib compression method byte. That is
 * only one value out of 256, so as with the PMP port the real gate is that the stream inflates and that the
 * payload is a wave file.
 */
async function readLayout(source: ByteSource): Promise<PmwLayout | undefined> {
	if (source.size < 2n) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, 1));
		if ((head[0] ?? 0) !== MASKED_CMF) return undefined;
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const inflated = Buffer.from(
			await inflateZlibBufferCapped(unmask(stored), MAX_OUTPUT),
		);
		const wave = readWave(inflated);
		if (!wave) return undefined;
		return {
			wave,
			pcm: inflated.subarray(wave.dataOffset, wave.dataOffset + wave.dataSize),
		};
	} catch {
		return undefined;
	}
}

function waveMetadata(wave: WavLayout) {
	return {
		type: "audio",
		format: "wav",
		formatTag: wave.format.formatTag,
		channels: wave.format.channels,
		sampleRate: wave.format.sampleRate,
		bitsPerSample: wave.format.bitsPerSample,
		encrypted: true,
	} as Record<string, unknown>;
}

export const pmwAudioDescriptor: FormatDescriptor = {
	id: "sceneplayer-pmw-audio",
	name: "ScenePlayer compressed WAV audio",
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
			source: "ArcFormats/ScenePlayer/AudioPMW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pmwAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pmwAudioDescriptor,
	// The reference declares no signature and no extension gate; the masked zlib header is the only test.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ScenePlayer PMW audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				compressed: true,
				metadata: waveMetadata(layout.wave),
			}),
			// Extraction writes a canonical wave file, so chunks beyond the format and data ones drop.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				...waveMetadata(layout.wave),
				pcmSize: layout.pcm.length,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ScenePlayer PMW audio");
		return Readable.from([writeWave(layout.wave.format, layout.pcm)]);
	},
});
