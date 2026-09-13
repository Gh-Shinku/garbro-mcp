// Format reference: GARbro "Legacy/Uncanny/AudioCWV.cs", class `CwvAudio` (a WAV file encrypted with a
// keystream cipher). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/**
 * The encrypted `RIFF` tag: `0xA06F8BF7`. That word is what the reference declares as its signature, and
 * it is the first thing the cipher produces for a `RIFF` file, which the test checks.
 */
const SIGNATURE = Buffer.from([0xf7, 0x8b, 0x6f, 0xa0]);
const INITIAL_KEY = 0x4b5ab4a5;
/** The reference decrypts a header this long just to look for the wave format tag. */
const HEADER_SIZE = 0x10;
/** What those header bytes must decrypt to, i.e. the end of `RIFF....WAVEfmt `. */
const WAVE_MARKER_OFFSET = 8;
const WAVE_MARKER = Buffer.from("WAVEfmt ", "ascii");
const RIFF_MARKER = Buffer.from("RIFF", "ascii");

/**
 * GARbro `CwvAudio.Decrypt`, a keystream cipher: the low byte of the key is XORed into the data, and the
 * key then rotates its top bits down and absorbs the plaintext byte. The cipher is its own inverse, so
 * the same function encrypts and decrypts. Both shifts are wrapped to stay unsigned, which the reference
 * gets for free from `uint` arithmetic.
 */
export function decryptCwv(data: Buffer): Buffer {
	const output = Buffer.alloc(data.length);
	let key = INITIAL_KEY;
	for (let i = 0; i < data.length; i += 1) {
		const value = (key ^ data.readUInt8(i)) & 0xff;
		output[i] = value;
		key = ((((key << 9) >>> 0) | ((key >>> 23) & 0x1f0)) ^ value) >>> 0;
	}
	return output;
}

/**
 * GARbro `CwvAudio.TryOpen`: decrypt the first sixteen bytes and look for `WAVEfmt ` at offset 8, then
 * decrypt the whole file and let the wave reader parse it. The additional `RIFF` check stands in for the
 * chunk walk the reference delegates to `Wav.TryOpen`.
 */
async function readLayout(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = decryptCwv(
			Buffer.from(await source.readAt(0n, HEADER_SIZE)),
		);
		if (!header.subarray(WAVE_MARKER_OFFSET, HEADER_SIZE).equals(WAVE_MARKER))
			return undefined;
		if (!header.subarray(0, 4).equals(RIFF_MARKER)) return undefined;
		return Number(source.size);
	} catch {
		return undefined;
	}
}

export const cwvAudioDescriptor: FormatDescriptor = {
	id: "uncanny-cwv-audio",
	name: "Uncanny encrypted WAV audio",
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
			source: "Legacy/Uncanny/AudioCWV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cwvAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cwvAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const size = await readLayout(source);
		if (size === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Uncanny CWV audio");
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
			// The cipher is length preserving, so the extracted stream is exactly this long.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: { audio: "wav", encrypted: true },
		};
	},
	async openEntry(source: ByteSource) {
		const size = await readLayout(source);
		if (size === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Uncanny CWV audio");
		const stored = Buffer.from(await source.readAt(0n, size));
		// The reference decrypts the whole file and hands it to the wave reader.
		return Readable.from([decryptCwv(stored)]);
	},
});
