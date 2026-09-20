// Format reference: GARBro "ArcFormats/UMeSoft/ArcMGX.cs", classes `MgxOpener`, `MgxFormat` and
// `MgxMetaData`. One file is both an archive of frames and the first of those frames as a picture: the port
// keeps a port for each, the archive taking precedence so that a file opens as the several pictures it holds.
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

/** The four bytes of the signature, which the reference packs into a word, shared by both ports. */
const SIGNATURE = Buffer.from([0x4d, 0x47, 0x58, 0x1a]);
/** The archive keeps a count and then a place for every frame. */
/** The picture port keeps the place of the first frame there. */
const FIRST_FRAME_FIELD = 8;
const FIRST_FRAME_HEADER = 12;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface MgxLayout extends GrxLayout {
	/** Where the picture of the U-Me Soft kind stands inside the file. */
	grxOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `MgxOpener.TryOpen`: a count of frames, then the place of every one of them. */
/**
 * `MgxFormat.ReadMetaData`: the four bytes `MGX\x1A` and the place of the first frame, where the four bytes
 * of the picture of the U-Me Soft kind and its own fields stand. A file whose first frame does not stand
 * wholly inside it is turned away rather than throwing the way the reference's own reader would.
 */
export function readMgxLayout(data: Buffer): MgxLayout | undefined {
	if (data.length < FIRST_FRAME_HEADER) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const offset = data.readUInt32LE(FIRST_FRAME_FIELD);
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

const ATTRIBUTION = {
	project: "GARbro",
	source: "ArcFormats/UMeSoft/ArcMGX.cs",
	license: "MIT",
	commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
} as const;

export const umesoftMgxImageDescriptor: FormatDescriptor = {
	id: "umesoft-mgx-image",
	name: "U-Me Soft multi-frame image",
	extensions: ["grx"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [ATTRIBUTION],
};

export const umesoftMgxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: umesoftMgxImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(FIRST_FRAME_HEADER)) return false;
		return readMgxLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMgxLayout(await readStored(source));
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
		const layout = readMgxLayout(stored);
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
