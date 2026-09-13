// Format reference: GARbro "Legacy/UMeSoft/ImageIKE.cs", class `IkeFormat` (ike-compressed bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { decodeIkeSize, unpackIke } from "./ike.js";

/** `0x6B69899D` little endian, the same tag the ike audio format registers. */
const SIGNATURE = Buffer.from([0x9d, 0x89, 0x69, 0x6b]);
const HEADER_SIZE = 0x11;
/** Where the codec starts; its first literal lands at 0x0F, as it does for the audio format. */
const STREAM_OFFSET = 0x0d;
const BITMAP_MARKER_OFFSET = 0x0f;
const BITMAP_MARKER = "BM";
const SIZE_BYTES_OFFSET = 10;
/** `ReadMetaData` decompresses exactly a bitmap header to ask the bitmap reader about it. */
const PROBE_SIZE = 0x36;
const BMP_HEADER_SIZE = 54;
const MAX_UNPACKED_SIZE = 0x4000000;

interface IkeImageLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
}

/**
 * `ReadMetaData` reads seventeen bytes and requires two markers: `ike` at offset two and `BM` at offset
 * fifteen. The second of those is the first literal of the compressed stream — the codec starts at 0x0D and
 * its first two bytes are a flag word — so the check says the decompressed data is a bitmap, and it is also
 * what separates this format from the ike audio format, which registers the *same* signature and expects
 * `RIFF` at the same offset.
 *
 * The probe decompresses only the fifty four bytes of a bitmap header, and the port does the same: the header
 * is parsed here, so a declared size that covers only the header still lists and fails later.
 */
async function readFields(
	source: ByteSource,
): Promise<IkeImageLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		if (head.toString("latin1", 2, 5) !== "ike") return undefined;
		if (
			head.toString(
				"latin1",
				BITMAP_MARKER_OFFSET,
				BITMAP_MARKER_OFFSET + 2,
			) !== BITMAP_MARKER
		)
			return undefined;
		const unpackedSize = decodeIkeSize(
			head[SIZE_BYTES_OFFSET] ?? 0,
			head[SIZE_BYTES_OFFSET + 1] ?? 0,
			head[SIZE_BYTES_OFFSET + 2] ?? 0,
		);
		if (unpackedSize > MAX_UNPACKED_SIZE) return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const probe = unpackIke(stored, PROBE_SIZE);
		if (probe.length < BMP_HEADER_SIZE) return undefined;
		if (probe.toString("latin1", 0, 2) !== BITMAP_MARKER) return undefined;
		const dibSize = probe.readUInt32LE(14);
		if (dibSize < 40) return undefined;
		const width = probe.readUInt32LE(18);
		const height = probe.readInt32LE(22);
		const bitsPerPixel = probe.readUInt16LE(28);
		if (width === 0 || height === 0) return undefined;
		return {
			width,
			height: Math.abs(height),
			bitsPerPixel,
			unpackedSize,
		};
	} catch {
		return undefined;
	}
}

export const ikeImageDescriptor: FormatDescriptor = {
	id: "ume-soft-ike-image",
	name: "ike-compressed bitmap",
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
			source: "Legacy/UMeSoft/ImageIKE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikeImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikeImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Ike bitmap");
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
			// The extraction is decompressed, so its length is not the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "ike",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid Ike bitmap");
		if (layout.unpackedSize < BMP_HEADER_SIZE)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated Ike bitmap");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(STREAM_OFFSET),
				Number(source.size) - STREAM_OFFSET,
			),
		);
		const decoded = unpackIke(stored, layout.unpackedSize);
		// This project has no bitmap decoder to hand, so the surface is passed through as it stands, the way
		// the Malie MGF and Palette PGA readers pass theirs through. The metadata check is what the reference's
		// `Bmp.Read` does first, so a declared size that stops inside the header fails here.
		if (!readBmpMetaData(decoded))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ike bitmap data");
		return Readable.from([decoded]);
	},
});
