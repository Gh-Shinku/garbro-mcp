// Format reference: GARbro "ArcFormats/Ice/ImageIBM.cs", class `IbmFormat` (Ice Soft compressed bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { unpackTpw } from "../ankh/grp-unpack.js";
import { readBmpHeaderFields } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `TPW` followed by a version byte. */
const SIGNATURE = Buffer.from([0x54, 0x50, 0x57, 0x01]);
/** The declared output length, which is also where the codec's own eight byte prefix ends. */
const UNPACKED_SIZE_POSITION = 4;
const HEADER_SIZE = 8;
/** The probe decompresses exactly a bitmap header, which is what the reference gives its reader. */
const BMP_PREFIX_SIZE = 56;
/** The port's own ceiling on the declared size. */
const MAX_UNPACKED_SIZE = 256 * 1024 * 1024;

interface IbmLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
}

/**
 * The eight bytes before the compressed stream are the marker and the declared size, and the codec the
 * reference calls seeks to offset eight itself — so it is handed the whole file and finds its seed word exactly
 * where this header ends.
 *
 * The probe decompresses only the first fifty six bytes and reads a bitmap header out of them, which is the
 * reference's own metadata path: the same codec call with a header-sized destination. A stream that ends early
 * leaves the rest of that buffer as zeroes, so it fails the header check and the file is declined.
 */
async function readFields(source: ByteSource): Promise<IbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const unpackedSize = stored.readInt32LE(UNPACKED_SIZE_POSITION);
		if (unpackedSize <= 0) return undefined;
		const probe: Buffer = Buffer.alloc(BMP_PREFIX_SIZE, 0x00);
		unpackTpw(stored, probe);
		const fields = readBmpHeaderFields(probe);
		if (!fields) return undefined;
		return { ...fields, unpackedSize };
	} catch {
		return undefined;
	}
}

export const ibmImageDescriptor: FormatDescriptor = {
	id: "ice-ibm-image",
	name: "Ice Soft compressed bitmap",
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
			source: "ArcFormats/Ice/ImageIBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ibmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ibmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ice Soft bitmap");
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
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The output is the decompressed bitmap, whose length is the declared one.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				unpackedSize: layout.unpackedSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ice Soft bitmap");
		if (layout.unpackedSize > MAX_UNPACKED_SIZE) {
			throw new GarbroError("INVALID_ARCHIVE", "Ice Soft bitmap is too large");
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const output: Buffer = Buffer.alloc(layout.unpackedSize, 0x00);
		unpackTpw(stored, output);
		// The reference decodes the result as a bitmap, which fails on anything else. The pixels themselves are
		// not checked here, since the port carries the bitmap over rather than decoding it.
		if (!readBmpHeaderFields(output)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Ice Soft bitmap header",
			);
		}
		return Readable.from([output]);
	},
});
