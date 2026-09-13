// Format reference: GARbro "Legacy/hmp/ImageALP.cs", class `AlpFormat` (tag `ALP/BeF`, a fixed size
// six bit grey mask that the reference expands to eight bit on read). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The reference's dimensions are constants, not fields: the file has no header at all. */
const WIDTH = 320;
const HEIGHT = 480;
/** The reference requires this exact file length; it equals the pixel count. */
const FILE_SIZE = 0x25800;
/** Six bit samples are expanded to eight bits by `pixel * 0xFF / 0x40`. */
const SCALE_NUMERATOR = 0xff;
const SCALE_DENOMINATOR = 0x40;

interface AlpLayout {
	width: number;
	height: number;
	dataSize: number;
}

/**
 * `AlpFormat.ReadMetaData` gates on the `.alp` extension and an exact length, then reports constant
 * dimensions. The name is available in `detect` and `read`, so it is checked there.
 */
function isAlpName(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "alp";
}

async function readLayout(source: ByteSource): Promise<AlpLayout | undefined> {
	if (source.size !== BigInt(FILE_SIZE)) return undefined;
	return { width: WIDTH, height: HEIGHT, dataSize: FILE_SIZE };
}

export const befAlpImageDescriptor: FormatDescriptor = {
	id: "bef-alp-image",
	name: "BeF bitmap mask format",
	extensions: ["alp"],
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
			source: "Legacy/hmp/ImageALP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const befAlpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: befAlpImageDescriptor,
	// No signature: the name and the exact length are the whole detection.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!isAlpName(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = isAlpName(sourcePath) ? await readLayout(source) : undefined;
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BeF ALP bitmap mask");
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
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// A bitmap header and palette are prepended, so the payload is longer than the stored mask.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BeF ALP bitmap mask");
		const stored = Buffer.from(await source.readAt(0n, layout.dataSize));
		for (let i = 0; i < stored.length; i += 1) {
			// The reference multiplies and divides in `int`, then casts to `byte`, so an out of range
			// input sample wraps rather than saturating. Both halves are reproduced.
			stored[i] =
				Math.trunc(
					((stored[i] as number) * SCALE_NUMERATOR) / SCALE_DENOMINATOR,
				) & 0xff;
		}
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		return Readable.from([writeBmp8(layout.width, layout.height, stored)]);
	},
});
