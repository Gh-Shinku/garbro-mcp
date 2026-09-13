// Format reference: GARbro "Legacy/Harvest/ImageUNH.cs", class `UnhFormat` ([021206][MyHarvest] Idol Mahjong
// Final Romance 4).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { RGB565_MASKS, writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x18;
const MARKER = "UNH0";
/** The pixels begin here, behind the header and the block between them. */
const DATA_OFFSET = 0x44;
/** The reference checks this word against one and refuses anything else. */
const VERSION = 1;
/** Sixteen bit pixels, and the port's own ceiling on a decoded image. */
const BITS_PER_PIXEL = 16;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;
/** A match copies its length word's low nibble plus two, so seventeen words at most. */
const MATCH_BASE = 2;

interface UnhLayout {
	width: number;
	height: number;
}

async function readLayout(source: ByteSource): Promise<UnhLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.toString("latin1", 0, 4) !== MARKER) return undefined;
		if (header.readInt32LE(4) !== VERSION) return undefined;
		return {
			width: header.readUInt32LE(0x10),
			height: header.readUInt32LE(0x14),
		};
	} catch {
		return undefined;
	}
}

/**
 * Decodes the word stream. The reference keeps a four thousand and ninety six word ring beside its output and
 * writes every word into both, advancing their positions together, so the ring is always the last page of what
 * has been written: the port reads its matches straight out of the output and starts from the same blank page.
 */
function decode(data: Buffer, total: number, pixels: Buffer): void {
	const window = (index: number): number =>
		pixels.readUInt16LE((index & 0xfff) * 2);
	let at = 0;
	let written = 0;
	let mask = 0;
	let control = 0;
	while (written < total) {
		// A byte mask walks its eight bits, least significant first, and wraps to zero to ask for the next
		// control byte — the reference keeps it in a byte, so the shift truncates exactly here.
		mask = (mask << 1) & 0xff;
		if (mask === 0) {
			// A control byte that is not there ends the stream, which is how the reference leaves the rest blank.
			if (at >= data.length) break;
			control = data[at] ?? 0;
			at += 1;
			mask = 1;
		}
		if (at + 2 > data.length) {
			// The reference's own reader throws when its word runs off the end of the file.
			throw new GarbroError("INVALID_ARCHIVE", "Truncated MyHarvest image");
		}
		const word = (data[at] ?? 0) | ((data[at + 1] ?? 0) << 8);
		at += 2;
		if ((control & mask) === 0) {
			pixels.writeUInt16LE(word, written * 2);
			written += 1;
			continue;
		}
		let offset = word >>> 4;
		let count = (word & 0xf) + MATCH_BASE;
		if (written + count > total) {
			// The reference writes past the end of its array here, which throws there; the port says so.
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MyHarvest image data overruns the image",
			);
		}
		while (count > 0) {
			const value = window(offset);
			offset += 1;
			pixels.writeUInt16LE(value, written * 2);
			written += 1;
			count -= 1;
		}
	}
}

export const unhImageDescriptor: FormatDescriptor = {
	id: "myharvest-unh-image",
	name: "MyHarvest image",
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
			source: "Legacy/Harvest/ImageUNH.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unhImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unhImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARKER, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyHarvest image");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyHarvest image");
		const { width, height } = layout;
		if (width === 0 || height === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyHarvest image size");
		}
		const total = width * height;
		if (total * 2 > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "MyHarvest image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const pixels: Buffer = Buffer.alloc(total * 2, 0x00);
		decode(file.subarray(DATA_OFFSET), total, pixels);
		// The reference hands the words over unflipped in five six five order.
		return Readable.from([
			writeBmp16(width, height, pixels, false, RGB565_MASKS),
		]);
	},
});
