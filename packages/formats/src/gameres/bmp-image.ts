// Format reference: GARbro "GameRes/ImageBMP.cs", classes `BmpFormat` and `BmpMetaData` (Windows device
// independent bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpImage, writeBmpImage } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The shorter header, whose measurements are words and whose bitmap rows are always bottom up. */
const CORE_HEADER_SIZE = 0xc;
const FULL_HEADER_SIZE = 40;
/** The two lengths a bitmap is allowed to claim instead of a real one. */
const NO_SIZE = 0;
const EMPTY_SIZE = 0xe;
/** What the reference reads before it knows how long the header is, and what a full one needs. */
const HEAD_FIELD_END = 18;
const FULL_FIELDS_END = 30;
const CORE_FIELDS_END = 26;

interface BmpFields {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Where the pixels begin, and how long the bitmap says it is. */
	imageOffset: number;
	imageLength: number;
}

/**
 * The measurements the reference's own metadata reader takes out of a bitmap, with the same leniency: a
 * bitmap that claims no size at all, or the fourteen bytes of its own file header, is read as far as it goes,
 * and a claim longer than the file is clamped to the file.
 */
async function readBmpFields(
	source: ByteSource,
): Promise<BmpFields | undefined> {
	const total = Number(source.size);
	if (total < HEAD_FIELD_END) return undefined;
	const head = Buffer.from(await source.readAt(0n, HEAD_FIELD_END));
	if (head.subarray(0, 2).toString("latin1") !== "BM") return undefined;
	const size = head.readUInt32LE(2);
	const imageOffset = head.readUInt32LE(10);
	const headerSize = head.readUInt32LE(14);
	// A bitmap that claims less than its own headers is read as the whole file, and one that claims more is
	// clamped to the file; both are lengths the reference settles on before it looks further.
	let length = size;
	if (size < 14 + headerSize) {
		if (size !== NO_SIZE && size !== EMPTY_SIZE) return undefined;
		length = total;
	} else if (size > total) {
		length = total;
	}
	let width: number;
	let height: number;
	let bitsPerPixel: number;
	if (CORE_HEADER_SIZE === headerSize) {
		if (total < CORE_FIELDS_END) return undefined;
		const core = Buffer.from(await source.readAt(0n, CORE_FIELDS_END));
		width = core.readUInt16LE(18);
		height = core.readUInt16LE(20);
		bitsPerPixel = core.readUInt16LE(24);
	} else {
		if (headerSize < FULL_HEADER_SIZE || length - 14 < headerSize)
			return undefined;
		if (total < FULL_FIELDS_END) return undefined;
		const full = Buffer.from(await source.readAt(0n, FULL_FIELDS_END));
		// A height that is negative is a bitmap whose rows are stored the other way up. The reference reads
		// the word as unsigned and reports a measurement in the billions; this port reports the height of the
		// picture it hands back, which is the same measurement with its sign taken off.
		width = full.readUInt32LE(18);
		height = Math.abs(full.readInt32LE(22));
		bitsPerPixel = full.readUInt16LE(28);
	}
	return {
		width,
		height,
		bitsPerPixel,
		imageOffset,
		imageLength: length,
	};
}

/** The bitmap behind the header, written out again at the depth it was stored in. */
async function renderBmpImage(source: ByteSource): Promise<Buffer> {
	const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
	const image = readBmpImage(stored);
	if (!image) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Windows bitmap");
	}
	return writeBmpImage(image);
}

export const gameresBmpImageDescriptor: FormatDescriptor = {
	id: "gameres-bmp-image",
	name: "Windows device independent bitmap",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		// The reference can write bitmaps; this project only takes them apart.
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "GameRes/ImageBMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresBmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresBmpImageDescriptor,
	// The reference registers no signature of its own, which offers the format every file it is tried on; the
	// tag `BM` and the header behind it are what decide.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readBmpFields(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const fields = await readBmpFields(source);
		if (!fields) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Windows bitmap");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: fields.width,
							height: fields.height,
							bitsPerPixel: fields.bitsPerPixel,
							imageOffset: fields.imageOffset,
							imageLength: fields.imageLength,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "none",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		void sourcePath;
		return Readable.from([await renderBmpImage(source)]);
	},
});
