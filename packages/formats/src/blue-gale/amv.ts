// Format reference: GARBro ArcFormats/BlueGale/VideoAMV.cs, class `AmvOpener`. The frame payloads are
// decoded with `ZbmFormat.Unpack` from ArcFormats/BlueGale/ImageZBM.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { unpackZbm } from "./zbm.js";

const SIGNATURE = Buffer.from("ampV", "ascii");
const VERSION_OFFSET = 4;
const VERSION = 1;
const UNPACKED_SIZE_OFFSET = 0x16;
const WIDTH_OFFSET = 0x1a;
const HEIGHT_OFFSET = 0x1e;
const COUNT_OFFSET = 0x2a;
const FRAME_START = 0x32;
const FRAME_SIZE_FIELD = 4;
const NAME_WIDTH = 4;
/** Every frame expands into a bitmap file header plus a bitmap info header. */
const BMP_HEADER_SIZE = 0x36;
/** `ZbmFormat.Unpack` is asked to fill the buffer from behind the file header. */
const ZBM_DESTINATION = 0xe;
/** The synthesized bitmap records its own size and the size of the info header. */
const BMP_MARKER = Buffer.from("BM", "ascii");
const TOTAL_SIZE_OFFSET = 2;
const INFO_SIZE_OFFSET = 0xa;

/**
 * GARBro `AmvOpener.TryOpen`. The `ampV` signature is followed by a version word that must be one, and
 * the header carries a frame-sized unpacked size at 0x16, the frame geometry, and a frame count at
 * 0x2A. Frames begin at 0x32 and are a 32-bit stored size followed by that many bytes of compressed
 * image data; the walk advances by the size field plus the frame size.
 *
 * Frames are named `<base>#<index>.bmp` and typed as images. Every frame declares the same unpacked
 * size — the header's unpacked size plus one bitmap header — which is what the synthesized bitmap
 * reports as its total length.
 */
async function readAmvIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<
	{ entries: FixedEntry[]; width: number; height: number } | undefined
> {
	if (source.size < BigInt(FRAME_START)) return undefined;
	const header = await source.readAt(0n, FRAME_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (header.readInt16LE(VERSION_OFFSET) !== VERSION) return undefined;
	const unpackedSize =
		BigInt(header.readUInt32LE(UNPACKED_SIZE_OFFSET)) + BigInt(BMP_HEADER_SIZE);
	const width = header.readUInt32LE(WIDTH_OFFSET);
	const height = header.readUInt32LE(HEIGHT_OFFSET);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const baseName = basename(sourcePath ?? "").replace(/\.[^.]*$/, "") || "amv";
	const entries: FixedEntry[] = [];
	let frameOffset = BigInt(FRAME_START);
	for (let id = 0; id < count; id += 1) {
		if (frameOffset + BigInt(FRAME_SIZE_FIELD) > source.size) return undefined;
		const storedSize = BigInt(
			(await source.readAt(frameOffset, FRAME_SIZE_FIELD)).readUInt32LE(0),
		);
		const payloadOffset = frameOffset + BigInt(FRAME_SIZE_FIELD);
		if (!checkPlacement(payloadOffset, storedSize, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(NAME_WIDTH, "0")}.bmp`,
				),
				offset: payloadOffset,
				size: unpackedSize,
				packedSize: storedSize,
				compressed: true,
				metadata: { type: "image", width, height },
			}),
		);
		frameOffset = payloadOffset + storedSize;
	}
	return { entries, width, height };
}

/**
 * GARBro `AmvOpener.OpenEntry`. The compressed frame fills a buffer the size of one bitmap, starting
 * behind its file header, and the reference then writes that header: the `BM` marker, the total buffer
 * length at offset two, and the info header size — read back from the decoded data — at offset ten.
 */
const amvEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	const output = Buffer.alloc(Number(entry.size));
	unpackZbm(stored, output, ZBM_DESTINATION);
	BMP_MARKER.copy(output, 0);
	output.writeUInt32LE(output.length, TOTAL_SIZE_OFFSET);
	output.writeUInt32LE(
		output.readUInt32LE(ZBM_DESTINATION) + ZBM_DESTINATION,
		INFO_SIZE_OFFSET,
	);
	return Readable.from([output]);
};

export const blueGaleAmvDescriptor: FormatDescriptor = {
	id: "bluegale-amv",
	name: "BlueGale animation format",
	extensions: ["amv"],
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
			source: "ArcFormats/BlueGale/VideoAMV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const blueGaleAmvFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blueGaleAmvDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readAmvIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readAmvIndex(source, sourcePath);
		if (!result)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AMPV layout");
		return {
			entries: result.entries,
			metadata: {
				entryCount: result.entries.length,
				width: result.width,
				height: result.height,
			},
		};
	},
	openEntry: amvEntryOpener,
});
