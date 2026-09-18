// Format reference: GARbro "ArcFormats/Sohfu/ImageDTL.cs", classes `DtlFormat`, `DtlcFormat` and
// `DtlMetaData` (a Sohfu picture of raw pixels, and one behind a table of runs). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4, writeBmp8, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'DTL_', and 'DTLC' with 'DTLA' the second word of the other format. */
const DTL_SIGNATURE = Buffer.from("DTL_", "latin1");
const DTLC_SIGNATURES = [
	Buffer.from("DTLC", "latin1"),
	Buffer.from("DTLA", "latin1"),
];
const HEADER_SIZE = 0x18;
const WIDTH_FIELD = 0x08;
const HEIGHT_FIELD = 0x0c;
const DEPTH_FIELD = 0x10;
const STRIDE_FIELD = 0x14;
/** Four, eight, twenty four and thirty two bits a pixel of a plain picture; only the last two of a run one. */
const DTL_DEPTHS = [4, 8, 24, 32];
const DTLC_DEPTHS = [24, 32];
const RUN_SIZE = 8;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** The sixteen shades a four bit grey picture is drawn with, three bytes an entry. */
const GREY4_PALETTE = (() => {
	const palette = Buffer.alloc(16 * 3, 0x00);
	for (let level = 0; level < 16; level += 1) {
		const value = level * 0x11;
		palette[level * 3] = value;
		palette[level * 3 + 1] = value;
		palette[level * 3 + 2] = value;
	}
	return palette;
})();

export interface DtlLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The bytes of a row of the reader's own buffer, which may be padded. */
	stride: number;
	/** The bytes of a tight row of the picture. */
	rowBytes: number;
	/** Where the pixels stand; a run picture has a table of its own in front of them. */
	pixelsOffset: number;
	strideCount: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The header both kinds share: width, height, depth and the row of the reader's own buffer. */
function readFields(
	data: Buffer,
	depths: readonly number[],
):
	| { width: number; height: number; bitsPerPixel: number; stride: number }
	| undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const bitsPerPixel = data.readInt32LE(DEPTH_FIELD);
	if (!depths.includes(bitsPerPixel)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const stride = data.readInt32LE(STRIDE_FIELD);
	const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
	if (stride < rowBytes || stride * height > LIMIT) return undefined;
	if (!Number.isSafeInteger(stride * height)) return undefined;
	return { width, height, bitsPerPixel, stride };
}

/**
 * `DtlFormat.ReadMetaData`: the width and the height stand at eight and twelve as words, the depth at
 * sixteen and the row of the reader's own buffer at twenty. Only four, eight, twenty four and thirty two
 * bits a pixel are read, and the pixels stand right behind the head.
 */
export function readDtlLayout(
	data: Buffer,
	fileLength = data.length,
): DtlLayout | undefined {
	if (!data.subarray(0, DTL_SIGNATURE.length).equals(DTL_SIGNATURE)) {
		return undefined;
	}
	const fields = readFields(data, DTL_DEPTHS);
	if (!fields) return undefined;
	const length = fields.stride * fields.height;
	if (HEADER_SIZE + length > fileLength) return undefined;
	return {
		...fields,
		rowBytes: Math.ceil((fields.width * fields.bitsPerPixel) / 8),
		pixelsOffset: HEADER_SIZE,
		strideCount: 0,
	};
}

/**
 * `DtlcFormat.ReadMetaData`: the same head, but only twenty four and thirty two bits a pixel. The pixels
 * stand behind a table with an entry a row: the count of runs of the row as a word, and then eight bytes a
 * run, none of which the reference reads — it walks past them to reach the pixels.
 */
