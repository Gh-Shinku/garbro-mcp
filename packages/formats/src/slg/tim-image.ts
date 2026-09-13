// Format reference: GARbro "ArcFormats/Slg/ImageTIM.cs", class `TimFormat` (SLG system encrypted image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsvcRandom } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 1024;
const EXTENSION = "tim";
/** The version string the reference looks for in the scrambled part of the header. */
const VERSION = "TIM Data Ver 1.00\0";
const VERSION_OFFSET = 0x2de;
/** Every image is twenty four bits, whatever the header might suggest. */
const BITS_PER_PIXEL = 24;
/** The key table is one page long and repeats. */
const TABLE_SIZE = 0x1000;
/** The seed is folded from four bytes spread through the header's first half. */
const SEED_BYTES = [18, 42, 98, 118];
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface TimLayout {
	width: number;
	height: number;
	stride: number;
	/** The generator's state after the header was scrambled, which is what the key table comes from. */
	state: number;
}

function foldSeed(header: Buffer): number {
	return (
		((header[SEED_BYTES[0] as number] ?? 0) |
			((header[SEED_BYTES[1] as number] ?? 0) << 8) |
			((header[SEED_BYTES[2] as number] ?? 0) << 16) |
			((header[SEED_BYTES[3] as number] ?? 0) << 24)) >>>
		0
	);
}

/** Builds the repeating key table from wherever the generator now stands. */
function keyTable(state: number): Buffer {
	const random = new MsvcRandom(state);
	const table: Buffer = Buffer.alloc(TABLE_SIZE, 0x00);
	for (let index = 0; index < table.length; index += 1) {
		table[index] = random.next() & 0xff;
	}
	return table;
}

/**
 * Reads the header and leaves the generator where the reference leaves it: the scramble and the key table share
 * one sequence, so the table starts after the five hundred and twelve draws the header took.
 */
async function readFields(source: ByteSource): Promise<TimLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const random = new MsvcRandom(foldSeed(header));
		for (let index = HEADER_SIZE / 2; index < HEADER_SIZE; index += 1) {
			header[index] = ((header[index] ?? 0) - (random.next() & 0xff)) & 0xff;
		}
		if (
			header.toString(
				"latin1",
				VERSION_OFFSET,
				VERSION_OFFSET + VERSION.length,
			) !== VERSION
		) {
			return undefined;
		}
		return {
			width: header.readUInt32LE(0x248),
			height: header.readUInt32LE(0x29c),
			stride: header.readInt32LE(0x2ba),
			state: random.state,
		};
	} catch {
		return undefined;
	}
}

/** The probe gates the format on the file's own extension; the reading itself does not. */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<TimLayout | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	return readFields(source);
}

export const timImageDescriptor: FormatDescriptor = {
	id: "slg-tim-image",
	name: "SLG system encrypted image",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Slg/ImageTIM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const timImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: timImageDescriptor,
	// The reference declares no signature at all: the extension and the version string are the whole probe.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid SLG image");
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
		const layout = await readFields(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid SLG image");
		const { width, height, stride } = layout;
		if (stride <= 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SLG image stride");
		}
		const total = stride * height;
		if (total > MAX_IMAGE_BYTES || width * height * 3 > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "SLG image is too large");
		}
		// The reference reads what it asks for and leaves the rest blank, so a short file pads.
		const file = Buffer.from(
			await source.readAt(
				0n,
				Math.min(Number(source.size), HEADER_SIZE + total),
			),
		);
		const stored: Buffer = Buffer.alloc(total, 0x00);
		file.copy(
			stored,
			0,
			HEADER_SIZE,
			Math.min(file.length, HEADER_SIZE + total),
		);
		const table = keyTable(layout.state);
		for (let index = 0; index < stored.length; index += 1) {
			stored[index] =
				((stored[index] ?? 0) - (table[index & (TABLE_SIZE - 1)] ?? 0)) & 0xff;
		}
		// The stored rows may be wider than the pixels they hold; the bitmap's own rows are tight here and the
		// shared writer pads them.
		const tight: Buffer = Buffer.alloc(width * height * 3, 0x00);
		for (let row = 0; row < height; row += 1) {
			stored.copy(
				tight,
				row * width * 3,
				row * stride,
				row * stride + width * 3,
			);
		}
		// The reference hands this image over flipped.
		return Readable.from([writeBmp24(width, height, tight, true)]);
	},
});
