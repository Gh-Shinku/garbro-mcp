// Format reference: GARbro "ArcFormats/KScript/ImageKGP.cs", class `KgpFormat` (KScript image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { readPngHeaderFields } from "../shared/png.js";

/** `GRPH` as the stored bytes, which is how the reference's little endian signature reads back. */
const MARKER = "GRPH";
const HEADER_SIZE = 0x1c;
/** Where the graphic starts when the header names no offset of its own. */
const BASE_OFFSET = 0x14;
const PNG_MINIMUM_SIZE = 16 + 13;
/** The reference rounds the offset field down to a multiple of sixteen and then counts in twenty fours. */
const OFFSET_DIVISOR = 0x10;
const OFFSET_STRIDE = 0x18;

interface KgpLayout {
	offset: number;
}

/** The reference's own arithmetic, including the truncating division that makes the offset a coarse one. */
function dataOffset(header: Buffer): number {
	if ((header[0x0c] ?? 0) === 0) return BASE_OFFSET;
	return (
		BASE_OFFSET +
		Math.trunc(header.readInt32LE(0x10) / OFFSET_DIVISOR) * OFFSET_STRIDE
	);
}

async function readLayout(source: ByteSource): Promise<KgpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.toString("latin1", 0, 4) !== MARKER) return undefined;
		const offset = dataOffset(header);
		// A region that starts outside the file holds nothing, which is where the reference's own graphic
		// reader gives up.
		if (offset < 0 || BigInt(offset) > source.size) return undefined;
		if (source.size - BigInt(offset) < BigInt(PNG_MINIMUM_SIZE))
			return undefined;
		const region = Buffer.from(
			await source.readAt(BigInt(offset), PNG_MINIMUM_SIZE),
		);
		// The header's fourth and fifth bytes are xored to make the single byte key for the whole graphic.
		const key = (header[4] ?? 0) ^ (header[5] ?? 0);
		const fields = readPngHeaderFields(xorRegion(region, key));
		if (!fields) return undefined;
		return { offset };
	} catch {
		return undefined;
	}
}

function xorRegion(input: Buffer, key: number): Buffer {
	const output: Buffer = Buffer.alloc(input.length);
	for (let index = 0; index < input.length; index += 1) {
		output[index] = (input[index] ?? 0) ^ key;
	}
	return output;
}

export const kgpImageDescriptor: FormatDescriptor = {
	id: "kscript-kgp-image",
	name: "KScript image",
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
			source: "ArcFormats/KScript/ImageKGP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kgpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kgpImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(MARKER, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KScript image");
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const key = (header[4] ?? 0) ^ (header[5] ?? 0);
		const region = Buffer.from(
			await source.readAt(BigInt(layout.offset), PNG_MINIMUM_SIZE),
		);
		const fields = readPngHeaderFields(xorRegion(region, key));
		if (!fields)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KScript image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const size = source.size - BigInt(layout.offset);
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				// The graphic is the region the header points at, not the whole file.
				offset: BigInt(layout.offset),
				size,
				compressed: false,
				metadata: {
					type: "image",
					width: fields.width,
					height: fields.height,
					bitsPerPixel: fields.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KScript image");
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const key = (header[4] ?? 0) ^ (header[5] ?? 0);
		// The reference reads from the offset to the end of the file, so the port takes the rest of the source.
		const region = Buffer.from(
			await source.readAt(
				BigInt(layout.offset),
				Number(source.size) - layout.offset,
			),
		);
		const plain = xorRegion(region, key);
		if (!readPngHeaderFields(plain)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KScript image");
		}
		// The reference decodes the graphic; the port hands the decrypted original over, which keeps every
		// chunk. The offset fields the reference reads are not carried: the port's image metadata has none.
		return Readable.from([plain]);
	},
});
