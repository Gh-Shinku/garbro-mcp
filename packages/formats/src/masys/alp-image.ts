// Format reference: GARbro "ArcFormats/Masys/ImageALP.cs", class `AlpFormat` (tag `ALP/MEGU`, a
// control-byte stream that expands into an eight bit grey alpha mask). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ALPd", "ascii");
const HEADER_SIZE = 0x15;
const RESERVED_OFFSET = 4;
const WIDTH_OFFSET = 5;
const HEIGHT_OFFSET = 9;
const UNPACKED_SIZE_OFFSET = 0x11;
/** Six bit samples are expanded to eight bits by `value * 0xFF / 0x40`, truncated to a byte. */
const SCALE_NUMERATOR = 0xff;
const SCALE_DENOMINATOR = 0x40;
/** A control byte with this bit set introduces a run whose length is the following word. */
const RUN_FLAG = 0x80;
/** The control byte's low seven bits are the sample value, so its mask is not `0xFF`. */
const VALUE_MASK = 0x7f;
/** Guards against a hostile header asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

interface AlpLayout {
	width: number;
	height: number;
	unpackedSize: number;
	dataOffset: number;
	dataSize: number;
}

/**
 * `AlpFormat.ReadMetaData`: a twenty one byte header whose fifth byte must be zero, then the dimensions
 * and the decompressed size. The stream that follows is read on demand, so the stored payload runs to
 * the end of the file.
 */
async function readLayout(source: ByteSource): Promise<AlpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		if (header.readUInt8(RESERVED_OFFSET) !== 0) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
		const unpackedSize = header.readUInt32LE(UNPACKED_SIZE_OFFSET);
		if (unpackedSize > MAX_OUTPUT) return undefined;
		// The reference allocates this many bytes and hands them to the image as its pixels, so a size
		// that disagrees with the dimensions describes no image.
		if (BigInt(unpackedSize) !== BigInt(width) * BigInt(height))
			return undefined;
		return {
			width,
			height,
			unpackedSize,
			dataOffset: HEADER_SIZE,
			dataSize: Number(source.size) - HEADER_SIZE,
		};
	} catch {
		return undefined;
	}
}

/**
 * `AlpFormat.Unpack`: each control byte carries a six bit sample in its low bits; the top bit selects a
 * run whose little endian length follows, otherwise a single sample is emitted. The loop stops when the
 * output is full, so a stream that ends early simply leaves the remaining samples zero — which the
 * reference allows because it breaks on end of input.
 */
function unpack(stream: Buffer, outputSize: number): Buffer | undefined {
	const output: Buffer = Buffer.alloc(outputSize);
	let dst = 0;
	let pos = 0;
	while (dst < output.length) {
		if (pos >= stream.length) break;
		const control = stream.readUInt8(pos);
		pos += 1;
		const value =
			Math.trunc(
				((control & VALUE_MASK) * SCALE_NUMERATOR) / SCALE_DENOMINATOR,
			) & 0xff;
		if ((control & RUN_FLAG) !== 0) {
			if (pos + 2 > stream.length) return undefined;
			const count = stream.readUInt16LE(pos);
			pos += 2;
			// The reference would write past the buffer and throw, so an overrunning run is declined.
			if (dst + count > output.length) return undefined;
			output.fill(value, dst, dst + count);
			dst += count;
		} else {
			output[dst] = value;
			dst += 1;
		}
	}
	return output;
}

export const masysAlpImageDescriptor: FormatDescriptor = {
	id: "masys-alp-image",
	name: "Masys alpha channel bitmap",
	extensions: ["alp"],
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
			source: "ArcFormats/Masys/ImageALP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const masysAlpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: masysAlpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Masys ALP image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.dataSize),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// The payload is a control stream for a bitmap of a different length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
				unpackedSize: layout.unpackedSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Masys ALP image");
		const stream = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		const pixels = unpack(stream, layout.unpackedSize);
		if (!pixels)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Masys ALP image");
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		return Readable.from([
			writeBmp8(layout.width, layout.height, pixels, false),
		]);
	},
});
