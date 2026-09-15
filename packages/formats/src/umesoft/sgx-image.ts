// Format reference: GARBro "ArcFormats/UMeSoft/ImageGRX.cs", classes `SgxFormat` and `SgxMetaData`. The
// multi-frame format keeps one of the pictures of the same file behind a header of its own, at a place the
// header gives, and the reader of that picture is the one ported in "./grx-image.ts".
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import {
	GRX_INFO_OFFSET,
	GRX_SIGNATURE,
	grxReportedDepth,
	readGrxInfo,
	unpackGrx,
	writeGrxBitmap,
	type GrxLayout,
} from "./grx-image.js";

/** The four bytes of the signature, which the reference packs into a word. */
const SIGNATURE = Buffer.from([0x53, 0x47, 0x58, 0x1a]);
/** The place the picture stands at, which has to stand behind the header of the file itself. */
const OFFSET_FIELD = 4;
const MINIMUM_OFFSET = 8;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface SgxLayout extends GrxLayout {
	/** Where the picture of the U-Me Soft kind stands inside the file. */
	grxOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `SgxFormat.ReadMetaData`: the four bytes `SGX\x1A` and the place the picture stands at, which has to stand
 * behind the header rather than inside it. Behind that place stand the four bytes of the picture of the U-Me
 * Soft kind and its own fields, which is where the measurements come from; a file whose picture does not stand
 * wholly inside it is turned away rather than throwing the way the reference's own reader would.
 */
export function readSgxLayout(data: Buffer): SgxLayout | undefined {
	if (data.length < OFFSET_FIELD + 4) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const offset = data.readInt32LE(OFFSET_FIELD);
	if (offset <= MINIMUM_OFFSET) return undefined;
	if (offset + 4 > data.length) return undefined;
	if (!data.subarray(offset, offset + 4).equals(GRX_SIGNATURE))
		return undefined;
	const info = readGrxInfo(data, offset + GRX_INFO_OFFSET);
	if (!info) return undefined;
	return { ...info, grxOffset: offset };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const umesoftSgxImageDescriptor: FormatDescriptor = {
	id: "umesoft-sgx-image",
	name: "U-Me Soft multi-frame image format",
	extensions: ["grx"],
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
			source: "ArcFormats/UMeSoft/ImageGRX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const umesoftSgxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: umesoftSgxImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(MINIMUM_OFFSET)) return false;
		return readSgxLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readSgxLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a U-Me Soft picture");
		}
		const depth = grxReportedDepth(layout);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(layout.grxOffset),
						size: source.size - BigInt(layout.grxOffset),
						compressed: layout.packed,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: depth,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: layout.packed ? "grx" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: depth,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readSgxLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a U-Me Soft picture");
		}
		const size = layout.width * layout.height * 4;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`U-Me Soft picture of ${size} bytes is too large`,
			);
		}
		const { pixels, outputDepth } = unpackGrx(stored, layout, layout.grxOffset);
		return Readable.from([
			writeGrxBitmap(layout.width, layout.height, pixels, outputDepth),
		]);
	},
});
