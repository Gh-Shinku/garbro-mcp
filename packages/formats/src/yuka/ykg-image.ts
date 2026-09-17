// Format reference: GARbro "ArcFormats/Yuka/ImageYKG.cs", class `YkgFormat` (a wrapper that carries a
// bitmap, a portable network graphic, or a portable network graphic whose first four bytes stand `\x89GNP`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpHeaderFields } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { PNG_SIGNATURE, readPngHeaderFields } from "../shared/png.js";

/** 'YKG0', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("YKG0", "latin1");
/** The head the reference reads at once. */
const HEADER_SIZE = 0x40;
/** The two letters and the two clear bytes behind the tag word. */
const VERSION_FIELD = 4;
const VERSION = Buffer.from([0x30, 0x30, 0x00, 0x00]);
/** The offset and size of the wrapped picture, and the offset the reference falls back to. */
const DATA_OFFSET_FIELD = 0x28;
const DATA_SIZE_FIELD = 0x2c;
const FALLBACK_OFFSET_FIELD = 8;
/** Nothing before the head may be a picture. */
const MIN_DATA_OFFSET = 0x30;
/** The tags the reference tells apart: a bitmap, a portable network graphic, and an obfuscated one. */
const BMP_TAG = Buffer.from("BM", "latin1");
const GNP_TAG = Buffer.from([0x89, 0x47, 0x4e, 0x50]);
const TAG_SIZE = 4;
/** The four bytes the reference puts back in front of an obfuscated picture, whose body begins behind the tag. */
const GNP_PREFIX = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

type WrappedKind = "bmp" | "png" | "gnp";

export interface YkgLayout {
	kind: WrappedKind;
	width: number;
	height: number;
	bitsPerPixel: number;
	/** Where the wrapped picture stands and how many bytes it takes. */
	dataOffset: number;
	dataSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `YkgFormat.ReadMetaData`: the head is tagged `YKG0`, the four bytes behind the tag word must be `00` and
 * two clear bytes, and the offset of the wrapped picture stands at `0x28` — or, when that is nothing, at
 * eight — with its size at `0x2C` or, when that is nothing, the rest of the file. An offset inside the head
 * is refused. The four bytes at the offset name the picture, which the reference then reads through its own
 * bitmap or portable network graphic reader; the `\x89GNP` tag is a portable network graphic whose signature
 * has been turned around, so its body from the fifth byte on is read behind the standard signature.
 */
export function readYkgLayout(data: Buffer): YkgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!data
			.subarray(VERSION_FIELD, VERSION_FIELD + VERSION.length)
			.equals(VERSION)
	)
		return undefined;
	let dataOffset = data.readUInt32LE(DATA_OFFSET_FIELD);
	const declaredSize = data.readUInt32LE(DATA_SIZE_FIELD);
	if (0 === dataOffset) dataOffset = data.readUInt32LE(FALLBACK_OFFSET_FIELD);
	if (dataOffset < MIN_DATA_OFFSET) return undefined;
	if (dataOffset > data.length) return undefined;
	const dataSize = 0 === declaredSize ? data.length - dataOffset : declaredSize;
	if (dataSize < TAG_SIZE || dataOffset + dataSize > data.length)
		return undefined;
	const region = data.subarray(dataOffset, dataOffset + dataSize);
	const tag = region.subarray(0, TAG_SIZE);
	if (tag.subarray(0, 2).equals(BMP_TAG)) {
		const fields = readBmpHeaderFields(region);
		if (!fields) return undefined;
		return {
			kind: "bmp",
			width: fields.width,
			height: fields.height,
			bitsPerPixel: fields.bitsPerPixel,
			dataOffset,
			dataSize,
		};
	}
	if (tag.equals(PNG_SIGNATURE.subarray(0, TAG_SIZE))) {
		const fields = readPngHeaderFields(region);
		if (!fields) return undefined;
		return {
			kind: "png",
			width: fields.width,
			height: fields.height,
			bitsPerPixel: fields.bitsPerPixel,
			dataOffset,
			dataSize,
		};
	}
	if (tag.equals(GNP_TAG)) {
		// The signature is put back in front of the body, which begins at the fifth byte of the region.
		const restored = Buffer.concat([GNP_PREFIX, region.subarray(TAG_SIZE)]);
		const fields = readPngHeaderFields(restored);
		if (!fields) return undefined;
		return {
			kind: "gnp",
			width: fields.width,
			height: fields.height,
			bitsPerPixel: fields.bitsPerPixel,
			dataOffset,
			dataSize,
		};
	}
	return undefined;
}

async function readLayout(source: ByteSource): Promise<YkgLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		return readYkgLayout(stored);
	} catch {
		return undefined;
	}
}

function wrappedExtension(kind: WrappedKind): string {
	return "bmp" === kind ? "bmp" : "png";
}

export const yukaYkgImageDescriptor: FormatDescriptor = {
	id: "yuka-ykg-image",
	name: "Yuka engine image format",
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
			source: "ArcFormats/Yuka/ImageYKG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const yukaYkgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yukaYkgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Yuka YKG picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, wrappedExtension(layout.kind)),
				offset: BigInt(
					layout.dataOffset + ("gnp" === layout.kind ? TAG_SIZE : 0),
				),
				size: BigInt(layout.dataSize - ("gnp" === layout.kind ? TAG_SIZE : 0)),
				encrypted: "gnp" === layout.kind,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// An obfuscated picture has its signature put back, which the entry does not hold.
			sizeKnown: "gnp" !== layout.kind,
		};
		return {
			entries: [entry],
			metadata: {
				image: wrappedExtension(layout.kind),
				wrapped: layout.kind,
				encrypted: "gnp" === layout.kind,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a Yuka YKG picture");
		}
		const start = layout.dataOffset + ("gnp" === layout.kind ? TAG_SIZE : 0);
		const length = layout.dataSize - ("gnp" === layout.kind ? TAG_SIZE : 0);
		const body = Buffer.from(await source.readAt(BigInt(start), length));
		if ("gnp" === layout.kind) {
			return Readable.from([Buffer.concat([GNP_PREFIX, body])]);
		}
		return Readable.from([body]);
	},
});
