// Format reference: GARbro "ArcFormats/Bruns/AudioUM3.cs", class `Um3Audio` and its `Um3Stream`
// (an Ogg stream whose first `0x800` bytes are inverted). GARbro commit
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

/** The signature is `OggS` with every byte inverted, which is what the scramble does to the header. */
const SIGNATURE = Buffer.from([0xb0, 0x98, 0x98, 0xac]);
const SCRAMBLE_KEY = 0xff;
/** Only the beginning of the file is scrambled; the rest of the Ogg stream is in the clear. */
const SCRAMBLE_SIZE = 0x800;

function descramble(input: Buffer, offset: number): void {
	const end = Math.min(SCRAMBLE_SIZE, input.length);
	for (let i = offset; i < end; i += 1)
		input[i] = (input[i] ?? 0) ^ SCRAMBLE_KEY;
}

async function readLayout(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(SIGNATURE.length)) return false;
	try {
		const head = Buffer.from(
			await source.readAt(0n, Math.min(SIGNATURE.length, Number(source.size))),
		);
		descramble(head, 0);
		return head
			.subarray(0, SIGNATURE.length)
			.equals(Buffer.from("OggS", "latin1"));
	} catch {
		return false;
	}
}

export const um3AudioDescriptor: FormatDescriptor = {
	id: "bruns-um3-audio",
	name: "UltraMarine3 audio format (Ogg/Vorbis)",
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
			source: "ArcFormats/Bruns/AudioUM3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const um3AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: um3AudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return readLayout(source);
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!(await readLayout(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Bruns UM3 audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// Inverting bytes keeps the length, so the listed size is the extracted size.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "ogg",
				encrypted: true,
				scrambledBytes: SCRAMBLE_SIZE,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if (!(await readLayout(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Bruns UM3 audio");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// `Um3Stream` inverts every byte read from the first `0x800` and passes the rest through.
		descramble(stored, 0);
		return Readable.from([stored]);
	},
});
