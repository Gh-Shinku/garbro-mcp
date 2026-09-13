// Format reference: GARbro "ArcFormats/SysD/ImageDBM.cs", class `DbmFormat` (SYSD engine bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `'DM'`, with a third byte the reference registers three times over: zero, one and four. */
const MARKER = Buffer.from([0x44, 0x4d]);
const VERSIONS = [0x00, 0x01, 0x04];
const SIGNATURES = VERSIONS.map((version) =>
	Buffer.from([0x44, 0x4d, version]),
);
const HEADER_SIZE = 0x18;
/** The size word, which has to account for the whole file. */
const FILE_SIZE_OFFSET = 4;
const WIDTH_OFFSET = 0x0a;
const HEIGHT_OFFSET = 0x0c;
/** The flag byte, the unused packed size and the size the pixels should come to. */
const PACKED_FLAG_OFFSET = 0x18;
const UNPACKED_SIZE_OFFSET = 0x1d;
const DATA_OFFSET = 0x21;
/** Twenty four bits a pixel, always, and the reference computes its stride without padding. */
const BITMAP_STRIDE_DIVISOR = 3;
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface DbmLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` reads twenty four bytes and checks one thing: the word at offset four has to be the length of
 * the whole file. That check is what the three registered signatures do not do, and it is why the format is
 * safe without one — a file that says how long it is at offset four and then disagrees is refused at metadata
 * time rather than at extraction.
 */
async function readFields(source: ByteSource): Promise<DbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		// The dispatcher gates on the three signatures; a direct call does not, so the marker and the
		// version byte are both checked here.
		if (!head.subarray(0, MARKER.length).equals(MARKER)) return undefined;
		if (!VERSIONS.includes(head[2] ?? -1)) return undefined;
		if (BigInt(head.readUInt32LE(FILE_SIZE_OFFSET)) !== source.size)
			return undefined;
		const width = head.readUInt16LE(WIDTH_OFFSET);
		const height = head.readUInt16LE(HEIGHT_OFFSET);
		if (width * height * BITMAP_STRIDE_DIVISOR > MAX_PIXEL_BYTES)
			return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const dbmImageDescriptor: FormatDescriptor = {
	id: "sysd-dbm-image",
	name: "SYSD engine bitmap",
	extensions: [],
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
			source: "ArcFormats/SysD/ImageDBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dbmImageDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SYSD DBM bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 24,
				} as Record<string, unknown>,
			}),
			// The extraction is a bitmap, so it has a header the stored data does not.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SYSD DBM bitmap");
		if (source.size < BigInt(DATA_OFFSET))
			throw new GarbroError("INVALID_ARCHIVE", "Truncated SYSD DBM bitmap");
		const head = Buffer.from(await source.readAt(0n, DATA_OFFSET));
		const stored = Buffer.from(
			await source.readAt(
				BigInt(DATA_OFFSET),
				Number(source.size) - DATA_OFFSET,
			),
		);
		const unpackedSize = head.readInt32LE(UNPACKED_SIZE_OFFSET);
		if (unpackedSize < 0 || unpackedSize > MAX_PIXEL_BYTES)
			throw new GarbroError("INVALID_ARCHIVE", "Unusable SYSD DBM pixel size");
		const pixels: Buffer = Buffer.alloc(unpackedSize, 0x00);
		if ((head[PACKED_FLAG_OFFSET] ?? 0) !== 0) {
			// A stock `LzssStream` with its default frame, and a short stream is tolerated: the reference
			// reads into a buffer it allocated, so whatever the codec does not produce stays transparent.
			const decoded = inflateLzss(stored, { outputLength: unpackedSize });
			decoded.copy(pixels, 0, 0, Math.min(decoded.length, unpackedSize));
		} else {
			stored.copy(pixels, 0, 0, Math.min(stored.length, unpackedSize));
		}
		// `CreateFlipped` with a stride of three bytes a pixel: the data is bottom up, which a bitmap records
		// as a positive height, and the rows are tight. The writer pads them, which is the whole difference
		// between the stored layout and a bitmap's.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
