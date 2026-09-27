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
import { writeBmpImage } from "../shared/bmp.js";
import { readPngImage } from "../shared/png-image.js";

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
		// `RpgmvpFormat.Read` stands of `Png.Read` over what the places behind the head of the file stand for,
		// so the graphic stands read of the walk of the portable network graphic of this project and handed
		// over as a bitmap of its own.
		const image = await readPngImage(file.body);
		if (!image) throw invalidPicture("Not an RPG Maker picture");
		// The walk of the graphic hands no list of colours over, and a bitmap of a whole count of places of a
		// colour holds none: the list stands empty, as the shared walks of this project hand it.
		return Readable.from([
			writeBmpImage({
				width: image.width,
				height: image.height,
				bitsPerPixel: image.bitsPerPixel,
				pixels: image.pixels,
				palette: Buffer.alloc(0),
			}),
		]);
	},
});
