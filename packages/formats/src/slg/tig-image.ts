// Format reference: GARbro "ArcFormats/Slg/ImageTIG.cs", class `TigFormat` (SLG system encrypted PNG image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsvcRandom } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readPngHeaderFields } from "../shared/png.js";

/** The word the reference registers: the graphic's signature through the cipher. */
const SIGNATURE: Buffer = Buffer.from([0x8b, 0xc2, 0xf3, 0x7c]);
const EXTENSIONS: string[] = [];
/** The seed the reference's transform starts from when a caller names none. */
const DEFAULT_KEY = 0x7f7f7f7f;
/** A portable network graphic's signature, the first chunk's own header and its thirteen header bytes. */
const HEADER_BYTES = 16 + 13;

/**
 * The stream the reference reads through its `TigTransform`: every byte has the low byte of one draw of the
 * Microsoft C runtime's generator subtracted from it, and the generator starts at the file's first byte.
 */
export function decryptTig(data: Buffer, key: number = DEFAULT_KEY): Buffer {
	const random = new MsvcRandom(key);
	for (let index = 0; index < data.length; index += 1) {
		data[index] = ((data[index] ?? 0) - (random.next() & 0xff)) & 0xff;
	}
	return data;
}

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
		// The reference reads the whole stream through the cipher and hands it to its graphic reader, so the
		// measurements come from the decrypted head.
		return readPngHeaderFields(decryptTig(stored));
	} catch {
		return undefined;
	}
}

export const slgTigImageDescriptor: FormatDescriptor = {
	id: "slg-tig-image",
	name: "SLG system encrypted PNG image",
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

export const slgTigImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: slgTigImageDescriptor,
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
				compression: "slg-tig",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// One generator from the first byte covers the whole stream.
		return Readable.from([decryptTig(file)]);
	},
});
