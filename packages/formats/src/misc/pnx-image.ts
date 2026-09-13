// Format reference: GARbro "ArcFormats/ImagePNX.cs", class `PnxFormat` in the `Misc` namespace (a PNG
// stream whose every byte is XORed with a key derived from the signature). GARbro commit
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

/**
 * `PnxFormat.Signature` is `0x2F2638E1`, i.e. the bytes `E1 38 26 2F`: the PNG magic with its first byte
 * XORed by the key.
 */
const SIGNATURE = Buffer.from([0xe1, 0x38, 0x26, 0x2f]);
const PNG_FIRST_BYTE = 0x89;
/**
 * `PnxFormat.GuessEncryptionKey` is `(byte)(Signature ^ 0x89)`, which takes the low byte of the signature
 * and so always yields the same constant. Deriving it the same way keeps the relation explicit.
 */
const KEY = (SIGNATURE[0] as number) ^ PNG_FIRST_BYTE;
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IHDR_LENGTH_OFFSET = 8;
const IHDR_TYPE_OFFSET = 0xc;
const WIDTH_OFFSET = 0x10;
const HEIGHT_OFFSET = 0x14;
const BIT_DEPTH_OFFSET = 0x18;
const COLOUR_TYPE_OFFSET = 0x19;
const IHDR_LENGTH = 13;
/** Signature, IHDR chunk header and the thirteen byte IHDR body: 8 + 8 + 13. */
const MIN_SIZE = 0x1d;
/** Samples per pixel for the PNG colour types, as the reference's metadata reader computes them. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface PnxLayout {
	width: number;
	height: number;
	bitDepth: number;
	colourType: number;
	channels: number;
	bitsPerPixel: number;
}

function xorInPlace(data: Buffer): Buffer {
	for (let i = 0; i < data.length; i += 1) data[i] = (data[i] as number) ^ KEY;
	return data;
}

/**
 * GARbro reads the metadata through `PngFormat.ReadMetaData` on the deobfuscated stream, so the port
 * decrypts the header prefix and applies the same field checks.
 */
async function readLayout(source: ByteSource): Promise<PnxLayout | undefined> {
	if (source.size < BigInt(MIN_SIZE)) return undefined;
	try {
		const header = xorInPlace(Buffer.from(await source.readAt(0n, MIN_SIZE)));
		if (!header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
			return undefined;
		if (header.readUInt32BE(IHDR_LENGTH_OFFSET) !== IHDR_LENGTH)
			return undefined;
		if (
			header.toString("latin1", IHDR_TYPE_OFFSET, IHDR_TYPE_OFFSET + 4) !==
			"IHDR"
		)
			return undefined;
		const width = header.readUInt32BE(WIDTH_OFFSET);
		const height = header.readUInt32BE(HEIGHT_OFFSET);
		if (width === 0 || height === 0) return undefined;
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
		};
	} catch {
		return undefined;
	}
}

export const pnxEncryptedImageDescriptor: FormatDescriptor = {
	id: "misc-pnx-image",
	name: "Encrypted PNG image",
	extensions: ["pnx"],
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
			source: "ArcFormats/ImagePNX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pnxEncryptedImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pnxEncryptedImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid encrypted PNG image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					encrypted: true,
				} as Record<string, unknown>,
			}),
			// The stream cipher preserves the length, so the listed size is the extracted size.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				encrypted: true,
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid encrypted PNG image");
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// `XoredStream` covers the whole file, so decryption is a plain XOR that keeps the length.
		return Readable.from([xorInPlace(stored)]);
	},
});
