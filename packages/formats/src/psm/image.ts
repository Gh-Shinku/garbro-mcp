// Format reference: GARbro "ArcFormats/ImagePSM.cs", class `PsmFormat` (a PNG whose first byte was
// replaced, so `PngFormat.ReadMetaData` still describes it). GARbro commit
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

/** The first byte of a PNG, replaced by `0xED`; `0x474E50ED` as a little endian word. */
const SIGNATURE = Buffer.from([0xed, 0x50, 0x4e, 0x47]);
/** What the stored bytes look like once the first byte is put back. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IHDR_OFFSET = 0x0c;
const WIDTH_OFFSET = 0x10;
const HEIGHT_OFFSET = 0x14;
const BIT_DEPTH_OFFSET = 0x18;
const COLOR_TYPE_OFFSET = 0x19;
/** Signature and a complete IHDR chunk, which is the least a usable PNG can hold. */
const MIN_SIZE = 0x21;
const OBSCURED_PREFIX = 4;
/** Channels per colour type, as defined by the PNG specification. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface PsmLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The stored payload: everything after the four byte prefix. */
	payloadOffset: number;
	payloadSize: number;
}

/**
 * GARbro restores the PNG signature byte, then reads the header as a PNG, so the dimensions and the
 * bit depth come from the IHDR chunk.
 */
async function readLayout(source: ByteSource): Promise<PsmLayout | undefined> {
	if (source.size < BigInt(MIN_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, MIN_SIZE));
		// The registry gate matches the obscured byte; re-checking it here keeps this format from
		// claiming a plain PNG, which the reference would parse if it were called directly.
		if (header[0] !== SIGNATURE[0]) return undefined;
		// The reference replaces the stored first byte with the PNG one, and checks nothing else.
		header[0] = PNG_SIGNATURE[0] ?? 0x89;
		if (!header.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
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
		return {
			width,
			height,
			bitsPerPixel: channels * bitDepth,
			payloadOffset: OBSCURED_PREFIX,
			payloadSize: Number(source.size) - OBSCURED_PREFIX,
		};
	} catch {
		return undefined;
	}
}

export const psmImageDescriptor: FormatDescriptor = {
	id: "psm-image",
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
			source: "ArcFormats/ImagePSM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const psmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: psmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid obfuscated PNG image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: BigInt(layout.payloadOffset),
				size: BigInt(layout.payloadSize),
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The restored signature byte is prepended to the stored payload.
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid obfuscated PNG image");
		// GARbro builds a prefix stream: the four byte header with the repaired signature, then the
		// body verbatim, so the result is the original PNG at the original length.
		const head = Buffer.from(await source.readAt(0n, layout.payloadOffset));
		head[0] = PNG_SIGNATURE[0] ?? 0x89;
		const body = Buffer.from(
			await source.readAt(BigInt(layout.payloadOffset), layout.payloadSize),
		);
		return Readable.from([Buffer.concat([head, body])]);
	},
});
