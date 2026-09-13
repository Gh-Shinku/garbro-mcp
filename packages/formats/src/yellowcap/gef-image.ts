// Format reference: GARbro "Legacy/YellowCap/ImageGEF.cs", class `GefFormat` (a sixteen byte header in
// front of an embedded PNG). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The reference lists the base signature and a variant whose fourth byte is set. */
const SIGNATURE = 0x00010100;
const VARIANT_SIGNATURE = 0xff010100;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
/** The whole embedded PNG, signature included, starts here. */
const PNG_OFFSET = 0xc;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const IHDR_LENGTH_OFFSET = PNG_OFFSET + 8;
const IHDR_TYPE_OFFSET = PNG_OFFSET + 0xc;
const PNG_WIDTH_OFFSET = PNG_OFFSET + 0x10;
const PNG_HEIGHT_OFFSET = PNG_OFFSET + 0x14;
const BIT_DEPTH_OFFSET = PNG_OFFSET + 0x18;
const COLOUR_TYPE_OFFSET = PNG_OFFSET + 0x19;
/** Signature, IHDR chunk header and the thirteen byte IHDR body, all after the sixteen byte header. */
const MIN_SIZE = PNG_OFFSET + 0x1d;
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface GefLayout {
	width: number;
	height: number;
	bitDepth: number;
	colourType: number;
	channels: number;
	bitsPerPixel: number;
	dataOffset: number;
	dataSize: number;
}

/**
 * GARbro `GefFormat.ReadMetaData` reads the header, requires the PNG signature at 0xC and then reads the
 * PNG metadata at that position, checking that its dimensions agree with the header's own copy.
 */
async function readLayout(source: ByteSource): Promise<GefLayout | undefined> {
	if (source.size < BigInt(MIN_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, MIN_SIZE));
		const signature = header.readUInt32LE(0);
		if (signature !== SIGNATURE && signature !== VARIANT_SIGNATURE)
			return undefined;
		if (!header.subarray(PNG_OFFSET, PNG_OFFSET + 4).equals(PNG_SIGNATURE))
			return undefined;
		if (header.readUInt32BE(IHDR_LENGTH_OFFSET) !== 13) return undefined;
		if (
			header.toString("latin1", IHDR_TYPE_OFFSET, IHDR_TYPE_OFFSET + 4) !==
			"IHDR"
		)
			return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		// The embedded PNG has to agree with the header, which the reference checks too.
		if (header.readUInt32BE(PNG_WIDTH_OFFSET) !== width) return undefined;
		if (header.readUInt32BE(PNG_HEIGHT_OFFSET) !== height) return undefined;
		const bitDepth = header.readUInt8(BIT_DEPTH_OFFSET);
		const colourType = header.readUInt8(COLOUR_TYPE_OFFSET);
		const channels = CHANNELS[colourType];
		if (channels === undefined) return undefined;
		return {
			width,
			height,
			bitDepth,
			colourType,
			channels,
			bitsPerPixel: bitDepth * channels,
			dataOffset: PNG_OFFSET,
			dataSize: Number(source.size) - PNG_OFFSET,
		};
	} catch {
		return undefined;
	}
}

export const gefImageDescriptor: FormatDescriptor = {
	id: "yellowcap-gef-image",
	name: "PNG-embedded image format",
	extensions: ["gef"],
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
			source: "Legacy/YellowCap/ImageGEF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gefImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gefImageDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from([0x00, 0x01, 0x01, 0x00]) },
			{ bytes: Buffer.from([0x00, 0x01, 0x01, 0xff]) },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YellowCap GEF image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.dataSize),
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The embedded stream is the PNG itself, so the listed size is the extracted size.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				width: layout.width,
				height: layout.height,
				bitDepth: layout.bitDepth,
				colorType: layout.colourType,
				channels: layout.channels,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid YellowCap GEF image");
		// Everything from 0xC to the end of the file is the PNG, so no rewriting is needed.
		const png = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		return Readable.from([png]);
	},
});
