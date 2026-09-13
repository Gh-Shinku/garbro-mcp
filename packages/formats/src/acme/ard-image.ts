// Format reference: GARbro "Legacy/Acme/ImageARD.cs", class `ArdFormat` (a fixed size 32 bit image whose
// channels are stored rotated). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The reference uses constants rather than fields: the file has no header at all. */
const WIDTH = 640;
const HEIGHT = 480;
const BITS_PER_PIXEL = 32;
const BYTES_PER_PIXEL = BITS_PER_PIXEL / 8;
/** The reference requires this exact length; it equals `width * height * 4`. */
const FILE_SIZE = 0x12c000;

interface ArdLayout {
	width: number;
	height: number;
	dataSize: number;
}

/** The reference gates on the extension before reading anything. */
function isArdName(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "ard";
}

async function readLayout(source: ByteSource): Promise<ArdLayout | undefined> {
	if (source.size !== BigInt(FILE_SIZE)) return undefined;
	return { width: WIDTH, height: HEIGHT, dataSize: FILE_SIZE };
}

export const ardImageDescriptor: FormatDescriptor = {
	id: "acme-ard-image",
	name: "Acme image format",
	extensions: ["ard"],
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
			source: "Legacy/Acme/ImageARD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ardImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ardImageDescriptor,
	// No signature: the name and the exact length are the whole detection.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!isArdName(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = isArdName(sourcePath) ? await readLayout(source) : undefined;
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Acme ARD image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: BigInt(layout.dataSize),
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: BITS_PER_PIXEL,
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
				bitsPerPixel: BITS_PER_PIXEL,
				pixelFormat: "bgra32",
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Acme ARD image");
		const pixels = Buffer.from(await source.readAt(0n, layout.dataSize));
		for (let i = 0; i < pixels.length; i += BYTES_PER_PIXEL) {
			// The reference rotates each group of four bytes left by one: `A B C D` becomes `B C D A`,
			// which turns the stored order into the `Bgra32` layout the image is built with.
			const first = pixels[i] as number;
			pixels[i] = pixels[i + 1] as number;
			pixels[i + 1] = pixels[i + 2] as number;
			pixels[i + 2] = pixels[i + 3] as number;
			pixels[i + 3] = first;
		}
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
