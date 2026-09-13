// Format reference: GARbro "Legacy/KeroQ/ImageCBM.cs", class `CbmFormat` (KeroQ bitmap format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `CBM` and a null, which is how the reference's little endian signature reads back. */
const MARKER: Buffer = Buffer.from([0x43, 0x42, 0x4d, 0x00]);
const HEADER_SIZE = 0x10;
/** The header's own story about how many bytes follow it. */
const LENGTH_OFFSET = 0x0c;
/** One byte per pixel, either a grey level or an index into a palette beside the file. */
const BYTES_PER_PIXEL = 1;
/** A palette file holds a full page of blue, green, red triples. */
const PALETTE_ENTRIES = 0x100;
const PALETTE_ENTRY_SIZE = 3;
const PALETTE_BYTES = PALETTE_ENTRIES * PALETTE_ENTRY_SIZE;
/** What the previous reader left in the name shortens the last two candidates. */
const SHORT_NAME_LENGTH = 3;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface CbmLayout {
	width: number;
	height: number;
}

async function readLayout(source: ByteSource): Promise<CbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(MARKER)) return undefined;
		// The header says how long the file is and the reader insists on it being right.
		if (
			BigInt(header.readUInt32LE(LENGTH_OFFSET)) !==
			source.size - BigInt(HEADER_SIZE)
		) {
			return undefined;
		}
		return {
			width: header.readUInt32LE(4),
			height: header.readUInt32LE(8),
		};
	} catch {
		return undefined;
	}
}

/**
 * The palette files the reference looks for, in order. It shortens its own base name as it goes, so the
 * last two candidates are built from the shortened name rather than the whole one.
 */
export function cbmPaletteNames(fileName: string): string[] {
	const base = changeExtension(fileName, "");
	const names = [`${base}.pal`];
	let shortened = base;
	if (base.length > SHORT_NAME_LENGTH) {
		shortened = base.substring(0, SHORT_NAME_LENGTH);
		names.push(`${shortened}.pal`);
	}
	names.push(`${shortened}_2.pal`, `${shortened}_1.pal`);
	return names;
}

/** Expands a blue, green, red palette into the four byte entries a bitmap palette page holds. */
function expandPalette(palette: Buffer): Buffer {
	const page: Buffer = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		page[index * 4] = palette[index * PALETTE_ENTRY_SIZE] ?? 0;
		page[index * 4 + 1] = palette[index * PALETTE_ENTRY_SIZE + 1] ?? 0;
		page[index * 4 + 2] = palette[index * PALETTE_ENTRY_SIZE + 2] ?? 0;
	}
	return page;
}

export const keroqCbmImageDescriptor: FormatDescriptor = {
	id: "keroq-cbm-image",
	name: "KeroQ bitmap",
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
			source: "Legacy/KeroQ/ImageCBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const keroqCbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: keroqCbmImageDescriptor,
	detection: { signatures: [{ bytes: MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KeroQ bitmap");
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
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// The header's length word ties the entry to the file exactly.
			sizeKnown: true,
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
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KeroQ bitmap");
		const { width, height } = layout;
		if (width === 0 || height === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KeroQ bitmap size");
		}
		const pixels = width * height;
		if (pixels * BYTES_PER_PIXEL > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "KeroQ bitmap is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The reference reads exactly this many bytes and fails on a file that ends first.
		if (file.length - HEADER_SIZE < pixels) {
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KeroQ bitmap");
		}
		const colours: Buffer = Buffer.alloc(pixels, 0x00);
		file.copy(colours, 0, HEADER_SIZE, HEADER_SIZE + pixels);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		let palette: Buffer | undefined;
		for (const name of cbmPaletteNames(fileName)) {
			const candidate = await readCompanionFile(sourcePath, name);
			// The reference stops at the first palette file that exists, whether or not it reads well.
			if (candidate === undefined) continue;
			if (candidate.length >= PALETTE_BYTES) {
				palette = expandPalette(candidate);
			}
			break;
		}
		// Without a palette the reference calls the pixels grey levels, which is the same ramp the shared
		// grey bitmap writer uses.
		if (palette === undefined) {
			return Readable.from([writeBmp8(width, height, colours, false)]);
		}
		return Readable.from([
			writeBmp8Palette(width, height, colours, palette, false),
		]);
	},
});
