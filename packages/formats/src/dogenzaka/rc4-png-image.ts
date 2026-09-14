// Format reference: GARbro "ArcFormats/Dogenzaka/ImageRSA.cs", class `Rc4PngFormat` (RC4 encrypted PNG).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Rc4 } from "@garbro-mcp/codecs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readPngHeaderFields } from "../shared/png.js";

/** The key the reference carries in its own source, hashed with SHA1 and cut to its first sixteen bytes. */
const KNOWN_KEY: Buffer = Buffer.from("Hlk9D28p", "latin1");
export const DOGENZAKA_PNG_RC4_KEY: Buffer = createHash("sha1")
	.update(KNOWN_KEY)
	.digest()
	.subarray(0, 16);
/** The PNG signature through the cipher: the word the reference registers. */
const SIGNATURE: Buffer = Buffer.from([0x1a, 0xf6, 0xf7, 0xc4]);
const EXTENSIONS = ["a"];
/** A portable network graphic's signature, the first chunk's own header and its thirteen header bytes. */
const HEADER_BYTES = 16 + 13;

async function readLayout(
	source: ByteSource,
): Promise<
	{ width: number; height: number; bitsPerPixel: number } | undefined
> {
	try {
		const size = Number(source.size);
		const stored = Buffer.from(
			await source.readAt(0n, Math.min(size, HEADER_BYTES)),
		);
		// The whole file belongs to the cipher, so the header is read out of the decrypted head. The reference
		// does the same through a decrypting stream and hands the result to its portable network graphic reader.
		return readPngHeaderFields(
			new Rc4(DOGENZAKA_PNG_RC4_KEY).transform(stored),
		);
	} catch {
		return undefined;
	}
}

export const dogenzakaRc4PngImageDescriptor: FormatDescriptor = {
	id: "dogenzaka-rc4-png-image",
	name: "RC4 encrypted PNG image",
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
			source: "ArcFormats/Dogenzaka/ImageRSA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dogenzakaRc4PngImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dogenzakaRc4PngImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid RC4 encrypted PNG image",
			);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
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
				image: "png",
				compression: "rc4",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The cipher covers the whole stream, so a fresh instance transforms it from its first byte.
		return Readable.from([new Rc4(DOGENZAKA_PNG_RC4_KEY).transform(file)]);
	},
});
