// Format reference: GARbro "ArcFormats/Lilim/ImageIMG.cs", classes `BaseImgFormat` and `ImgPngFormat`
// (Lilim obfuscated image).
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
import { PNG_SIGNATURE, readPngHeaderFields } from "../shared/png.js";
import { deobfuscateLilim } from "./img-bmp-image.js";

/** Eight bytes of signature, the chunk's own length and type, then the thirteen byte header. */
const PNG_MINIMUM_SIZE = 16 + 13;

export const imgPngImageDescriptor: FormatDescriptor = {
	id: "lilim-img-png-image",
	name: "Lilim obfuscated image",
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
			source: "ArcFormats/Lilim/ImageIMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readFields(source: ByteSource) {
	if (source.size < BigInt(PNG_MINIMUM_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, PNG_MINIMUM_SIZE));
		// The whole header lies inside the obfuscated prefix, so deobfuscating it is enough to read the fields.
		return readPngHeaderFields(deobfuscateLilim(head));
	} catch {
		return undefined;
	}
}

export const imgPngImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: imgPngImageDescriptor,
	// The stored bytes are the graphic's own signature xored, which the Regrips graphic stores as well.
	detection: {
		signatures: [{ bytes: PNG_SIGNATURE.subarray(0, 4).map((x) => x ^ 0xff) }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const fields = await readFields(source);
		if (!fields)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Lilim image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: fields.width,
					height: fields.height,
					bitsPerPixel: fields.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if (source.size >= BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new GarbroError("INVALID_ARCHIVE", "Lilim image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const plain = deobfuscateLilim(file);
		if (!readPngHeaderFields(plain)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Lilim image");
		}
		// The reference decodes the graphic; the port hands the deobfuscated original over, which is a graphic
		// again and keeps every chunk.
		return Readable.from([plain]);
	},
});
