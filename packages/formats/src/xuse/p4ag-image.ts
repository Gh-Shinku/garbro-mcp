// Format reference: GARbro "ArcFormats/Xuse/ImageP.cs", class `P4AGFormat` (a PNG whose first two
// signature bytes were dropped). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The first two bytes of a PNG, stored verbatim; the file starts with the remaining four. */
const SIGNATURE = Buffer.from([0x4e, 0x47, 0x0d, 0x0a]);
const PNG_PREFIX = Buffer.from([0x89, 0x50]);
/** What the stored bytes look like once the prefix is put back. */
const STORED_SIGNATURE = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_OFFSET = 0x0a;
const WIDTH_OFFSET = 0x0e;
const HEIGHT_OFFSET = 0x12;
const BIT_DEPTH_OFFSET = 0x16;
const COLOR_TYPE_OFFSET = 0x17;
/** The stored bytes of a signature plus a complete IHDR chunk. */
const MIN_SIZE = 0x1f;
/** Channels per colour type, as defined by the PNG specification. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface P4agLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * GARbro prepends two bytes and hands the result to the PNG reader, so the dimensions and the bit
 * depth come from the IHDR chunk, which sits two bytes earlier than in a plain PNG.
 */
async function readLayout(source: ByteSource): Promise<P4agLayout | undefined> {
	if (source.size < BigInt(MIN_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, MIN_SIZE));
		// The registry gate matches the stored word; re-checking it keeps a plain PNG out.
		if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		if (!stored.subarray(2, 6).equals(STORED_SIGNATURE)) return undefined;
		// GARbro's PNG reader expects the IHDR chunk first, with its standard length.
		if (stored.readUInt32BE(6) !== 13) return undefined;
		if (
			stored.subarray(IHDR_OFFSET, IHDR_OFFSET + 4).toString("latin1") !==
			"IHDR"
		)
			return undefined;
		const width = stored.readUInt32BE(WIDTH_OFFSET);
		const height = stored.readUInt32BE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		const bitDepth = stored.readUInt8(BIT_DEPTH_OFFSET);
		const channels = CHANNELS[stored.readUInt8(COLOR_TYPE_OFFSET)];
		if (!channels || bitDepth === 0) return undefined;
		return { width, height, bitsPerPixel: channels * bitDepth };
	} catch {
		return undefined;
	}
}

export const p4agImageDescriptor: FormatDescriptor = {
	id: "xuse-p4ag-image",
	name: "Xuse/Eternal obfuscated PNG image",
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
			source: "ArcFormats/Xuse/ImageP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const p4agImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: p4agImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Xuse obfuscated PNG image",
			);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The two restored signature bytes are prepended to the stored payload.
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
				"Invalid Xuse obfuscated PNG image",
			);
		// GARbro builds a prefix stream: the missing signature bytes, then the file verbatim.
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		return Readable.from([Buffer.concat([PNG_PREFIX, stored])]);
	},
});
