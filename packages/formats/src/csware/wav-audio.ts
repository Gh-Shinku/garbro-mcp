// Format reference: GARbro "ArcFormats/CsWare/AudioWAV.cs", class `WavAudio`
// ([960405][C's Ware] GLO-RI-A ~Kindan no Ketsuzoku~). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The probed header: a RIFF shape, a format byte pair, and the data tag with its size. */
const HEADER_SIZE = 0x2e;
/** The samples are unsigned bytes expanded into signed sixteen bit values. */
const SAMPLE_START = 0x2e;
const SAMPLE_BYTES = 2;
/** The wave header this port writes in front of the decoded samples. */
const WAVE_HEADER_SIZE = 44;
const BITS_PER_SAMPLE = 16;
/** A decoded audio stream is capped on the port's own account. */
const MAX_DECODE_BYTES = 256 * 1024 * 1024;

/**
 * The reference expands a byte through a table built from a logarithmic curve: index 128 is silence, above it
 * the values rise to full scale and below it they mirror. Only the positive half is computed — the negative
 * half is its negation — and the two ends are pinned to the extremes of a signed word.
 */
function buildSampleMap(): Int16Array {
	const map = new Int16Array(256);
	const clamp = (value: number): number =>
		value > 32767 ? 32767 : value < -32768 ? -32768 : value;
	for (let index = 1; index <= 127; index += 1) {
		const value = clamp(
			Math.trunc(Math.pow(10, (index + 44.8637) / 38.0597) - 14.5342),
		);
		map[128 + index] = value;
		map[128 - index] = -value;
	}
	map[0] = -0x8000;
	return map;
}

const SAMPLE_MAP = buildSampleMap();

interface CsWareLayout {
	channels: number;
	sampleRate: number;
	/** The average and block sizes, both doubled from the words the file stores. */
	byteRate: number;
	blockAlign: number;
	/** How many input bytes the file declares; the port's own limit is separate. */
	inputSize: number;
}

async function readLayout(
	source: ByteSource,
): Promise<CsWareLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		// A plain wave file shares the RIFF marker, so the format needs the byte pair, the format chunk and
		// the data tag before it will claim the file.
		if (header[0x14] !== 0x01 || header[0x15] !== 0xff) return undefined;
		if (header.toString("latin1", 8, 16) !== "WAVEfmt ") return undefined;
		if (header.toString("latin1", 0x26, 0x2a) !== "data") return undefined;
		return {
			channels: header.readUInt16LE(0x16),
			sampleRate: header.readUInt32LE(0x18),
			// The reference doubles these two unsigned words, so the doubling can wrap.
			byteRate: (header.readUInt32LE(0x1c) * 2) >>> 0,
			blockAlign: (header.readUInt16LE(0x20) * 2) & 0xffff,
			inputSize: header.readUInt32LE(0x2a),
		};
	} catch {
		return undefined;
	}
}

export const cswareWavAudioDescriptor: FormatDescriptor = {
	id: "csware-wav-audio",
	name: "C's ware encoded audio",
	extensions: ["wav"],
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
			source: "ArcFormats/CsWare/AudioWAV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cswareWavAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cswareWavAudioDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("RIFF", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid C's ware audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "audio",
					channels: layout.channels,
					sampleRate: layout.sampleRate,
					bitsPerSample: BITS_PER_SAMPLE,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				channels: layout.channels,
				sampleRate: layout.sampleRate,
				bitsPerSample: BITS_PER_SAMPLE,
				inputSize: layout.inputSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid C's ware audio");
		const declared = layout.inputSize * SAMPLE_BYTES;
		if (declared > MAX_DECODE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "C's ware audio is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The samples are the whole rest of the file, not the declared chunk alone.
		const body = file.subarray(SAMPLE_START);
		if (body.length * SAMPLE_BYTES > declared) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"C's ware audio holds more samples than it declares",
			);
		}
		// A stream that stops early leaves the rest of the declared samples silent.
		const samples: Buffer = Buffer.alloc(declared, 0x00);
		for (let index = 0; index < body.length; index += 1) {
			samples.writeInt16LE(
				SAMPLE_MAP[body[index] ?? 0] ?? 0,
				index * SAMPLE_BYTES,
			);
		}
		const output: Buffer = Buffer.alloc(
			WAVE_HEADER_SIZE + samples.length,
			0x00,
		);
		output.write("RIFF", 0, "latin1");
		output.writeUInt32LE(output.length - 8, 4);
		output.write("WAVEfmt ", 8, "latin1");
		output.writeUInt32LE(16, 16);
		output.writeUInt16LE(1, 20);
		output.writeUInt16LE(layout.channels, 22);
		output.writeUInt32LE(layout.sampleRate, 24);
		output.writeUInt32LE(layout.byteRate, 28);
		output.writeUInt16LE(layout.blockAlign, 32);
		output.writeUInt16LE(BITS_PER_SAMPLE, 34);
		output.write("data", 36, "latin1");
		output.writeUInt32LE(samples.length, 40);
		samples.copy(output, WAVE_HEADER_SIZE);
		return Readable.from([output]);
	},
});
