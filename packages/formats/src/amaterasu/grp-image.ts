// Format reference: GARbro "ArcFormats/Amaterasu/ImageGRP.cs", class `GrpFormat` (Amaterasu Translations
// GRP image). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const SIGNATURE_BYTES = Buffer.from([0x47, 0x52, 0x50, 0x00]);
const HEADER_SIZE = 12;
const BYTES_PER_PIXEL = 4;
/** The reference multiplies the measurements without a check; a cap keeps a broken header from asking for all of memory. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface GrpLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

/**
 * The header the reference reads without looking at a single one of its measurements: twelve bytes, and only
 * the signature is a gate. The file keeps its rows from the bottom up.
 */
async function readGrpLayout(
	source: ByteSource,
): Promise<GrpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (header.length < HEADER_SIZE) return undefined;
	if (!header.subarray(0, 4).equals(SIGNATURE_BYTES)) return undefined;
	return {
		width: header.readUInt16LE(8),
		height: header.readUInt16LE(10),
		offsetX: header.readInt16LE(4),
		offsetY: header.readInt16LE(6),
	};
}

function imageSize(layout: GrpLayout): number {
	return layout.width * BYTES_PER_PIXEL * layout.height;
}

function checkSize(layout: GrpLayout, size: number): void {
	if (0 === layout.width || 0 === layout.height) {
		// The reference hands such a picture to the framework, which refuses a bitmap of no pixels.
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`Unsupported Amaterasu GRP image size ${layout.width}x${layout.height}`,
		);
	}
	if (!Number.isSafeInteger(size) || size > MAX_IMAGE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Amaterasu GRP image of ${layout.width}x${layout.height} is too large`,
		);
	}
}

export const amaterasuGrpImageDescriptor: FormatDescriptor = {
	id: "amaterasu-grp-image",
	name: "Amaterasu Translations GRP image",
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
			source: "ArcFormats/Amaterasu/ImageGRP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const amaterasuGrpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: amaterasuGrpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE_BYTES }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		return (await readGrpLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readGrpLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Amaterasu GRP image");
		}
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
					bitsPerPixel: 32,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readGrpLayout(source);
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Amaterasu GRP image");
		}
		const size = imageSize(layout);
		checkSize(layout, size);
		const stride = layout.width * BYTES_PER_PIXEL;
		// The reference asks for a whole row at a time and gives up on a short one; the port reads what the
		// file holds and makes the same judgement once.
		const available = Math.max(0, Number(source.size) - HEADER_SIZE);
		const stored = Buffer.from(
			await source.readAt(BigInt(HEADER_SIZE), Math.min(size, available)),
		);
		if (stored.length < size) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Amaterasu GRP image");
		}
		// The reference reads the rows of the file from the last one to the first, which leaves them in the
		// top down order the picture is created with.
		const pixels: Buffer = Buffer.alloc(size, 0x00);
		for (let row = layout.height - 1; row >= 0; row -= 1) {
			stored.copy(
				pixels,
				row * stride,
				(layout.height - 1 - row) * stride,
				(layout.height - row) * stride,
			);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
