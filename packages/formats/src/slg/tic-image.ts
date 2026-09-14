// Format reference: GARbro "ArcFormats/Slg/ImageTIG.cs", class `TicFormat` (SLG system encrypted JPEG image).
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
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { decryptTig } from "./tig-image.js";

/** The word the reference registers for this sibling: the graphic's signature through the same scramble. */
const SIGNATURE: Buffer = Buffer.from([0x01, 0x4a, 0xa4, 0x15]);
const EXTENSIONS: string[] = [];

async function readLayout(
	source: ByteSource,
): Promise<
	{ width: number; height: number; bitsPerPixel: number } | undefined
> {
	try {
		// The reference reads through a seekable decrypting stream, and its graphic reader seeks across the
		// segments, so the whole file is decrypted before the header is read.
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		return readJpegHeaderFields(decryptTig(file));
	} catch {
		return undefined;
	}
}

export const slgTicImageDescriptor: FormatDescriptor = {
	id: "slg-tic-image",
	name: "SLG system encrypted JPEG image",
	extensions: EXTENSIONS,
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
			source: "ArcFormats/Slg/ImageTIG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const slgTicImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: slgTicImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SLG encrypted image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "jpg"),
				offset: 0n,
				size: source.size,
				// The stored bytes are encrypted, so what the entry returns is not what it holds.
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "jpeg",
				compression: "slg-tig",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		return Readable.from([decryptTig(file)]);
	},
});
