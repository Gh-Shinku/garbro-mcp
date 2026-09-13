// Format reference: GARbro "Legacy/Regrips/AudioWRG.cs", class `MrgAudio` (an MP3 whose bytes are
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

const SCRAMBLE_KEY = 0xff;

function descramble(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ SCRAMBLE_KEY;
	return output;
}

/**
 * Checks an MPEG audio frame header at the start of the stream: eleven sync bits, then a version and a layer
 * field, neither of which may hold its reserved value. The check sits at offset zero because the stored
 * first byte is required to be zero, which fixes the decoded first byte at `0xFF` — an `ID3` tag, or any
 * other leading data, cannot survive that constraint.
 */
function looksLikeMp3(buffer: Buffer): boolean {
	if (buffer.length < 2) return false;
	if ((buffer[0] ?? 0) !== 0xff) return false;
	const second = buffer[1] ?? 0;
	if ((second & 0xe0) !== 0xe0) return false;
	if (((second >> 3) & 3) === 1) return false;
	if (((second >> 1) & 3) === 0) return false;
	return true;
}

/**
 * `MrgAudio.TryOpen` reads two bytes and rejects the file unless the first is zero, then inverts the whole
 * stream and hands it to the MP3 format. The zero is a proxy for the inverted frame header: exclusive-oring
 * zero with `0xFF` gives the `0xFF` that begins an MPEG frame, so the check reads the stored byte rather
 * than the decoded one.
 */
async function readAudio(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < 2n) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (stored[0] !== 0) return undefined;
		const decoded = descramble(stored);
		if (!looksLikeMp3(decoded)) return undefined;
		return decoded;
	} catch {
		return undefined;
	}
}

export const regripsMrgAudioDescriptor: FormatDescriptor = {
	id: "regrips-mrg-audio",
	name: "Regrips encrypted MP3 file",
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

export const regripsMrgAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: regripsMrgAudioDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAudio(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const decoded = await readAudio(source);
		if (!decoded)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips MRG audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "mp3"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// Inverting bytes preserves length, so the listed size is the extracted size.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: { audio: "mp3", encrypted: true },
		};
	},
	async openEntry(source: ByteSource) {
		const decoded = await readAudio(source);
		if (!decoded)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips MRG audio");
		// The reference hands the decoded stream to the MP3 reader, so the output is those bytes.
		return Readable.from([decoded]);
	},
});
