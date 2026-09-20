// Format reference: GARbro "ArcFormats/Cadath/AudioVWF.cs", class `VwfAudio` (an AZSYSTEM/1.0 sound of the
// Cadath engine: a voice that is scrambled, wrapped in zlib and stepped through by nibbles). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { ADP_QUANTIZE_TABLE } from "../abogado/adp-audio.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";
import { decryptCgf } from "./cgf-image.js";

/** 'VWF' with a nought of its own behind it, which is the word the reference registers. */
const SIGNATURE = Buffer.from([0x56, 0x57, 0x46, 0x1a]);
const HEADER_SIZE = 0x23;
const UNPACKED_LENGTH_FIELD = 0x05;
const SAMPLE_RATE_FIELD = 0x0d;
const INITIAL_SAMPLE_FIELD = 0x11;
const FIRST_STREAM_LENGTH_FIELD = 0x13;
const SECOND_STREAM_LENGTH_FIELD = 0x17;
/** Every stream stands four bytes of its own behind its place. */
const STREAM_BIAS = 4;
/** How far the quantiser moves for every code, which is the Abogado table but for the third step and the
 *  eleventh. */
const INCREMENT_TABLE = new Int8Array([
	-1, -1, -1, 0, 2, 4, 6, 8, -1, -1, -1, 0, 2, 4, 6, 8,
]);
const MAXIMUM_QUANTIZER = 0x58;
/** A stream this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface VwfLayout {
	/** The bytes of the unwrapped sound, two to every sample. */
	unpackedLength: number;
	sampleRate: number;
	initialSample: number;
	firstStreamLength: number;
	secondStreamLength: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `VwfAudio.TryOpen`: the file begins with the word `VWF` and a nought of its own, the size of the unwrapped
 * sound stands at five, the sample rate at `0x0D`, the sample the walk begins from at `0x11`, and the sizes of
 * the two streams at `0x13` and `0x17`.
 */
export function readVwfLayout(
	data: Buffer,
	fileLength = data.length,
): VwfLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const unpackedLength = data.readInt32LE(UNPACKED_LENGTH_FIELD);
	const firstStreamLength = data.readInt32LE(FIRST_STREAM_LENGTH_FIELD);
	const secondStreamLength = data.readInt32LE(SECOND_STREAM_LENGTH_FIELD);
	if (unpackedLength <= 0 || unpackedLength > LIMIT) return undefined;
	if (firstStreamLength <= 0 || secondStreamLength <= 0) return undefined;
	if (firstStreamLength + secondStreamLength > LIMIT) return undefined;
	if (HEADER_SIZE + firstStreamLength + secondStreamLength > fileLength) {
		return undefined;
	}
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	if (sampleRate === 0) return undefined;
	return {
		unpackedLength,
		sampleRate,
		initialSample: data.readInt16LE(INITIAL_SAMPLE_FIELD),
		firstStreamLength,
		secondStreamLength,
	};
}

export function decodeVwfAdp(
	input: Buffer,
	samples: number,
	initial: number,
): Int16Array {
	const output = new Int16Array(samples);
	let source = 0;
	let sample = initial;
	let quantizer = 0;
	let byte = 0;
	let odd = false;
	let quant = ADP_QUANTIZE_TABLE[0] ?? 0;
	for (let index = 0; index < samples; ) {
		let code: number;
		if (odd) {
			code = byte & 0x0f;
		} else {
			if (source >= input.length) break;
			byte = input[source] ?? 0;
			source += 1;
			code = byte >> 4;
		}
		quantizer += INCREMENT_TABLE[code] ?? 0;
		if (quantizer < 0) quantizer = 0;
		else if (quantizer > MAXIMUM_QUANTIZER) {
			quantizer = MAXIMUM_QUANTIZER;
		}
		let step = quant >> 3;
		if (0 !== (code & 4)) step += quant;
		if (0 !== (code & 2)) step += quant >> 1;
		if (0 !== (code & 1)) step += quant >> 2;
		if (code < 8) sample = Math.min(0x7fff, sample + step);
		else sample = Math.max(-32768, sample - step);
		quant = ADP_QUANTIZE_TABLE[quantizer] ?? 0;
		output[index] = sample;
		index += 1;
		odd = !odd;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const cadathVwfAudioDescriptor: FormatDescriptor = {
	id: "cadath-vwf-audio",
	name: "AZSYSTEM/1.0 audio format",
	extensions: ["vwf"],
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
			source: "ArcFormats/Cadath/AudioVWF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cadathVwfAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cadathVwfAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readVwfLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readVwfLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidSound("Not an AZSYSTEM/1.0 sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(layout.unpackedLength),
				compressed: true,
				encrypted: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: 1,
					bitsPerSample: 16,
				},
			}),
			// The sound is unwrapped and a wave header is written around it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				codec: "adpcm",
				sampleRate: layout.sampleRate,
				channels: 1,
				bitsPerSample: 16,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readVwfLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidSound("Not an AZSYSTEM/1.0 sound");
		}
		const samples = layout.unpackedLength >> 1;
		const data = Buffer.from(
			stored.subarray(
				HEADER_SIZE,
				HEADER_SIZE + layout.firstStreamLength + layout.secondStreamLength,
			),
		);
		// Only the first stream stands scrambled; the second one is only wrapped.
		decryptCgf(data, layout.firstStreamLength);
		const first = await inflateZlibBuffer(
			data.subarray(STREAM_BIAS, layout.firstStreamLength),
			(samples + 7) >> 3,
		);
		const secondStart = layout.firstStreamLength + STREAM_BIAS;
		const second = await inflateZlibBuffer(
			data.subarray(
				secondStart,
				layout.firstStreamLength + layout.secondStreamLength,
			),
			samples >> 1,
		);
		const decoded = decodeVwfAdp(second, samples, layout.initialSample);
		const pcm: Buffer = Buffer.alloc(layout.unpackedLength, 0x00);
		let byte = 0x80;
		let index = 0;
		for (let sample = 0; sample < decoded.length; sample += 1) {
			// A sample never falls below nought before its place is read.
			let value = Math.max(decoded[sample] ?? 0, 0);
			if (0 !== (byte & (first[index] ?? 0))) value = -value;
			pcm.writeInt16LE(value, sample * 2);
			byte >>= 1;
			if (0 === byte) {
				index += 1;
				byte = 0x80;
			}
		}
		return Readable.from([
			writeWave(
				{
					formatTag: 1,
					channels: 1,
					sampleRate: layout.sampleRate,
					averageBytesPerSecond: layout.sampleRate * 2,
					blockAlign: 2,
					bitsPerSample: 16,
				},
				pcm,
			),
		]);
	},
});
