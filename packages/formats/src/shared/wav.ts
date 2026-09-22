// Wave file parsing shared by the audio ports whose payload is a wave file rather than raw PCM.
// The reference implementations all go through GARbro's `Wav.TryOpen`, which walks the chunks of the
// stream and takes the format from the `fmt ` chunk and the samples from the `data` chunk.

import { writeRiffHeader } from "../kapp/asd.js";

const RIFF_HEADER_SIZE = 12;

export interface WavFormat {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

export interface WavLayout {
	format: WavFormat;
	/** The `data` chunk payload inside the wave file. */
	dataOffset: number;
	dataSize: number;
}

/**
 * The equivalent of GARbro's `Wav.TryOpen`: requires the `RIFF` and `WAVE` markers, a `fmt ` chunk of at
 * least sixteen bytes and a `data` chunk. Chunks are word aligned, and a `data` size reaching past the
 * stream is shortened rather than rejected, which is how a region behaves. Returns nothing when either
 * chunk is missing.
 */
export function readWave(buffer: Buffer): WavLayout | undefined {
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

/**
 * Reserialises a sound the way GARbro's `RawPcmInput` does: the format block goes into a canonical 44 byte
 * RIFF header and the samples follow. Chunks other than `fmt ` and `data` are dropped, which is why the
 * ports that use this report `sizeKnown: false`.
 */
export function writeWave(format: WavFormat, pcm: Buffer): Buffer {
	return Buffer.concat([writeWaveHeader(format, pcm.length), pcm]);
}

/** Writes only the canonical 44-byte header for streaming PCM producers. */
export function writeWaveHeader(format: WavFormat, dataSize: number): Buffer {
	return writeRiffHeader(format, dataSize);
}
