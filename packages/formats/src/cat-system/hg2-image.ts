// Format reference: GARbro "ArcFormats/CatSystem/ImageHG2.cs", classes `Hg2Format`, `Hg2MetaData` and
// `Hg2Reader`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { hgGeometry, type HgGeometry, unpackHgStream } from "./hg-core.js";

/** 'HG-2', the mark of the older CatSystem picture. */
const SIGNATURE = Buffer.from("HG-2", "latin1");
const MINIMUM_HEADER = 0x30;
const VERSION_FIELD = 0x08;
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x10;
const DEPTH_FIELD = 0x14;
const CHANNEL_DEPTH_FIELD = 0x16;
const DATA_PACKED_FIELD = 0x20;
const DATA_UNPACKED_FIELD = 0x24;
const CONTROL_PACKED_FIELD = 0x28;
const CONTROL_UNPACKED_FIELD = 0x2c;
/** The three versions and the head each of them carries. */
const HEADER_SIZES = new Map([
	[0x25, 0x58],
	[0x20, 0x50],
	[0x10, 0x30],
]);

export interface Hg2Layout {
	version: number;
	headerSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	channelDepth: number;
	dataPacked: number;
	dataUnpacked: number;
	controlPacked: number;
	controlUnpacked: number;
	geometry: HgGeometry;
	/** The newer version of the head stores its rows bottom up, which `CreateFlipped` means. */
	flipped: boolean;
	/** The older version scales a picture of a few bits a channel and inverts the fourth byte. */
	scaled: boolean;
	invertedAlpha: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Hg2Format.ReadMetaData`: behind the mark stands the version as a word at eight, and only `0x10`, `0x20`
 * and `0x25` are read, each with the head size it stands for. The width and the height stand at `0x0C` and
 * `0x10` as words, the depth and the bits of a channel behind them, and the packed and unpacked sizes of the
 * data and of the control bits stand from `0x20`.
 */
export function readHg2Layout(
	data: Buffer,
	fileLength = data.length,
): Hg2Layout | undefined {
	if (data.length < MINIMUM_HEADER) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const version = data.readInt32LE(VERSION_FIELD);
	const headerSize = HEADER_SIZES.get(version);
	if (headerSize === undefined || headerSize > fileLength) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readInt16LE(DEPTH_FIELD);
	const channelDepth = data.readInt16LE(CHANNEL_DEPTH_FIELD);
	const dataPacked = data.readInt32LE(DATA_PACKED_FIELD);
	const dataUnpacked = data.readInt32LE(DATA_UNPACKED_FIELD);
	const controlPacked = data.readInt32LE(CONTROL_PACKED_FIELD);
	const controlUnpacked = data.readInt32LE(CONTROL_UNPACKED_FIELD);
	const geometry = hgGeometry(width, height, bitsPerPixel);
	if (!geometry) return undefined;
	if (dataPacked < 0 || controlPacked < 0 || controlUnpacked < 0) {
		return undefined;
	}
	if (
		headerSize + dataPacked + controlPacked > fileLength ||
		dataUnpacked !== geometry.stride * geometry.height
	) {
		return undefined;
	}
	return {
		version,
		headerSize,
		width,
		height,
		bitsPerPixel,
		channelDepth,
		dataPacked,
		dataUnpacked,
		controlPacked,
		controlUnpacked,
		geometry,
		flipped: version > 0x10,
		scaled: channelDepth > 0 && channelDepth < 8,
		invertedAlpha: 32 === bitsPerPixel && version <= 0x10,
	};
}

/**
 * `Hg2Reader.CreateImage`: the pixels behind the head are unfolded from the two streams. A picture of the
 * newer version of the head stands bottom up; one of the older version may hold its channels in fewer than
 * eight bits, which are stretched over the whole byte, and its fourth byte stands inverted.
 */
export async function readHg2Pixels(
	stored: Buffer,
	layout: Hg2Layout,
): Promise<Buffer> {
	const pixels = await unpackHgStream(
		stored,
		layout.headerSize,
		layout.dataPacked,
		layout.dataUnpacked,
		layout.controlPacked,
		layout.geometry,
	);
	if (!layout.scaled && !layout.invertedAlpha) return pixels;
	const { pixelSize } = layout.geometry;
	if (layout.scaled) {
		const max = (1 << layout.channelDepth) - 1;
		for (let at = 0; at + 2 < pixels.length; at += pixelSize) {
			pixels[at] = Math.trunc(((pixels[at] ?? 0) * 0xff) / max);
			pixels[at + 1] = Math.trunc(((pixels[at + 1] ?? 0) * 0xff) / max);
			pixels[at + 2] = Math.trunc(((pixels[at + 2] ?? 0) * 0xff) / max);
		}
	}
	if (layout.invertedAlpha) {
		for (let at = 3; at < pixels.length; at += 4) {
			pixels[at] = (pixels[at] ?? 0) ^ 0xff;
		}
	}
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function pictureEntry(layout: Hg2Layout, sourcePath: string): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(layout.headerSize),
			size: BigInt(layout.dataPacked + layout.controlPacked),
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				version: layout.version,
				channelDepth: layout.channelDepth,
			},
		}),
		// The pixels are unfolded from two zlib streams and a bitmap header is written around them.
		sizeKnown: false,
	};
}

export const catSystemHg2ImageDescriptor: FormatDescriptor = {
	id: "cat-system-hg2-image",
	name: "CatSystem engine image format",
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
			source: "ArcFormats/CatSystem/ImageHG2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const catSystemHg2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: catSystemHg2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(MINIMUM_HEADER)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, MINIMUM_HEADER));
			if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
				return false;
			}
			const version = header.readInt32LE(VERSION_FIELD);
			const headerSize = HEADER_SIZES.get(version);
			if (headerSize === undefined || BigInt(headerSize) > source.size) {
				return false;
			}
			const geometry = hgGeometry(
				header.readUInt32LE(WIDTH_FIELD),
				header.readUInt32LE(HEIGHT_FIELD),
				header.readInt16LE(DEPTH_FIELD),
			);
			if (!geometry) return false;
			const dataPacked = header.readInt32LE(DATA_PACKED_FIELD);
			const controlPacked = header.readInt32LE(CONTROL_PACKED_FIELD);
			if (dataPacked < 0 || controlPacked < 0) return false;
			return BigInt(headerSize + dataPacked + controlPacked) <= source.size;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readHg2Layout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a CatSystem picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath)],
			metadata: {
				image: "bmp",
				compression: "zlib",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readHg2Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a CatSystem picture");
		}
		const pixels = await readHg2Pixels(stored, layout);
		// The newer head stores its rows bottom up, which a bitmap records with a positive height.
		if (24 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, layout.flipped),
			]);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, layout.flipped),
		]);
	},
});
