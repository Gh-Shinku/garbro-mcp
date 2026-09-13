// Format reference: GARbro "Legacy/Mutation/ImageRBM.cs", class `RbmFormat` (Mutation compressed image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `RBM`; the reference's signature has a zero high byte, so only these three are compared. */
const SIGNATURE = Buffer.from([0x52, 0x42, 0x4d]);
const HEADER_SIZE = 10;
const BITS_PER_PIXEL = 24;
const BYTES_PER_PIXEL = 3;

interface RbmLayout {
	width: number;
	height: number;
}

/**
 * The reference reads ten bytes and takes the dimensions from them; there is no validation at all, so even a
 * degenerate size is accepted here and fails later, if at all.
 */
async function readFields(source: ByteSource): Promise<RbmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		return { width: header.readUInt16LE(6), height: header.readUInt16LE(8) };
	} catch {
		return undefined;
	}
}

export const rbmImageDescriptor: FormatDescriptor = {
	id: "mutation-rbm-image",
	name: "Mutation compressed image",
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
			source: "Legacy/Mutation/ImageRBM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rbmImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rbmImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mutation image");
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
			// The output is a bitmap, so it has a header the stored data does not.
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
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mutation image");
		const stride = layout.width * BYTES_PER_PIXEL;
		const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		let position = HEADER_SIZE;
		let dst = 0;
		let control = 0;
		let mask = 0;
		while (dst < pixels.length) {
			// The mask is shifted before it is tested, so a fresh byte starts at its most significant bit.
			mask >>= 1;
			if (mask === 0) {
				if (position >= stored.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Truncated Mutation bitmap");
				}
				control = stored[position] ?? 0;
				position += 1;
				mask = 0x80;
			}
			if ((control & mask) !== 0) {
				if (position + 2 > stored.length) {
					throw new GarbroError("INVALID_ARCHIVE", "Truncated Mutation bitmap");
				}
				const word = stored.readUInt16LE(position);
				position += 2;
				const count = ((word & 0x0f) + 1) * BYTES_PER_PIXEL;
				const offset = ((word >> 4) + 1) * BYTES_PER_PIXEL;
				const from = dst - offset;
				if (from < 0) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Mutation bitmap match starts before the image",
					);
				}
				// The copy may overlap its own output, so it is done a byte at a time — and the reference's
				// array copy would run past the end of the image if a match asked for more than is left.
				for (let index = 0; index < count; index += 1) {
					if (dst + index >= pixels.length) {
						throw new GarbroError(
							"INVALID_ARCHIVE",
							"Mutation bitmap match overruns the image",
						);
					}
					pixels[dst + index] = pixels[from + index] ?? 0;
				}
				dst += count;
			} else {
				// A literal is a whole pixel; the reference ignores how much its read returned, so a stream that
				// ends mid pixel leaves the rest of it as zero.
				const available = Math.min(BYTES_PER_PIXEL, stored.length - position);
				for (let index = 0; index < available; index += 1) {
					pixels[dst + index] = stored[position + index] ?? 0;
				}
				position += available;
				dst += BYTES_PER_PIXEL;
			}
		}
		// `CreateFlipped` means bottom up rows under a positive height, and the stored stride is exactly three
		// bytes a pixel — tighter than a bitmap's — so the writer pads every row.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
