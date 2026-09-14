// Format reference: GARbro "ArcFormats/MnoViolet/ImageGRA.cs", class `GraFormat` (M no Violet image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32, writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * `gra` (the reference's word 0x00617267) and `mas` (0x0073616D), each followed by a null. The third form the
 * reference reads, a first word of `1` with the depth behind it, is only reachable through its zero signature
 * registration, and the class declares no extension to reach it by, so the port registers these two alone.
 */
const MARKERS: Array<{ bytes: Buffer; bitsPerPixel: number }> = [
	{ bytes: Buffer.from("gra\0", "latin1"), bitsPerPixel: 24 },
	{ bytes: Buffer.from("mas\0", "latin1"), bitsPerPixel: 8 },
];
const HEADER_SIZE = 0x14;
const MAX_DIMENSION = 0x8000;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface GraLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	packedSize: number;
	unpackedSize: number;
	/** Where the compressed body starts, which is right behind the two size words. */
	dataOffset: number;
	/** The stride the reference gives its image, four byte aligned. */
	stride: number;
}

async function readLayout(source: ByteSource): Promise<GraLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const marker = MARKERS.find((candidate) =>
			header.subarray(0, 4).equals(candidate.bytes),
		);
		if (!marker) return undefined;
		const width = header.readUInt32LE(4);
		const height = header.readUInt32LE(8);
		// The marker fixes the depth; the reference then insists it is one of the three it can build.
		const bitsPerPixel = marker.bitsPerPixel;
		if (bitsPerPixel !== 32 && bitsPerPixel !== 24 && bitsPerPixel !== 8)
			return undefined;
		const packedSize = header.readInt32LE(0xc);
		const unpackedSize = header.readInt32LE(0x10);
		if (width === 0 || width > MAX_DIMENSION) return undefined;
		if (height === 0 || height > MAX_DIMENSION) return undefined;
		// Neither size is checked by the reference; the port needs both to describe a whole image.
		if (packedSize <= 0 || unpackedSize <= 0) return undefined;
		if (width * height * (bitsPerPixel / 8) > MAX_IMAGE_BYTES) return undefined;
		const stride = (((width * bitsPerPixel) / 8 + 3) & ~3) >>> 0;
		return {
			width,
			height,
			bitsPerPixel,
			packedSize,
			unpackedSize,
			dataOffset: HEADER_SIZE,
			stride,
		};
	} catch {
		return undefined;
	}
}

export const mnoVioletGraImageDescriptor: FormatDescriptor = {
	id: "mnoviolet-gra-image",
	name: "M no Violet image",
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
			source: "ArcFormats/MnoViolet/ImageGRA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mnoVioletGraImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mnoVioletGraImageDescriptor,
	detection: { signatures: MARKERS.map(({ bytes }) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid M no Violet image");
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
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid M no Violet image");
		const { width, height, bitsPerPixel, packedSize, unpackedSize, stride } =
			layout;
		const pixelSize = bitsPerPixel / 8;
		// The reference hands its image layer exactly the unpacked buffer, which has to hold the whole image
		// at the stride it asks for, and it reads exactly the packed size from the file.
		if (unpackedSize < stride * height) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"M no Violet image is too short",
			);
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (layout.dataOffset + packedSize > file.length) {
			throw new GarbroError("INVALID_ARCHIVE", "M no Violet body is truncated");
		}
		const body = file.subarray(
			layout.dataOffset,
			layout.dataOffset + packedSize,
		);
		// The reference's LzssReader reads the same stream the library's own decoder does: a 0x1000 byte
		// window that starts at 0xFEE, one control bit a token, a set bit for a literal and a match whose
		// offset sits in the high twelve bits of its two bytes with the length in the low nibble below.
		const decoded = inflateLzss(body, { outputLength: unpackedSize });
		// The rows are read at the reference's stride and handed over tight for the bitmap this port writes.
		const rowBytes = width * pixelSize;
		const pixels = Buffer.alloc(rowBytes * height, 0x00);
		for (let row = 0; row < height; row += 1) {
			const from = row * stride;
			const length = Math.min(
				stride,
				rowBytes,
				Math.max(0, decoded.length - from),
			);
			if (length > 0) decoded.copy(pixels, row * rowBytes, from, from + length);
		}
		// `ImageData.CreateFlipped` stores the rows bottom up, which is what a positive bitmap height means.
		const bottomUp = true;
		const bitmap =
			bitsPerPixel === 24
				? writeBmp24(width, height, pixels, bottomUp)
				: bitsPerPixel === 8
					? writeBmp8(width, height, pixels, bottomUp)
					: writeBmp32(width, height, pixels, bottomUp);
		return Readable.from([bitmap]);
	},
});
