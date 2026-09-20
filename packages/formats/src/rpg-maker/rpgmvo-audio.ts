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
} from "../shared/fixed-archive.js";
import { RPGMV_SIGNATURE, readRpgmvFile } from "./rpgmv-core.js";

const OGG_WORD = Buffer.from("OggS", "latin1");

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const rpgMakerRpgmvoAudioDescriptor: FormatDescriptor = {
	id: "rpg-maker-rpgmvo-audio",
	name: "RPG Maker engine audio format (Ogg/Vorbis)",
	extensions: ["rpgmvo", "ogg_"],
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
			source: "Experimental/RPGMaker/AudioRPGMV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rpgMakerRpgmvoAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rpgMakerRpgmvoAudioDescriptor,
	detection: { signatures: [{ bytes: RPGMV_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		try {
			const file = await readRpgmvFile(
				await readStored(source),
				sourcePath,
				OGG_WORD,
			);
			return file !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const file = await readRpgmvFile(
			await readStored(source),
			sourcePath,
			OGG_WORD,
		);
		if (!file) throw invalidSound("Not an RPG Maker sound");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "ogg"),
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata: { type: "audio" },
				}),
			],
			metadata: { audio: "ogg" },
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const file = await readRpgmvFile(
			await readStored(source),
			sourcePath,
			OGG_WORD,
		);
		if (!file) throw invalidSound("Not an RPG Maker sound");
		return Readable.from([file.body]);
	},
});
