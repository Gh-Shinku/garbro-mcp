// Format reference: GARbro "ArcFormats/Ikura/ImageGGA.cs", class `GgaFormat` (D.O. compressed image).
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
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The header: two signed offsets, two dimensions and the unpacked size. */
const HEADER_SIZE = 12;
/** `Signature` is zero in the reference and the extension is the only tag, so it is checked here. */
const REQUIRED_EXTENSION = "gga";
const MAX_DIMENSION = 0x7fff;
/** The reference allocates the unpacked size, so the port refuses a wildly larger request than it will use. */
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface GgaLayout {
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	unpackedSize: number;
}

/**
 * `ReadMetaData` has no signature to look at — `Signature` is zero and the registration carries no extension —
 * so the format gates entirely on the file extension and on the header being self-consistent: the unpacked size
 * has to be exactly three bytes a pixel. The reference compares that product as a signed integer, so the port
 * wraps the multiplication the same way and accepts whatever the reference would accept, including the
 * impossible negative size produced when the product overflows.
 */
async function readFields(source: ByteSource): Promise<GgaLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const offsetX = head.readInt16LE(0);
		const offsetY = head.readInt16LE(2);
		const width = head.readUInt16LE(4);
		const height = head.readUInt16LE(6);
		const unpackedSize = head.readInt32LE(8);
		if (width === 0 || height === 0) return undefined;
		if (width > MAX_DIMENSION || height > MAX_DIMENSION) return undefined;
		if (offsetX < 0 || offsetY < 0) return undefined;
		// Signed arithmetic, exactly as the reference's `int` multiply behaves on overflow.
		if (((3 * width * height) | 0) !== unpackedSize) return undefined;
		return { offsetX, offsetY, width, height, unpackedSize };
	} catch {
		return undefined;
	}
}

/** The extension gate belongs to detection, not to the field reader, so `readFields` stays reusable. */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<GgaLayout | undefined> {
	if (sourceExtension(sourcePath) !== REQUIRED_EXTENSION) return undefined;
	return readFields(source);
}

export const ggaImageDescriptor: FormatDescriptor = {
	id: "ikura-gga-image",
	name: "D.O. compressed image",
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
			source: "ArcFormats/Ikura/ImageGGA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ggaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ggaImageDescriptor,
	// The reference declares no signature, so the port registers none and is a candidate for every file; the
	// extension check in the layout reader is what keeps that cheap.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ikura GGA image");
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
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
					bitsPerPixel: 24,
				} as Record<string, unknown>,
			}),
			// The extraction is decompressed, so its length is not the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ikura GGA image");
		if (layout.unpackedSize <= 0 || layout.unpackedSize > MAX_PIXEL_BYTES)
			throw new GarbroError("INVALID_ARCHIVE", "Unusable Ikura GGA image size");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		// The reference decompresses with a stock `LzssStream` — a frame of 0x1000 bytes filled with zero and a
		// write position of 0xFEE — and insists on getting exactly the size the header announced.
		const pixels = inflateLzss(stored, { outputLength: layout.unpackedSize });
		if (pixels.length !== layout.unpackedSize)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Ikura GGA image");
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, false),
		]);
	},
});
