// Format reference: GARbro "ArcFormats/BeF/ImageALO.cs", class `AloFormat` (a bitmap whose `BM` marker has
// been replaced with two zero bytes). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The marker the obfuscation overwrites. */
const BMP_MARKER = Buffer.from([0x42, 0x4d]);
/** The region that is zeroed, which is exactly the marker. */
const ZEROED_SIZE = 2;

interface AloLayout {
	bmp: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `ReadMetaData` gates on the extension and then requires the first two bytes to be zero — which is what the
 * obfuscation leaves behind where a bitmap would have `BM`. The reference rebuilds the marker by prefixing two
 * bytes and parsing the result, so every other offset in the file keeps its position, including the size field
 * that the bitmap check reads.
 */
async function readLayout(source: ByteSource): Promise<AloLayout | undefined> {
	if (source.size < BigInt(ZEROED_SIZE + 4)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (stored[0] !== 0 || stored[1] !== 0) return undefined;
		const rebuilt = Buffer.concat([BMP_MARKER, stored.subarray(ZEROED_SIZE)]);
		const meta = readBmpMetaData(rebuilt);
		if (!meta) return undefined;
		// The reference would build an empty image; nothing can be drawn from one.
		if (meta.width === 0 || meta.height === 0) return undefined;
		return {
			bmp: rebuilt.subarray(0, meta.fileSize),
			width: meta.width,
			height: meta.height,
			bitsPerPixel: meta.bitsPerPixel,
		};
	} catch {
		return undefined;
	}
}

export const aloImageDescriptor: FormatDescriptor = {
	id: "bef-alo-image",
	name: "Obfuscated bitmap",
	extensions: ["alo"],
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
			source: "ArcFormats/BeF/ImageALO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aloImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aloImageDescriptor,
	// The reference declares no signature and gates on the `.alo` extension.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "alo") return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid obfuscated bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The stored file is missing its marker and the output is a bitmap.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				encrypted: true,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid obfuscated bitmap");
		return Readable.from([layout.bmp]);
	},
});
