// Format reference: GARbro "Legacy/Uran/ImageNCL.cs", classes `NclFormat` and `NclMetaData` (Uran
// multi-frame image). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, writeBmpImage } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The stored path of the bitmap, the word before the header that holds the file offset of its data. */
const NAME_OFFSET = 10;
const SIZE_FIELD = 0;
const NAME_LENGTH_FIELD = 8;
const MAXIMUM_NAME_LENGTH = 0x100;
/** Six bytes after the name, then the header of the packed data. */
const GAP_SIZE = 6;
/** Measured from the end of the stored path: the header's size, its width and its height. */
const EMBEDDED_SIZE_FIELD = GAP_SIZE - 2;
const EMBEDDED_WIDTH_FIELD = GAP_SIZE + 1;
const EMBEDDED_HEIGHT_FIELD = GAP_SIZE + 5;
/** The reference reads nine bytes more than the offset of the embedded header. */
const EMBEDDED_HEADER_LENGTH = 9;
const MINIMUM_EMBEDDED_HEADER = 9;
const MAXIMUM_EMBEDDED_HEADER = 0x40;
/** Every byte of the packed data has this taken off it before it means anything. */
const SUBTRACTED_KEY = 10;
/** The one byte in front of the packed data that says whether it is a deflate stream. */
const DEFLATE_METHOD = 2;
const MAXIMUM_BITMAP_BYTES = 256 * 1024 * 1024;

interface NclLayout {
	width: number;
	height: number;
	dataOffset: number;
	dataSize: number;
}

/**
 * The header of a Uran image: a stored path, a gap, then the header of the packed data, which carries the
 * measurement of the picture and the size of whatever the data before it holds. The reference checks each
 * of these and dives into the data only afterwards.
 */
async function readNclLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<NclLayout | undefined> {
	if ("ncl" !== sourceExtension(sourcePath)) return undefined;
	const total = Number(source.size);
	if (total < NAME_OFFSET + 2) return undefined;
	const head = Buffer.from(await source.readAt(0n, Math.min(total, 0x10)));
	const size = head.readInt32LE(SIZE_FIELD);
	const nameLength = head.readUInt16LE(NAME_LENGTH_FIELD);
	if (size <= 1 || nameLength === 0 || nameLength > MAXIMUM_NAME_LENGTH)
		return undefined;
	const nameEnd = NAME_OFFSET + nameLength;
	const pos = nameEnd + GAP_SIZE;
	const needed = pos + EMBEDDED_HEADER_LENGTH;
	if (needed > total) return undefined;
	const header = Buffer.from(await source.readAt(0n, needed));
	const name = header
		.subarray(NAME_OFFSET, NAME_OFFSET + nameLength)
		.toString("latin1")
		.replace(/\0.*$/s, "");
	if (!name.toLowerCase().endsWith(".bmp")) return undefined;
	const embeddedSize = header.readUInt16LE(nameEnd + EMBEDDED_SIZE_FIELD);
	if (
		embeddedSize < MINIMUM_EMBEDDED_HEADER ||
		embeddedSize > MAXIMUM_EMBEDDED_HEADER ||
		pos + embeddedSize + size > total
	) {
		return undefined;
	}
	return {
		width: header.readUInt32LE(nameEnd + EMBEDDED_WIDTH_FIELD),
		height: header.readUInt32LE(nameEnd + EMBEDDED_HEIGHT_FIELD),
		dataOffset: pos + embeddedSize,
		dataSize: size,
	};
}

/** The bitmap the packed data holds, decrypted and, when it says so, decompressed. */
async function renderNclImage(
	source: ByteSource,
	sourcePath: string,
): Promise<Buffer> {
	const layout = await readNclLayout(source, sourcePath);
	if (!layout) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Uran NCL image");
	}
	const stored = Buffer.from(
		await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
	);
	// The reference wraps the data in a stream that takes ten off every byte it hands out.
	const plain: Buffer = Buffer.alloc(stored.length);
	for (let i = 0; i < stored.length; i += 1) {
		plain[i] = ((stored[i] ?? 0) - SUBTRACTED_KEY) & 0xff;
	}
	if (0 === plain.length) {
		throw new GarbroError("INVALID_ARCHIVE", "Uran NCL image has no data");
	}
	// Whatever the method byte says, the bitmap starts behind it.
	const body = plain.subarray(1);
	let bitmap: Buffer;
	if (DEFLATE_METHOD === (plain[0] ?? 0)) {
		try {
			bitmap = await inflateZlibBufferCapped(body, MAXIMUM_BITMAP_BYTES);
		} catch {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Uran NCL image holds no deflate stream",
			);
		}
	} else {
		bitmap = Buffer.from(body);
	}
	const image = readBmpImage(bitmap);
	if (!image) {
		throw new GarbroError("INVALID_ARCHIVE", "Uran NCL image holds no bitmap");
	}
	return writeBmpImage(image);
}

export const uranNclImageDescriptor: FormatDescriptor = {
	id: "uran-ncl-image",
	name: "Uran multi-frame image",
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
			source: "Legacy/Uran/ImageNCL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const uranNclImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: uranNclImageDescriptor,
	// A single zero signature is what the reference registers, which offers the format every file it is tried
	// on; the extension check inside the reader is what actually decides.
	detection: { signatures: [], extensionFallback: true },
	// The reference registers a single zero signature, which offers the format every file it is tried on; the
	// extension check is the only thing that decides, so it lives in the reader.
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readNclLayout(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readNclLayout(source, sourcePath);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Uran NCL image");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
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
							bitsPerPixel: 8,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "deflate",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		return Readable.from([await renderNclImage(source, sourcePath)]);
	},
});
