// Format reference: GARbro "Legacy/Tigerman/ImageCHR.cs", classes `ChrFormat` and `ChrMetaData`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferByteSource,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	type ZitLayout,
	readZitImageLayout,
	renderZitImage,
} from "../silky/zit-image.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference declares no word of its own — its picture is another format's picture carried inside it — but it
 * registers one word besides nothing, and its three extensions. A file of one of those extensions, or one that
 * begins with that word, is offered to it, and the picture behind the offsets decides whether it is one of its
 * own after all.
 */
const EXTENSIONS = ["chr", "cls", "ev"];
const HINT_SIGNATURE = 0x01b1;
const BASE_OFFSET_FIELD = 0;
const BASE_LENGTH_FIELD = 4;
const HEADER_SIZE = 8;
/** The picture of the compound file is a Silky's image, and the word inside it is that format's. */
export { readZitImageLayout };

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

interface ChrLayout {
	baseOffset: number;
	baseLength: number;
	zit: ZitLayout;
}

/** The bytes of the picture carried inside a compound file. */
async function readBase(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	try {
		const bytes = Buffer.from(await source.readAt(BigInt(offset), length));
		if (bytes.length < length) return undefined;
		return bytes;
	} catch {
		return undefined;
	}
}

/**
 * The header the reference reads: where the picture inside the file begins and how long it is, and then the
 * picture itself, which has to be one of the kinds of image the Silky's reader knows. The two offsets are held
 * to the size of the file, the sum of them in full rather than in the arithmetic the reference's own thirty-two
 * bit sum would wrap around.
 */
async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<ChrLayout | undefined> {
	if (!EXTENSIONS.includes(sourceExtension(sourcePath))) {
		if (source.size < 4n) return undefined;
		const word = Buffer.from(await source.readAt(0n, 4));
		if (word.length < 4 || word.readUInt32LE(0) !== HINT_SIGNATURE)
			return undefined;
	}
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		const baseOffset = header.readUInt32LE(BASE_OFFSET_FIELD);
		if (BigInt(baseOffset) >= source.size) return undefined;
		const baseLength = header.readUInt32LE(BASE_LENGTH_FIELD);
		if (BigInt(baseOffset) + BigInt(baseLength) > source.size) return undefined;
		const base = await readBase(source, baseOffset, baseLength);
		if (!base) return undefined;
		const zit = await readZitImageLayout(new BufferByteSource(base));
		if (!zit) return undefined;
		return { baseOffset, baseLength, zit };
	} catch {
		return undefined;
	}
}

export const tigermanChrImageDescriptor: FormatDescriptor = {
	id: "tigerman-chr-image",
	name: "Tigerman Project compound image",
	extensions: EXTENSIONS,
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
			source: "Legacy/Tigerman/ImageCHR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tigermanChrImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tigermanChrImageDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from([0xb1, 0x01, 0x00, 0x00]) }],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tigerman image");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "bmp"),
				// The picture is carried inside the file rather than being the whole of it.
				offset: BigInt(layout.baseOffset),
				size: BigInt(layout.baseLength),
				compressed: false,
				metadata: {
					type: "image",
					width: layout.zit.width,
					height: layout.zit.height,
					// The Silky's reader describes every one of its kinds as thirty two bits.
					bitsPerPixel: 32,
					imageType: layout.zit.imageType,
					colors: layout.zit.colors,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.zit.width,
				height: layout.zit.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const bytes = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const base = new BufferByteSource(bytes);
		const zit = await readZitImageLayout(base);
		if (!zit)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tigerman image");
		return Readable.from([renderZitImage(bytes, zit)]);
	},
});
