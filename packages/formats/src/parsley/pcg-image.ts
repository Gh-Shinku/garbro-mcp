// Format reference: GARbro "ArcFormats/Software House Parsley/ImagePCG.cs", class `PcgFormat`
// (a raw BGRA image whose dimensions are fixed by an exact file length relation).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from([0x50, 0x43, 0x47, 0x30]); // 'PCG0'
const HEADER_SIZE = 0x14;
const WIDTH_OFFSET = 12;
const HEIGHT_OFFSET = 16;
const BYTES_PER_PIXEL = 4;

interface PcgLayout {
	width: number;
	height: number;
	dataOffset: number;
	dataSize: number;
}

/**
 * GARbro `PcgFormat.ReadMetaData`: the file must be exactly `width * height * 4 + 0x14` bytes long.
 * The relation is computed with BigInt so that a hostile header cannot overflow it.
 */
async function readLayout(source: ByteSource): Promise<PcgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// A zero dimension would satisfy the reference's relation for a header-only file, but yields no
		// usable image, so it is declined here.
		if (width === 0 || height === 0) return undefined;
		const dataSize = BigInt(width) * BigInt(height) * BigInt(BYTES_PER_PIXEL);
		if (source.size !== dataSize + BigInt(HEADER_SIZE)) return undefined;
		return {
			width,
			height,
			dataOffset: HEADER_SIZE,
			dataSize: Number(dataSize),
		};
	} catch {
		return undefined;
	}
}

export const pcgImageDescriptor: FormatDescriptor = {
	id: "parsley-pcg-image",
	name: "Software House Parsley image format",
	extensions: ["pcg"],
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
			source: "ArcFormats/Software House Parsley/ImagePCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pcgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pcgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Parsley PCG image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.dataSize),
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 32,
				} as Record<string, unknown>,
			}),
			// A bitmap header is prepended, so the payload is longer than the stored pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				pixelFormat: "bgra32",
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Parsley PCG image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
