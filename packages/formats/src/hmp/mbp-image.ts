// Format reference: GARbro "Legacy/hmp/ImageMBP.cs", class `MbpFormat` (a bitmap whose dimensions repeat
// the file length). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference directory is the same one that holds `ImageALP.cs`; that port lives in
// `packages/formats/src/bef/` because its tag is `ALP/BeF`, while this one is named after the directory.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 8;
const WIDTH_OFFSET = 0;
const HEIGHT_OFFSET = 4;
const BYTES_PER_PIXEL = 2;

interface MbpLayout {
	width: number;
	height: number;
}

/** The reference gates on `.MBP` before reading anything, then derives everything from the length. */
function hasExtension(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "mbp";
}

async function readLayout(source: ByteSource): Promise<MbpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference accepts the file only when the dimensions describe its exact length.
		const expected = BigInt(HEADER_SIZE) + BigInt(width) * BigInt(height) * 2n;
		if (expected !== source.size) return undefined;
		// A zero sized image would satisfy the length test for an empty file; nothing can be drawn from it.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const mbpImageDescriptor: FormatDescriptor = {
	id: "hmp-mbp-image",
	name: "h.m.p bitmap format",
	extensions: ["mbp"],
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
			source: "Legacy/hmp/ImageMBP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mbpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mbpImageDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid h.m.p MBP image");
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid h.m.p MBP image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 15,
				} as Record<string, unknown>,
			}),
			// A bitmap header and colour masks are written around the pixels.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				pixelFormat: "bgr555",
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid h.m.p MBP image");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				layout.width * layout.height * BYTES_PER_PIXEL,
			),
		);
		return Readable.from([writeBmp16(layout.width, layout.height, stored)]);
	},
});
