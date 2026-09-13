// Format reference: GARbro "ArcFormats/Ipac/AudioWST.cs", class `WstAudio` (IPAC ADPCM audio).
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

/** `'WST2'`. */
const SIGNATURE = Buffer.from([0x57, 0x53, 0x54, 0x32]);
/** The read starts here and covers the extra data's last twenty eight bytes. */
const EXTRA_DATA_OFFSET = 0x0c;
const EXTRA_DATA_BYTES = 0x1c;
/** Twenty eight bytes of coefficients, and the four the reference supplies itself. */
const EXTRA_DATA_SIZE = 0x20;
const SAMPLES_PER_BLOCK = 0x07f4;
const COEFFICIENTS = 7;
/** The stream begins after the extra data. */
const DATA_OFFSET = EXTRA_DATA_OFFSET + EXTRA_DATA_BYTES;
const WAVE_HEADER_SIZE = 0x4e;
/** The wave's size word counts everything after its first eight bytes: the header less eight, plus data. */
const WAVE_SIZE_BIAS = WAVE_HEADER_SIZE - 8;
const FORMAT_CHUNK_SIZE = 0x32;

/**
 * `TryOpen` seeks to twelve and reads twenty eight bytes into the *middle* of a thirty two byte buffer, so a
 * short read leaves the tail untouched — except that the reference returns null instead, which makes the
 * completeness of that read the format's only validation. There is no other check: bytes zero to eleven are
 * never read at all, and the twenty eight bytes it does read are the seven coefficient pairs, with the count
 * and the samples a block supplied by the code rather than the file.
 */
async function readExtraData(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(DATA_OFFSET)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, DATA_OFFSET));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		const extra: Buffer = Buffer.alloc(EXTRA_DATA_SIZE, 0x00);
		// The four the reference writes itself: samples a block, the coefficient count, and a zero the allocation
		// already left there. The coefficients are the twenty eight bytes that follow.
		extra[0] = 0xf4;
		extra[1] = 0x07;
		extra[2] = COEFFICIENTS;
		// Read into the buffer's middle, so the file's first byte here is the first coefficient byte.
		head.copy(extra, 4, EXTRA_DATA_OFFSET, DATA_OFFSET);
		return extra;
	} catch {
		return undefined;
	}
}

export const wstAudioDescriptor: FormatDescriptor = {
	id: "ipac-wst-audio",
	name: "IPAC ADPCM audio",
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
			source: "ArcFormats/Ipac/AudioWST.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wstAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wstAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readExtraData(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const extra = await readExtraData(source);
		if (!extra)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid IPAC WST audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					audio: "wav",
					formatTag: 2,
					channels: 2,
					sampleRate: 0xac44,
					blockAlign: 0x800,
					bitsPerSample: 4,
				} as Record<string, unknown>,
			}),
			// The extraction is a wave, so it has a header the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				formatTag: 2,
				channels: 2,
				sampleRate: 0xac44,
				samplesPerBlock: SAMPLES_PER_BLOCK,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const extra = await readExtraData(source);
		if (!extra)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid IPAC WST audio");
		const dataLength = Number(source.size) - DATA_OFFSET;
		const pcm = Buffer.from(
			await source.readAt(BigInt(DATA_OFFSET), dataLength),
		);
		// The wave header is written field by field with fixed values, and two of them are worth naming: the
		// average byte rate is the sample rate rather than anything computed from the block alignment, and the
		// format's extra data is thirty two bytes with a `cbSize` of thirty two. The stream follows the `data`
		// chunk header, and its declared size is everything from the extra data's end to the file's.
		const header: Buffer = Buffer.alloc(WAVE_HEADER_SIZE, 0x00);
		header.write("RIFF", 0, "latin1");
		header.writeUInt32LE(WAVE_SIZE_BIAS + dataLength, 4);
		header.write("WAVE", 8, "latin1");
		header.write("fmt ", 12, "latin1");
		header.writeUInt32LE(FORMAT_CHUNK_SIZE, 16);
		header.writeUInt16LE(2, 20); // ADPCM
		header.writeUInt16LE(2, 22); // two channels
		header.writeUInt32LE(0xac44, 24); // 44100
		header.writeUInt32LE(0xac44, 28); // the byte rate, deliberately the sample rate
		header.writeUInt16LE(0x800, 32);
		header.writeUInt16LE(4, 34);
		header.writeUInt16LE(EXTRA_DATA_SIZE, 36); // cbSize
		extra.copy(header, 38);
		header.write("data", 70, "latin1");
		header.writeUInt32LE(dataLength, 74);
		return Readable.from([Buffer.concat([header, pcm])]);
	},
});
