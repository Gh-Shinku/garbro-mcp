// Format reference: GARbro "ArcFormats/MicroVision/ImageGPC.cs", class `GpcFormat` (MicroVision image format).
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

const MARKER = "GPC0";
const HEADER_SIZE = 0x40;
/** The flags word sits here and names which of the two variants the file is. */
const FLAGS_OFFSET = 0x0c;
const V1_FLAG = 0x1000;
const V2_FLAG = 0x2000;
/** Each variant follows the primary header with a block of its own. */
const V1_BLOCK_SIZE = 0x30;
const V2_BLOCK_SIZE = 0x50;
/** Both blocks hold the dimensions at the same place within themselves. */
const WIDTH_OFFSET = 0x10;
const HEIGHT_OFFSET = 0x12;
/** The second variant carries a version word that must be one. */
const V2_VERSION_OFFSET = 0x14;
const V2_VERSION = 1;
/** The pixels sit behind both headers, whichever variant they belong to. */
const DATA_OFFSET = HEADER_SIZE + V2_BLOCK_SIZE;
const BITS_PER_PIXEL = 32;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface GtxLayout {
	width: number;
	height: number;
	/** Which variant the header claims, which is also which one the reference can read. */
	version: typeof V1_FLAG | typeof V2_FLAG;
}

async function readLayout(source: ByteSource): Promise<GtxLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.toString("latin1", 0, 4) !== MARKER) return undefined;
		const flags = header.readUInt16LE(FLAGS_OFFSET);
		// The reference looks for the first flag first, so a header that carries both is the first variant.
		if ((flags & V1_FLAG) !== 0) {
			const block = Buffer.from(
				await source.readAt(BigInt(HEADER_SIZE), V1_BLOCK_SIZE),
			);
			return {
				width: block.readUInt16LE(WIDTH_OFFSET),
				height: block.readUInt16LE(HEIGHT_OFFSET),
				version: V1_FLAG,
			};
		}
		if ((flags & V2_FLAG) !== 0) {
			const block = Buffer.from(
				await source.readAt(BigInt(HEADER_SIZE), V2_BLOCK_SIZE),
			);
			if (block.readUInt16LE(V2_VERSION_OFFSET) !== V2_VERSION)
				return undefined;
			return {
				width: block.readUInt16LE(WIDTH_OFFSET),
				height: block.readUInt16LE(HEIGHT_OFFSET),
				version: V2_FLAG,
			};
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export const gtxImageDescriptor: FormatDescriptor = {
	id: "microvision-gtx-image",
	name: "MicroVision image",
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
			source: "ArcFormats/MicroVision/ImageGPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gtxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gtxImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARKER, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MicroVision image");
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
					bitsPerPixel: BITS_PER_PIXEL,
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
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MicroVision image");
		if (layout.version !== V2_FLAG) {
			// The reference reads the first variant's header and then throws: its reading code was never
			// written. The port says the same thing in the same place rather than inventing a layout.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MicroVision images of the first variant are not implemented",
			);
		}
		const stride = layout.width * 4;
		const total = stride * layout.height;
		if (total > MAX_IMAGE_BYTES) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MicroVision image is too large",
			);
		}
		if (BigInt(DATA_OFFSET + total) > source.size) {
			// The reference reads exactly this many bytes and fails when the file holds fewer.
			throw new GarbroError("INVALID_ARCHIVE", "Truncated MicroVision image");
		}
		const pixels = Buffer.from(await source.readAt(BigInt(DATA_OFFSET), total));
		// The reference hands these pixels over unflipped and four bytes a pixel.
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, false),
		]);
	},
});
