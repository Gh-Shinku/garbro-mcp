// Format reference: GARbro "Experimental/RPGMaker/ImageRPGMV.cs", class `RpgmvpFormat` (a picture of the RPG
// Maker engine of the kind that stands behind the words of the engine and the places of a key, which stand as
// the words of a portable network graphic). GARbro commit
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
} from "../shared/fixed-archive.js";
import { readPngHeaderFields } from "../shared/png.js";
import { RPGMV_SIGNATURE, readRpgmvFile } from "./rpgmv-core.js";

/** The words a picture of this kind stands for. */
const PNG_WORD = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const rpgMakerRpgmvpImageDescriptor: FormatDescriptor = {
	id: "rpg-maker-rpgmvp-image",
	name: "RPG Maker engine image format (PNG)",
	extensions: ["rpgmvp", "png_"],
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
			source: "Experimental/RPGMaker/ImageRPGMV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rpgMakerRpgmvpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rpgMakerRpgmvpImageDescriptor,
	detection: { signatures: [{ bytes: RPGMV_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		try {
			const file = await readRpgmvFile(
				await readStored(source),
				sourcePath,
				PNG_WORD,
			);
			if (!file) return false;
			return readPngHeaderFields(file.body) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const file = await readRpgmvFile(
			await readStored(source),
			sourcePath,
			PNG_WORD,
		);
		if (!file) throw invalidPicture("Not an RPG Maker picture");
		const head = readPngHeaderFields(file.body);
		if (!head) throw invalidPicture("Not an RPG Maker picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "png"),
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata: {
						type: "image",
						width: head.width,
						height: head.height,
						bitsPerPixel: head.bitsPerPixel,
					},
				}),
			],
			metadata: {
				image: "png",
				width: head.width,
				height: head.height,
				bitsPerPixel: head.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const file = await readRpgmvFile(
			await readStored(source),
			sourcePath,
			PNG_WORD,
		);
		if (!file) throw invalidPicture("Not an RPG Maker picture");
		// What stands behind the head of the file stands as the words of a portable network graphic, which are
		// handed out as they stand.
		return Readable.from([file.body]);
	},
});
