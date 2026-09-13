// Format reference: GARbro "ArcFormats/Palette/ImagePGA.cs", class `PgaFormat extends PngFormat` (a PNG whose
// first eleven bytes were rewritten). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** `PGAP`. */
const SIGNATURE = Buffer.from("PGAP", "ascii");
/** The eight byte PNG signature the obfuscation replaced. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** The key the eight bytes after the three byte tag are exclusive orred with. */
const KEY = Buffer.from("PGAECODE", "ascii");
/** Three tag bytes and the eight obfuscated bytes; the image body follows unmodified. */
const PREFIX_SIZE = 11;
const TAG_SIZE = 3;
/** A PNG header as far as the colour type of the first chunk. */
const HEADER_SIZE = 26;
/** What the prefix of the image is: the signature and the eight restored bytes. */
const PNG_HEADER_SIZE = 16;
const IHDR_LENGTH = 13;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface PgaLayout {
	width: number;
	height: number;
	bitsPerPixel?: number;
}

/** Restores the first sixteen bytes of the PNG: the signature, then eight bytes from the key. */
function restore(prefix: Buffer): Buffer {
	const restored: Buffer = Buffer.alloc(prefix.length);
	PNG_SIGNATURE.copy(restored, 0);
	for (let i = 0; i < KEY.length; i += 1)
		restored[8 + i] = (prefix[TAG_SIZE + i] ?? 0) ^ (KEY[i] ?? 0);
	prefix.copy(restored, 16, PREFIX_SIZE);
	return restored;
}

/**
 * The reference reads eleven bytes into positions five to fifteen of a sixteen byte buffer, overwrites the first
 * eight of those with the PNG signature and exclusive orrs the last eight with the key. The three tag bytes it
 * read are discarded — they exist only so that the file's own signature check has something to match — and the
 * image body continues at offset eleven unmodified.
 *
 * The tag is `PGAP` rather than `PGA` because the byte after it is the first byte of the `IHDR` chunk length
 * exclusive orred with `P`, and that length's top byte is zero. A test checks the fourth byte is `P` for a
 * fixture built the way the reference's writer builds one.
 */
async function readLayout(source: ByteSource): Promise<PgaLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const restored = restore(head);
		if (restored.readUInt32BE(8) !== IHDR_LENGTH) return undefined;
		if (restored.subarray(12, 16).toString("latin1") !== "IHDR")
			return undefined;
		const width = restored.readUInt32BE(16);
		const height = restored.readUInt32BE(20);
		// A PNG decoder would reject these; nothing can be drawn from them.
		if (width === 0 || height === 0) return undefined;
		const channels = CHANNELS[restored[25] ?? -1];
		const layout: PgaLayout = { width, height };
		if (channels !== undefined)
			layout.bitsPerPixel = (restored[24] ?? 0) * channels;
		return layout;
	} catch {
		return undefined;
	}
}

export const pgaImageDescriptor: FormatDescriptor = {
	id: "palette-pga-image",
	name: "Palette obfuscated PNG image",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		// The reference can write, but only by encoding a PNG first.
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Palette/ImagePGA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pgaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pgaImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Palette PGA image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					...(layout.bitsPerPixel === undefined
						? {}
						: { bitsPerPixel: layout.bitsPerPixel }),
				} as Record<string, unknown>,
			}),
			// Eleven stored bytes become the sixteen byte PNG header, so the extraction is longer than the
			// source.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				width: layout.width,
				height: layout.height,
				obfuscation: KEY.toString("latin1"),
				prefixSize: PREFIX_SIZE,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if ((await readLayout(source)) === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Palette PGA image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The header as the reference assembles it, then the body from offset eleven untouched.
		const header = restore(stored.subarray(0, PNG_HEADER_SIZE));
		return Readable.from([
			Buffer.concat([header, stored.subarray(PREFIX_SIZE)]),
		]);
	},
});
