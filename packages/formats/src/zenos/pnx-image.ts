// Format reference: GARbro "Legacy/Zenos/ImagePNX.cs", class `PnxFormat` (a PNG whose signature is
// replaced; `PngFormat.HeaderBytes` is prepended again). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** `89 50 4E 58`: a PNG signature whose fourth byte is `X`; `0x584E5089` as a little endian word. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x58]);
/** What the reference prepends, replacing the first eight stored bytes wholesale. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** Everything from here on is an untouched PNG, so the chunk offsets do not shift. */
const BODY_OFFSET = 8;
const IHDR_OFFSET = 0x0c;
const WIDTH_OFFSET = 0x10;
const HEIGHT_OFFSET = 0x14;
const BIT_DEPTH_OFFSET = 0x18;
const COLOR_TYPE_OFFSET = 0x19;
/** The stored bytes of a signature plus a complete IHDR chunk. */
const MIN_SIZE = 0x21;
/** Channels per colour type, as defined by the PNG specification. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface PnxLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * GARbro `PnxFormat.DeobfuscateStream`: the first eight bytes are dropped and the standard PNG
 * signature is put in their place, which leaves the rest of the file at its original offsets.
 */
async function readLayout(source: ByteSource): Promise<PnxLayout | undefined> {
	if (source.size < BigInt(MIN_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, MIN_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		// GARbro's PNG reader expects the IHDR chunk first, with its standard length.
		if (header.readUInt32BE(8) !== 13) return undefined;
		if (
			header.subarray(IHDR_OFFSET, IHDR_OFFSET + 4).toString("latin1") !==
			"IHDR"
		)
			return undefined;
		const width = header.readUInt32BE(WIDTH_OFFSET);
		const height = header.readUInt32BE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		const bitDepth = header.readUInt8(BIT_DEPTH_OFFSET);
		const channels = CHANNELS[header.readUInt8(COLOR_TYPE_OFFSET)];
		if (!channels || bitDepth === 0) return undefined;
		return { width, height, bitsPerPixel: channels * bitDepth };
	} catch {
		return undefined;
	}
}

export const pnxImageDescriptor: FormatDescriptor = {
	id: "zenos-pnx-image",
	name: "Obfuscated PNG image",
	extensions: [],
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
			source: "Legacy/Zenos/ImagePNX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pnxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pnxImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Zenos obfuscated PNG image",
			);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: BigInt(BODY_OFFSET),
				size: source.size - BigInt(BODY_OFFSET),
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The eight restored signature bytes are prepended to the stored body.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				encrypted: true,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Zenos obfuscated PNG image",
			);
		// A prefix stream: the standard signature, then the body from offset 8 verbatim.
		const body = Buffer.from(
			await source.readAt(
				BigInt(BODY_OFFSET),
				Number(source.size) - BODY_OFFSET,
			),
		);
		return Readable.from([Buffer.concat([PNG_SIGNATURE, body])]);
	},
});
