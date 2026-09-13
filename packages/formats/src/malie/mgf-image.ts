// Format reference: GARbro "ArcFormats/Malie/ImageMGF.cs", class `MgfFormat extends PngFormat` (a PNG whose
// eight byte signature has been overwritten with an engine tag). GARbro commit
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

/** `Mali`, the first four bytes of the tag. */
const SIGNATURE = Buffer.from([0x4d, 0x61, 0x6c, 0x69]);
/** `MalieGF`, which the reference compares as a seven character prefix. */
const TAG = Buffer.from("MalieGF", "ascii");
/** The tag occupies eight bytes in the file: the reference's writer puts a zero after the seven characters. */
const TAG_SIZE = 8;
/** What the tag replaced: the eight byte PNG signature. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const IHDR_OFFSET = 8;
/** The header the reference reads, up to the colour type of the first chunk. */
const HEADER_SIZE = 26;
const IHDR_LENGTH = 13;
/** Channels per pixel for each PNG colour type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

interface MgfLayout {
	width: number;
	height: number;
	/** Absent for a colour type the PNG specification does not define. */
	bitsPerPixel?: number;
}

/**
 * `ReadMetaData` reads eight bytes, checks that they spell `MalieGF`, replaces them with the PNG signature and
 * hands the rest of the file to the PNG reader. Everything the PNG reader sees is therefore the file from offset
 * eight onward, which is why the chunk length, the chunk type and the image header all sit at the offsets a PNG
 * would have them at: the replacement is exactly as long as what it replaced.
 *
 * Note that the reference compares seven characters, so the eighth byte of the tag is never checked even though
 * its own writer puts a zero there.
 */
async function readLayout(source: ByteSource): Promise<MgfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, TAG.length).equals(TAG)) return undefined;
		if (header.readUInt32BE(IHDR_OFFSET) !== IHDR_LENGTH) return undefined;
		if (header.subarray(12, 16).toString("latin1") !== "IHDR") return undefined;
		const width = header.readUInt32BE(16);
		const height = header.readUInt32BE(20);
		// A PNG decoder would reject these; nothing can be drawn from them.
		if (width === 0 || height === 0) return undefined;
		const bitDepth = header[24] ?? 0;
		const channels = CHANNELS[header[25] ?? -1];
		const layout: MgfLayout = { width, height };
		if (channels !== undefined) layout.bitsPerPixel = bitDepth * channels;
		return layout;
	} catch {
		return undefined;
	}
}

export const mgfImageDescriptor: FormatDescriptor = {
	id: "malie-mgf-image",
	name: "Malie engine image",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		// The reference can write, by wrapping the PNG it produces in the same tag.
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Malie/ImageMGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mgfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mgfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Malie MGF image");
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
					...(layout.bitsPerPixel === undefined
						? {}
						: { bitsPerPixel: layout.bitsPerPixel }),
				} as Record<string, unknown>,
			}),
			// Eight bytes are replaced by eight bytes, so the extraction is the same length as the source.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				width: layout.width,
				height: layout.height,
				tag: TAG.toString("latin1"),
				prefixSize: TAG_SIZE,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if ((await readLayout(source)) === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Malie MGF image");
		// The stored bytes from offset eight onward are a PNG from its eighth byte; putting the signature back
		// is the whole of the conversion, and every other byte is carried through untouched.
		const rest = Buffer.from(
			await source.readAt(BigInt(TAG_SIZE), Number(source.size) - TAG_SIZE),
		);
		return Readable.from([Buffer.concat([PNG_SIGNATURE, rest])]);
	},
});
