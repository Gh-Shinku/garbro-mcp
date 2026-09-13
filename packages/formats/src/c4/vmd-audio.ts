// Format reference: GARbro "ArcFormats/C4/AudioVMD.cs", class `VmdAudio` (a standalone audio
// resource: the whole file is an MP3 stream masked with a single byte key).
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

/** Every byte of the file is exclusive-ored with this key, the MP3 frame header included. */
const KEY = 0xe5;
/** The frame sync byte of an MP3 header, once unmasked. */
const FRAME_SYNC = 0xff;

/** GARbro `VmdAudio.TryOpen`: the masked MP3 header must survive the key. */
async function looksLikeMaskedMp3(source: ByteSource): Promise<boolean> {
	if (source.size < 3n) return false;
	try {
		const header = Buffer.from(await source.readAt(0n, 3));
		if (((header[0] ?? 0) ^ KEY) !== FRAME_SYNC) return false;
		if ((((header[1] ?? 0) ^ KEY) & 0xe6) !== 0xe2) return false;
		if ((((header[2] ?? 0) ^ KEY) & 0xf0) === 0xf0) return false;
		return true;
	} catch {
		return false;
	}
}

export const vmdAudioDescriptor: FormatDescriptor = {
	id: "c4-vmd-audio",
	name: "C4 engine MP3 audio",
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
			source: "ArcFormats/C4/AudioVMD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vmdAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vmdAudioDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return looksLikeMaskedMp3(source);
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!(await looksLikeMaskedMp3(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid C4 VMD audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "mp3"),
			offset: 0n,
			size: source.size,
			encrypted: true,
			metadata: { type: "audio" } as Record<string, unknown>,
		});
		return { entries: [entry], metadata: { audio: "mp3", key: KEY } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const output: Buffer = Buffer.alloc(data.length);
		for (let i = 0; i < data.length; i += 1) output[i] = (data[i] ?? 0) ^ KEY;
		return Readable.from([output]);
	},
});
