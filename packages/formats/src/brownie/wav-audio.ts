// Format reference: GARbro "Legacy/Brownie/AudioWAV.cs", class `WavAudio` (a standalone audio
// resource: a wave header whose first sixteen bytes are obfuscated).
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

/** The stored signature, 'g#tX'; the reference only checks it through the registry gate. */
const SIGNATURE = Buffer.from([0x67, 0x23, 0x74, 0x58]);
const HEADER_SIZE = 0x10;
/** Bytes four to fifteen are masked with this key; the first four are simply replaced. */
const KEY = 0x5c;
const RIFF = Buffer.from("RIFF", "latin1");
const WAVE = Buffer.from("WAVE", "latin1");

interface Layout {
	/** The readable sixteen byte wave header the reference builds. */
	header: Buffer;
}

/** GARbro `WavAudio.TryOpen`: restore the header, then require `WAVE` at offset eight. */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!stored.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const unmasked: Buffer = Buffer.alloc(HEADER_SIZE - 4);
		for (let i = 0; i < unmasked.length; i += 1)
			unmasked[i] = (stored[4 + i] ?? 0) ^ KEY;
		if (!unmasked.subarray(4, 8).equals(WAVE)) return undefined;
		return { header: Buffer.concat([RIFF, unmasked]) };
	} catch {
		return undefined;
	}
}

export const brownieWavAudioDescriptor: FormatDescriptor = {
	id: "brownie-wav-audio",
	name: "Brownie obfuscated WAV file",
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
			source: "Legacy/Brownie/AudioWAV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const brownieWavAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: brownieWavAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!(await readLayout(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Brownie obscured WAV");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "wav"),
			offset: 0n,
			size: source.size,
			encrypted: true,
			metadata: { type: "audio" } as Record<string, unknown>,
		});
		return { entries: [entry], metadata: { audio: "wav", key: KEY } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Brownie obscured WAV");
		// The reference rebuilds the header and prefixes it to the rest of the file verbatim, so the
		// payload keeps the source length.
		const tail = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(entry.size) - HEADER_SIZE,
			),
		);
		return Readable.from([layout.header, tail]);
	},
});
