// Format reference: GARbro "Legacy/Yaneurao/ImageGTO.cs", class `GtoFormat` (Yaneurao obfuscated bitmap) and
// the `SubFilterStream` it filters the whole file with.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpHeaderFields } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `NY`, which is what a bitmap's `BM` becomes once the key is taken off every byte. */
const MARKER: Buffer = Buffer.from("NY", "latin1");
/** The reference builds its `SubFilterStream` with this key. */
const FILTER_KEY = 0x0c;
/** A bitmap's file header plus the shortest DIB header the shared reader accepts. */
const BMP_MINIMUM_SIZE = 54;

/** Takes the key off every byte, which is what `SubFilterStream` does as the reader pulls from it. */
function removeKey(file: Buffer): Buffer {
	const plain: Buffer = Buffer.alloc(file.length, 0x00);
	for (let index = 0; index < file.length; index += 1) {
		plain[index] = ((file[index] ?? 0) - FILTER_KEY) & 0xff;
	}
	return plain;
}

async function readDecoded(
	source: ByteSource,
	length: number,
	whole: boolean,
): Promise<Buffer | undefined> {
	try {
		const size = whole
			? Number(source.size)
			: Math.min(length, Number(source.size));
		const head = Buffer.from(await source.readAt(0n, size));
		return removeKey(head);
	} catch {
		return undefined;
	}
}

export const yaneuraoGtoImageDescriptor: FormatDescriptor = {
	id: "yaneurao-gto-image",
	name: "Yaneurao obfuscated bitmap",
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
			source: "Legacy/Yaneurao/ImageGTO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const yaneuraoGtoImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yaneuraoGtoImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		// The reference checks the two marker bytes first and only then asks the bitmap reader.
		if (source.size < 2n) return false;
		const plain = await readDecoded(source, BMP_MINIMUM_SIZE, false);
		if (!plain) return false;
		// Only the header is available here, so the bitmap's own size word is not compared with anything:
		// the reference clamps a size larger than the file rather than refusing it.
		return readBmpHeaderFields(plain) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const plain = await readDecoded(source, BMP_MINIMUM_SIZE, false);
		const fields = plain ? readBmpHeaderFields(plain) : undefined;
		if (!fields)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Yaneurao bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				// The filter keeps the length, so the whole file is the entry.
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
				image: "bmp",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if (source.size >= BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new GarbroError("INVALID_ARCHIVE", "Yaneurao bitmap is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const plain = removeKey(file);
		if (!readBmpHeaderFields(plain)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Yaneurao bitmap");
		}
		// The reference decodes the bitmap; the port hands the decoded original over, padding and all.
		return Readable.from([plain]);
	},
});
