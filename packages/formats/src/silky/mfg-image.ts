// Format reference: GARbro "ArcFormats/Silky/ImageMFG.cs", class `MfgFormat` (Silky's RGB image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `MFG_`, `MFGA` and `MFGC`, the reference's words 0x5F47464D, 0x4147464D and 0x4347464D. */
const MARKERS: Buffer[] = ["MFG_", "MFGA", "MFGC"].map((marker) =>
	Buffer.from(marker, "latin1"),
);
/** The marker's last byte doubles as the flavour, and `_` is the one without per-row palettes. */
const PLAIN_TYPE = 0x5f;
const HEADER_SIZE = 0x14;
/** Each palette row block is a count followed by that many eight byte entries. */
const PALETTE_ENTRY_SIZE = 8;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface MfgLayout {
	width: number;
	height: number;
	stride: number;
	/** The depth the reference derives from the stride, which is 24 only for exactly three bytes a pixel. */
	bitsPerPixel: number;
	/** Three bytes a pixel when the derived depth is 24, four otherwise, as the reference chooses. */
	pixelSize: number;
	type: number;
}

function readLayout(header: Buffer): MfgLayout | undefined {
	if (header.length < HEADER_SIZE) return undefined;
	const marker = header.subarray(0, 4);
	if (!MARKERS.some((candidate) => marker.equals(candidate))) return undefined;
	const type = header[3] ?? 0;
	const dataSize = header.readUInt32LE(4);
	const width = header.readUInt32LE(8);
	const height = header.readUInt32LE(0xc);
	const stride = header.readUInt32LE(0x10);
	if (width === 0 || height === 0) return undefined;
	// A stride narrower than the row is what the reference rejects outright when it reads the metadata.
	if (stride < width) return undefined;
	// The reference returns no metadata unless the declared length matches row for row.
	if (stride * height !== dataSize) return undefined;
	const bitsPerPixel = Math.trunc((stride * 8) / width);
	return {
		width,
		height,
		stride,
		bitsPerPixel,
		pixelSize: bitsPerPixel === 24 ? 3 : 4,
		type,
	};
}

export const silkyMfgImageDescriptor: FormatDescriptor = {
	id: "silky-mfg-image",
	name: "Silky's RGB image",
	extensions: ["mfp"],
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
			source: "ArcFormats/Silky/ImageMFG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const silkyMfgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: silkyMfgImageDescriptor,
	detection: { signatures: MARKERS.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readLayout(header) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (source.size < BigInt(HEADER_SIZE)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky image");
		}
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const layout = readLayout(header);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readLayout(file);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky image");
		const { width, height, stride, pixelSize, type } = layout;
		if (stride * height > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "Silky image is too large");
		}
		let position = HEADER_SIZE;
		if (type !== PLAIN_TYPE) {
			// Every other flavour carries a palette block in front of each row: a count, then that many eight
			// byte entries, which the reference seeks past without looking at.
			for (let row = 0; row < height; row += 1) {
				if (position + 4 > file.length) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Unexpected end of Silky image",
					);
				}
				const entries = file.readUInt32LE(position);
				position += 4;
				const blockSize = entries * PALETTE_ENTRY_SIZE;
				if (blockSize > file.length - position) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Unexpected end of Silky image",
					);
				}
				position += blockSize;
			}
		}
		// The reference reads a whole stride per row and fails when the file ends early.
		if (stride * height > file.length - position) {
			throw new GarbroError("INVALID_ARCHIVE", "Unexpected end of Silky image");
		}
		// The rows are read at the stride the header declares and handed over as a bitmap of the depth the
		// reference picks, so they are repacked tight here and a short row is padded with zeroes.
		const rowBytes = width * pixelSize;
		const pixels = Buffer.alloc(rowBytes * height, 0x00);
		for (let row = 0; row < height; row += 1) {
			const from = position + row * stride;
			const length = Math.min(stride, rowBytes, file.length - from);
			if (length > 0) file.copy(pixels, row * rowBytes, from, from + length);
		}
		return Readable.from([
			pixelSize === 3
				? writeBmp24(width, height, pixels, false)
				: writeBmp32(width, height, pixels, false),
		]);
	},
});
