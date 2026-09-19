// Format reference: GARbro "ArcFormats/MokoPro/CompressedFile.cs", classes `NNNNBmpFormat`, `NNNNMetaData`
// and `MokoCrypt` (a Mokopro picture: the container of this engine whose walk of runs gives a bitmap as it
// stands). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { MOKO_SIGNATURE, readMokoHeader, unpackMoko } from "./moko-core.js";

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** What the walk of runs of a picture of this engine gives, where it gives a bitmap at all. */
async function readMokoBitmap(
	source: ByteSource,
): Promise<{ bmp: Buffer; unpackedSize: number } | undefined> {
	const unpackedSize = await readMokoHeader(source);
	if (unpackedSize === undefined) return undefined;
	const bmp = unpackMoko(await readStored(source), unpackedSize);
	return readBmpMetaData(bmp) ? { bmp, unpackedSize } : undefined;
}

export const mokoProBmpImageDescriptor: FormatDescriptor = {
	id: "mokopro-bmp-image",
	name: "Mokopro compressed bitmap",
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

export const mokoProBmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mokoProBmpImageDescriptor,
	// The reference registers the word `NNNN`, which the archive shape of the container registers as well;
	// the priority puts the picture and the sound ahead of the archive wherever no name says otherwise.
	detection: { signatures: [{ bytes: MOKO_SIGNATURE }], priority: 10 },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readMokoBitmap(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const picture = await readMokoBitmap(source);
		if (!picture) throw invalidPicture("Not a Mokopro bitmap");
		const info = readBmpMetaData(picture.bmp);
		if (!info) throw invalidPicture("Not a Mokopro bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: BigInt(picture.unpackedSize),
				packedSize: source.size,
				compressed: true,
				encrypted: true,
				metadata: {
					type: "image",
					width: info.width,
					height: info.height,
					bitsPerPixel: info.bitsPerPixel,
				},
			}),
			// The walk of runs gives the bitmap as it stands.
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: info.bitsPerPixel },
		};
	},
	async openEntry(source: ByteSource) {
		const picture = await readMokoBitmap(source);
		if (!picture) throw invalidPicture("Not a Mokopro bitmap");
		return Readable.from([picture.bmp]);
	},
});
