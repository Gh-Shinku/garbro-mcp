// Format reference: GARbro "ArcFormats/BlueGale/ImageBBM.cs", class `BbmFormat` (a bitmap whose leading bytes
// are masked with 0xFF). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The mask the leading bytes are stored under. */
const XOR_KEY = 0xff;
/** `ReadMetaData` works from a thirty two byte copy, which unmasked is a bitmap header up to the depth. */
const META_SIZE = 0x20;
/** `Read` unmasks a hundred bytes and leaves everything past them as it stands. */
const UNMASK_SIZE = 100;
/**
 * The reference checks this word while the bytes are still masked. Exclusive ored with `0xFF`, the bitmap's
 * `BM` marker (`0x42 0x4D`) becomes `0xBD 0xB2`, which is this value as a little-endian word — the check is a
 * marker check in disguise.
 */
const MASKED_MARKER = 0xb2bd;
/** The second masked check: the bitmap's two reserved bytes are zero, so they mask to all ones. */
const MASKED_RESERVED = 0xffffffff;
const DIB_HEADER_SIZE = 0x28;

function unmask(input: Buffer, length: number): Buffer {
	const output = Buffer.from(input.subarray(0, length));
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ XOR_KEY;
	return output;
}

interface BbmLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `ReadMetaData` reads thirty two bytes, checks two of them while they are still masked, unmasks the copy and
 * checks the size of the header that follows.
 */
async function readLayout(source: ByteSource): Promise<BbmLayout | undefined> {
	if (source.size < BigInt(META_SIZE)) return undefined;
	try {
		const raw = Buffer.from(await source.readAt(0n, META_SIZE));
		if (raw.readUInt16LE(0) !== MASKED_MARKER) return undefined;
		if (raw.readUInt32LE(6) !== MASKED_RESERVED) return undefined;
		const header = unmask(raw, META_SIZE);
		if (header.readInt32LE(0x0e) !== DIB_HEADER_SIZE) return undefined;
		const width = header.readUInt16LE(0x12);
		const height = header.readUInt16LE(0x16);
		// The reference would build an empty image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return {
			width,
			height,
			bitsPerPixel: header.readUInt16LE(0x1c),
		};
	} catch {
		return undefined;
	}
}

/**
 * `Read` unmasks the first hundred bytes and prefixes them to the rest of the file, so only that prefix is
 * obfuscated. For an eight bit image the palette starts past the end of the prefix and therefore stays masked,
 * which the reference passes straight through to the decoder; the port does the same and a test pins it.
 */
async function readBitmap(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(UNMASK_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const head = unmask(stored, UNMASK_SIZE);
		const bmp = Buffer.concat([head, stored.subarray(UNMASK_SIZE)]);
		const meta = readBmpMetaData(bmp);
		if (!meta) return undefined;
		return bmp.subarray(0, meta.fileSize);
	} catch {
		return undefined;
	}
}

export const bbmImageDescriptor: FormatDescriptor = {
	id: "blue-gale-bbm-image",
	name: "BlueGale obfuscated bitmap",
	extensions: ["bbm"],
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
			source: "ArcFormats/BlueGale/ImageBBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bbmImageDescriptor,
	// The reference declares no signature and no extension gate; the masked marker is the only way in.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BlueGale BBM image");
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
			// The leading bytes are masked and the output is a bitmap.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				encrypted: true,
				unmaskSize: UNMASK_SIZE,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const bmp = await readBitmap(source);
		if (!bmp)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BlueGale BBM image");
		return Readable.from([bmp]);
	},
});
