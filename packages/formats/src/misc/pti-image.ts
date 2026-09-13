// Format reference: GARbro "ArcFormats/ImagePTI.cs", class `PtiFormat` ("Custom BMP image").
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `Signature` is zero, so the file itself has to be convincing; there is no extension gate either. */
const BMP_MARKER = "BM";
/** The stored zero word that a bitmap's pixel data offset would otherwise sit behind. */
const ZERO_WORD_OFFSET = 0x0e;
/** The stored device independent bitmap header, two bytes later than a bitmap keeps it. */
const DIB_OFFSET = 0x10;
const DIB_SIZE = 0x28;
/** What the reference reads: the sixteen byte prefix and the forty byte header. */
const HEADER_SIZE = 0x38;
const FILE_HEADER_SIZE = 0x10;
const DIB_WIDTH_OFFSET = DIB_OFFSET + 4;
const DIB_HEIGHT_OFFSET = DIB_OFFSET + 8;
const DIB_BPP_OFFSET = DIB_OFFSET + 14;
const BF_SIZE_OFFSET = 2;
/** The two bytes a short twenty four bit image is missing, which the reference fills this way. */
const MISSING_TAIL = Buffer.from([0xff, 0xff]);
const MAX_PIXEL_BYTES = 256 * 1024 * 1024;

interface PtiLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `ReadHeader` reads sixteen bytes and then forty more, and the two reads are what the format is about: it
 * wants `BM`, a **zero** word where a bitmap keeps its pixel data offset's neighbour, and a forty byte device
 * independent header that starts two bytes later than a bitmap's. The second read lands on top of the zero
 * word, which is how the reference ends up with a coherent fifty four byte bitmap header in memory.
 *
 * There is no signature and no extension check, so this probe is the only thing standing between the format
 * and every file on disk; the reference leans on the bitmap reader's own metadata parse, and the port checks
 * the same fields by hand rather than through the shared reader, which would refuse a header whose size field
 * describes a whole file rather than the fifty four bytes it is looking at.
 */
async function readFields(source: ByteSource): Promise<PtiLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (head.toString("latin1", 0, 2) !== BMP_MARKER) return undefined;
		if (head.readUInt16LE(ZERO_WORD_OFFSET) !== 0) return undefined;
		if (head.readUInt32LE(DIB_OFFSET) !== DIB_SIZE) return undefined;
		const width = head.readUInt32LE(DIB_WIDTH_OFFSET);
		const height = head.readInt32LE(DIB_HEIGHT_OFFSET);
		const bitsPerPixel = head.readUInt16LE(DIB_BPP_OFFSET);
		if (width === 0 || height === 0) return undefined;
		if (bitsPerPixel === 0 || bitsPerPixel > 32) return undefined;
		if (width * Math.abs(height) > MAX_PIXEL_BYTES) return undefined;
		return { width, height: Math.abs(height), bitsPerPixel };
	} catch {
		return undefined;
	}
}

export const ptiImageDescriptor: FormatDescriptor = {
	id: "misc-pti-image",
	name: "Custom BMP image",
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
			source: "ArcFormats/ImagePTI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ptiImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ptiImageDescriptor,
	// No signature in the reference, so the format is a candidate for every file and the probe decides.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid PTI image");
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
			// The two reads move in place, so a bitmap of the stored length comes back out.
			sizeKnown: true,
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
		const layout = await readFields(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid PTI image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The reference's two reads in one step: the first sixteen bytes stay where they are, the forty byte
		// header written on top of the zero word lands two bytes earlier, and the pixels follow it.
		const image = Buffer.alloc(stored.length, 0x00);
		stored.copy(image, 0, 0, FILE_HEADER_SIZE);
		let length = stored.length - HEADER_SIZE;
		// The second read asks for the header plus every pixel and writes them two bytes earlier, so the
		// pixels move with the header and land at 0x36 — a bitmap's own pixel offset — while the last two
		// bytes of the buffer stay as they were allocated.
		stored.copy(
			image,
			ZERO_WORD_OFFSET,
			DIB_OFFSET,
			DIB_OFFSET + DIB_SIZE + length,
		);
		if (
			layout.bitsPerPixel === 24 &&
			length + 2 === layout.width * layout.height * 3
		) {
			// A twenty four bit image two bytes short of its own pixel count has its last two bytes replaced
			// by this marker, and the size word then names two bytes more than the buffer holds.
			image[image.length - 2] = MISSING_TAIL[0] ?? 0;
			image[image.length - 1] = MISSING_TAIL[1] ?? 0;
			length += 2;
		}
		image.writeUInt32LE(length + 0x36, BF_SIZE_OFFSET);
		return Readable.from([image]);
	},
});