export function readDtlcLayout(
	data: Buffer,
	fileLength = data.length,
): DtlLayout | undefined {
	if (
		!DTLC_SIGNATURES.some((mark) => data.subarray(0, mark.length).equals(mark))
	) {
		return undefined;
	}
	const fields = readFields(data, DTLC_DEPTHS);
	if (!fields) return undefined;
	let position = HEADER_SIZE;
	let runs = 0;
	for (let row = 0; row < fields.height; row += 1) {
		if (position + 4 > fileLength || position + 4 > data.length) {
			return undefined;
		}
		const count = data.readInt32LE(position);
		if (count < 0) return undefined;
		position += 4 + count * RUN_SIZE;
		if (position > fileLength) return undefined;
		runs += count;
	}
	const length = fields.stride * fields.height;
	if (position + length > fileLength) return undefined;
	return {
		...fields,
		rowBytes: Math.ceil((fields.width * fields.bitsPerPixel) / 8),
		pixelsOffset: position,
		strideCount: runs,
	};
}

/**
 * The pixels of either kind stand as they are, so only the padding of the reader's own rows is taken out
 * before the bitmap is written. The four bit picture is drawn with the sixteen shades of grey its format
 * implies, and the eight bit one as a grey bitmap.
 */
export function dtlBitmap(stored: Buffer, layout: DtlLayout): Buffer {
	const length = layout.stride * layout.height;
	const pixels = stored.subarray(
		layout.pixelsOffset,
		layout.pixelsOffset + length,
	);
	if (pixels.length !== length) {
		throw invalidPicture("Sohfu picture is cut short of its pixels");
	}
	const tight: Buffer = Buffer.alloc(layout.height * layout.rowBytes, 0x00);
	for (let row = 0; row < layout.height; row += 1) {
		pixels.copy(
			tight,
			row * layout.rowBytes,
			row * layout.stride,
			row * layout.stride + layout.rowBytes,
		);
	}
	// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
	switch (layout.bitsPerPixel) {
		case 4:
			return writeBmp4(layout.width, layout.height, tight, GREY4_PALETTE);
		case 8:
			return writeBmp8(layout.width, layout.height, tight);
		case 32:
			return writeBmp32(layout.width, layout.height, tight);
		default:
			return writeBmp24(layout.width, layout.height, tight);
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function pictureEntry(layout: DtlLayout, sourcePath: string): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(layout.pixelsOffset),
			size: BigInt(layout.stride * layout.height),
			compressed: false,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				stride: layout.stride,
				runs: layout.strideCount,
			},
		}),
		// The rows of the reader's own buffer are taken out into a bitmap of their own size.
		sizeKnown: false,
	};
}

export const sohfuDtlImageDescriptor: FormatDescriptor = {
	id: "sohfu-dtl-image",
	name: "Sohfu image format",
	extensions: ["ls8b", "ls8"],
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
			source: "ArcFormats/Sohfu/ImageDTL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sohfuDtlImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sohfuDtlImageDescriptor,
	detection: { signatures: [{ bytes: DTL_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (!header.subarray(0, DTL_SIGNATURE.length).equals(DTL_SIGNATURE)) {
				return false;
			}
			const fields = readFields(header, DTL_DEPTHS);
			if (!fields) return false;
			return BigInt(HEADER_SIZE + fields.stride * fields.height) <= source.size;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readDtlLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Sohfu picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath)],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readDtlLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Sohfu picture");
		}
		return Readable.from([dtlBitmap(stored, layout)]);
	},
});

export const sohfuDtlcImageDescriptor: FormatDescriptor = {
	id: "sohfu-dtlc-image",
	name: "Sohfu image format",
	extensions: ["ls8b", "ls8"],
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
			source: "ArcFormats/Sohfu/ImageDTL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sohfuDtlcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sohfuDtlcImageDescriptor,
	detection: {
		signatures: DTLC_SIGNATURES.map((bytes) => ({ bytes })),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (
				!DTLC_SIGNATURES.some((mark) =>
					header.subarray(0, mark.length).equals(mark),
				)
			) {
				return false;
			}
			return (
				readDtlcLayout(await readStored(source), Number(source.size)) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readDtlcLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidPicture("Not a Sohfu picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath)],
			metadata: {
				image: "bmp",
				compression: "runs",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readDtlcLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Sohfu picture");
		}
		return Readable.from([dtlBitmap(stored, layout)]);
	},
});
