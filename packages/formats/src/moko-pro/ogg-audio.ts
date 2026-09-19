// Format reference: GARbro "ArcFormats/MokoPro/CompressedFile.cs", classes `NNNNOggAudio` and `MokoCrypt` (a
// Mokopro sound: the container of this engine whose walk of runs gives a sound of the Ogg kind). GARbro commit
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
import { MOKO_SIGNATURE, readMokoHeader, unpackMoko } from "./moko-core.js";

/** 'OggS', the word every sound of the Ogg kind begins with. */
const OGG_MARK = Buffer.from("OggS", "latin1");

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** What the walk of runs of a sound of this engine gives, where it gives a sound of the Ogg kind. */
async function readMokoOgg(
	source: ByteSource,
): Promise<{ ogg: Buffer; unpackedSize: number } | undefined> {
	const unpackedSize = await readMokoHeader(source);
	if (unpackedSize === undefined) return undefined;
	const ogg = unpackMoko(await readStored(source), unpackedSize);
	return ogg.subarray(0, OGG_MARK.length).equals(OGG_MARK)
		? { ogg, unpackedSize }
		: undefined;
}

export const mokoProOggAudioDescriptor: FormatDescriptor = {
	id: "mokopro-ogg-audio",
	name: "Mokopro compressed audio",
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
			source: "ArcFormats/MokoPro/CompressedFile.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mokoProOggAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mokoProOggAudioDescriptor,
	// The reference registers the word `NNNN`, which the archive shape of the container registers as well;
	// the priority puts the sound and the picture ahead of the archive wherever no name says otherwise.
	detection: { signatures: [{ bytes: MOKO_SIGNATURE }], priority: 10 },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readMokoOgg(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const sound = await readMokoOgg(source);
		if (!sound) throw invalidSound("Not a Mokopro sound");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: 0n,
				size: BigInt(sound.unpackedSize),
				packedSize: source.size,
				compressed: true,
				encrypted: true,
				metadata: { type: "audio" },
			}),
			// The walk of runs gives the sound of the Ogg kind as it stands.
		};
		return { entries: [entry], metadata: { audio: "ogg", codec: "vorbis" } };
	},
	async openEntry(source: ByteSource) {
		const sound = await readMokoOgg(source);
		if (!sound) throw invalidSound("Not a Mokopro sound");
		return Readable.from([sound.ogg]);
	},
});
