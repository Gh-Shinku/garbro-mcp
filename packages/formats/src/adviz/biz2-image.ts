// Format reference: GARbro "Legacy/Adviz/ImageBIZ2.cs", class `Biz2Format`
// ([000225][Sorciere] Karei, [011012][Ange] Nyuunyuu). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Two dimensions behind the marker, and then one LZSS stream holding colour and maybe alpha. */
const HEADER_SIZE = 8;
const MARKER = "BIZ2";
const DATA_OFFSET = 8;
/** The port's own ceiling on a decoded image. */
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface Biz2Layout {
	width: number;
	height: number;
	/** Three bytes a pixel, which is the size of the alpha plane too when there is one. */
	planeSize: number;
}

async function readLayout(source: ByteSource): Promise<Biz2Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.toString("latin1", 0, 4) !== MARKER) return undefined;
		const width = header.readUInt16LE(4);
		const height = header.readUInt16LE(6);
		return { width, height, planeSize: width * height * 3 };
	} catch {
		return undefined;
	}
}

export const biz2ImageDescriptor: FormatDescriptor = {
	id: "adviz-biz2-image",
	name: "ADVIZ engine compressed image",
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
			source: "Legacy/Adviz/ImageBIZ2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const biz2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: biz2ImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARKER, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ADVIZ image");
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
					bitsPerPixel: 24,
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
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ADVIZ image");
		const { width, height, planeSize } = layout;
		if (planeSize * 2 > MAX_IMAGE_BYTES) {
			throw new GarbroError("INVALID_ARCHIVE", "ADVIZ image is too large");
		}
		// One stream holds the colour plane and, if the image has one, an alpha plane of the same size.
		const decoded = inflateLzss(
			Buffer.from(
				await source.readAt(
					BigInt(DATA_OFFSET),
					Number(source.size) - DATA_OFFSET,
				),
			),
			{ outputLength: planeSize * 2 },
		);
		if (decoded.length < planeSize) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ADVIZ image holds less colour than it declares",
			);
		}
		const rest = decoded.length - planeSize;
		if (rest === 0) {
			return Readable.from([
				// The reference hands the rows over flipped.
				writeBmp24(width, height, decoded.subarray(0, planeSize), true),
			]);
		}
		// Anything left over is read as a whole alpha plane, so a partial one fails.
		if (rest < planeSize) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ADVIZ image holds a partial alpha plane",
			);
		}
		const rgb = decoded.subarray(0, planeSize);
		const alpha = decoded.subarray(planeSize, planeSize * 2);
		// Four bytes a pixel, which is not the colour plane's size but the pixel count's.
		const output: Buffer = Buffer.alloc(width * height * 4, 0x00);
		// The alpha plane is read at the colour plane's own pace, so only every third of its bytes is used.
		for (let src = 0; src < planeSize; src += 3) {
			output[(src / 3) * 4] = rgb[src] ?? 0;
			output[(src / 3) * 4 + 1] = rgb[src + 1] ?? 0;
			output[(src / 3) * 4 + 2] = rgb[src + 2] ?? 0;
			output[(src / 3) * 4 + 3] = alpha[src] ?? 0;
		}
		return Readable.from([writeBmp32(width, height, output, true)]);
	},
});
