// Format reference: GARbro "ArcFormats/ImageMB.cs", class `MbImageFormat` (tag `BMP/MB`, a bitmap whose
// first two bytes are replaced by a two letter tag). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The two letter tags the reference accepts in place of the bitmap's own `BM` marker. */
const PREFIXES = ["MB", "MC", "MK", "CL", "XX"];
const SIGNATURE_LENGTH = 2;

interface ObfuscatedLayout {
	prefix: string;
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The bitmap's own length, which the reconstruction preserves as the stored length. */
	fileSize: number;
}

/**
 * `MbImageFormat.OpenAsBitmap`: the reference drops the first two bytes and prepends `BM`, so a stored
 * file is a bitmap with its marker replaced by a tag. The transformation preserves the length.
 */
export async function openAsBitmap(
	source: ByteSource,
): Promise<Buffer | undefined> {
	try {
		const bitmap = Buffer.from(await source.readAt(0n, Number(source.size)));
		bitmap.write("BM", 0, "latin1");
		return bitmap;
	} catch {
		return undefined;
	}
}

/**
 * Reads the reconstructed bitmap and reports the tag that was replaced. The shared bitmap reader applies
 * the same checks GARbro's metadata reader does.
 */
async function readLayout(
	source: ByteSource,
	accepted: string[],
): Promise<ObfuscatedLayout | undefined> {
	if (source.size < BigInt(SIGNATURE_LENGTH)) return undefined;
	try {
		const prefix = Buffer.from(
			await source.readAt(0n, SIGNATURE_LENGTH),
		).toString("latin1");
		if (!accepted.includes(prefix)) return undefined;
		const bitmap = await openAsBitmap(source);
		if (!bitmap) return undefined;
		const meta = readBmpMetaData(bitmap);
		if (!meta) return undefined;
		return { prefix, ...meta };
	} catch {
		return undefined;
	}
}

export const mbImageDescriptor: FormatDescriptor = {
	id: "bmp-mb-image",
	name: "Obfuscated bitmap",
	extensions: ["bmp", "gra", "xxx"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/ImageMB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Builds the descriptor for one of the two letter tags derived from this base class. */
export function obfuscatedBitmapFormat(options: {
	descriptor: FormatDescriptor;
	prefixes: string[];
}): ArchiveFormat {
	return defineFixedArchive({
		descriptor: options.descriptor,
		// No signature: the two byte tag, which is not the bitmap marker, is the whole detection.
		detection: { signatures: [] },
		async detect(source: ByteSource): Promise<boolean> {
			return (await readLayout(source, options.prefixes)) !== undefined;
		},
		async read(source: ByteSource, sourcePath: string) {
			const layout = await readLayout(source, options.prefixes);
			if (!layout)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`Invalid ${options.descriptor.name}`,
				);
			const fileName = sourcePath.replace(/^.*[/\\]/, "");
			const entry: FixedEntry = {
				...createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: 0n,
					size: source.size,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
					} as Record<string, unknown>,
				}),
				// Only the first two bytes differ between the stored file and the bitmap.
				sizeKnown: true,
			};
			return {
				entries: [entry],
				metadata: {
					image: "bmp",
					storedTag: layout.prefix,
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			};
		},
		async openEntry(source: ByteSource) {
			const layout = await readLayout(source, options.prefixes);
			if (!layout)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`Invalid ${options.descriptor.name}`,
				);
			const bitmap = await openAsBitmap(source);
			if (!bitmap)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`Invalid ${options.descriptor.name}`,
				);
			// Only the marker is rewritten, so the bitmap needs no re-encoding.
			return Readable.from([bitmap]);
		},
	});
}

export const mbImageFormat: ArchiveFormat = obfuscatedBitmapFormat({
	descriptor: mbImageDescriptor,
	prefixes: PREFIXES,
});
