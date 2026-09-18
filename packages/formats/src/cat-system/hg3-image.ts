// Format reference: GARbro "ArcFormats/CatSystem/ImageHG3.cs", classes `Hg3Format`, `HgMetaData` and
// `Hg3Reader`. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'HG-3', the mark of the newer CatSystem picture. */
const SIGNATURE = Buffer.from("HG-3", "latin1");
const HEADER_SIZE = 0x4c;
const VERSION_FIELD = 0x04;
const VERSION = 0x0c;
const INFO_FIELD = 0x14;
const INFO = "stdinfo\0";
const HEAD_SIZE_FIELD = 0x1c;
const WIDTH_FIELD = 0x24;
const HEIGHT_FIELD = 0x28;
const DEPTH_FIELD = 0x2c;
const CANVAS_WIDTH_FIELD = 0x44;
const CANVAS_HEIGHT_FIELD = 0x48;
/** The stream of the reader runs from the info mark, so every place is measured from there. */
const STREAM_BASE = INFO_FIELD;
/** The name of a section and the sizes behind it. */
const SECTION_NAME_SIZE = 8;
const PLAIN_HEAD_SIZE = 0x28;
const PLAIN_DATA_SIZE_FIELD = 0x18;
const PLAIN_UNPACKED_SIZE_FIELD = 0x1c;
const PLAIN_CONTROL_SIZE_FIELD = 0x20;
const PLAIN_CONTROL_UNPACKED_FIELD = 0x24;
const PLAIN_SECTION = "img0000\0";
const JPEG_SECTION = "img_jpg\0";
const WEBP_SECTION = "img_wbp\0";

export interface Hg3Layout {
	/** Which of the three kinds of picture the section names. */
	kind: "plain" | "jpeg" | "webp";
	headerSize: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	canvasWidth: number;
	canvasHeight: number;
	geometry: HgGeometry;
	dataOffset: number;
	dataPacked: number;
	dataUnpacked: number;
	controlPacked: number;
	controlUnpacked: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Hg3Format.ReadMetaData`: behind the mark `HG-3` stands the word `0x0C` at four and the mark `stdinfo` at
 * `0x14`, the head size as a word at `0x1C`, the width and the height at `0x24` and `0x28`, the depth at
 * `0x2C` and the canvas behind the head. The section of the picture then begins the head size past the
 * `stdinfo` mark and names one of three kinds: a plain picture of two zlib streams, one behind a JPEG, or
 * one behind a WebP.
 */
export function readHg3Layout(
	data: Buffer,
	fileLength = data.length,
): Hg3Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (data.readUInt32LE(VERSION_FIELD) !== VERSION) return undefined;
	if (data.subarray(INFO_FIELD, INFO_FIELD + 8).toString("latin1") !== INFO) {
		return undefined;
	}
	const headerSize = data.readUInt32LE(HEAD_SIZE_FIELD);
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readInt32LE(DEPTH_FIELD);
	const geometry = hgGeometry(width, height, bitsPerPixel);
	if (!geometry) return undefined;
	const section = STREAM_BASE + headerSize;
	if (section + SECTION_NAME_SIZE > fileLength) return undefined;
	const name = data
		.subarray(section, section + SECTION_NAME_SIZE)
		.toString("latin1");
	const layout: Hg3Layout = {
		kind: "plain",
		headerSize,
		width,
		height,
		bitsPerPixel,
		canvasWidth: data.readUInt32LE(CANVAS_WIDTH_FIELD),
		canvasHeight: data.readUInt32LE(CANVAS_HEIGHT_FIELD),
		geometry,
		dataOffset: 0,
		dataPacked: 0,
		dataUnpacked: 0,
		controlPacked: 0,
		controlUnpacked: 0,
	};
	if (JPEG_SECTION === name) {
		return { ...layout, kind: "jpeg" };
	}
	if (WEBP_SECTION === name) {
		return { ...layout, kind: "webp" };
	}
	if (PLAIN_SECTION !== name) return undefined;
	if (section + PLAIN_HEAD_SIZE > fileLength) return undefined;
	const dataPacked = data.readInt32LE(section + PLAIN_DATA_SIZE_FIELD);
	const dataUnpacked = data.readInt32LE(section + PLAIN_UNPACKED_SIZE_FIELD);
	const controlPacked = data.readInt32LE(section + PLAIN_CONTROL_SIZE_FIELD);
	const controlUnpacked = data.readInt32LE(
		section + PLAIN_CONTROL_UNPACKED_FIELD,
	);
	const dataOffset = section + PLAIN_HEAD_SIZE;
	if (
		dataPacked < 0 ||
		controlPacked < 0 ||
		controlUnpacked < 0 ||
		dataUnpacked !== geometry.stride * geometry.height ||
		dataOffset + dataPacked + controlPacked > fileLength
	) {
		return undefined;
	}
	return {
		...layout,
		dataOffset,
		dataPacked,
		dataUnpacked,
		controlPacked,
		controlUnpacked,
	};
}

/** `Hg3Reader.UnpackImg0000`: the two zlib streams of a plain picture stand behind the section's own head. */
export async function unpackHg3Plain(
	stored: Buffer,
	layout: Hg3Layout,
): Promise<Buffer> {
	if ("plain" !== layout.kind) {
		throw invalidPicture("CatSystem picture is not a plain one");
	}
	return unpackHgStream(
		stored,
		layout.dataOffset,
		layout.dataPacked,
		layout.dataUnpacked,
		layout.controlPacked,
		layout.geometry,
	);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function pictureEntry(layout: Hg3Layout, sourcePath: string): FixedEntry {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "bmp"),
			offset: BigInt(layout.dataOffset),
			size: BigInt(layout.dataPacked + layout.controlPacked),
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				canvasWidth: layout.canvasWidth,
				canvasHeight: layout.canvasHeight,
				kind: layout.kind,
			},
		}),
		// The pixels are unfolded from the section of the picture and a bitmap header written around them.
		sizeKnown: false,
	};
}

export const catSystemHg3ImageDescriptor: FormatDescriptor = {
	id: "cat-system-hg3-image",
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
			source: "ArcFormats/CatSystem/ImageHG3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const catSystemHg3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: catSystemHg3ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
				return false;
			}
			if (
				header.readUInt32LE(VERSION_FIELD) !== VERSION ||
				header.subarray(INFO_FIELD, INFO_FIELD + 8).toString("latin1") !== INFO
			) {
				return false;
			}
			const section = STREAM_BASE + header.readUInt32LE(HEAD_SIZE_FIELD);
			if (
				BigInt(section + PLAIN_HEAD_SIZE) > source.size ||
				!hgGeometry(
					header.readUInt32LE(WIDTH_FIELD),
					header.readUInt32LE(HEIGHT_FIELD),
					header.readInt32LE(DEPTH_FIELD),
				)
			) {
				return false;
			}
			const window = Buffer.from(
				await source.readAt(BigInt(section), PLAIN_HEAD_SIZE),
			);
			const name = window.subarray(0, SECTION_NAME_SIZE).toString("latin1");
			if (JPEG_SECTION === name || WEBP_SECTION === name) return true;
			if (PLAIN_SECTION !== name) return false;
			const dataPacked = window.readInt32LE(PLAIN_DATA_SIZE_FIELD);
			const controlPacked = window.readInt32LE(PLAIN_CONTROL_SIZE_FIELD);
			if (dataPacked < 0 || controlPacked < 0) return false;
			return (
				BigInt(section + PLAIN_HEAD_SIZE + dataPacked + controlPacked) <=
				source.size
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readHg3Layout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a CatSystem picture");
		}
		return {
			entries: [pictureEntry(layout, sourcePath)],
			metadata: {
				image: "bmp",
				compression: "plain" === layout.kind ? "zlib" : layout.kind,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readHg3Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a CatSystem picture");
		}
		if ("plain" !== layout.kind) {
			throw invalidPicture(
				`CatSystem picture behind a ${layout.kind} section is not supported`,
			);
		}
		const pixels = await unpackHg3Plain(stored, layout);
		// `Hg3Reader` of a plain picture stores its rows bottom up, which `CreateFlipped` means.
		if (24 === layout.bitsPerPixel) {
			return Readable.from([
				writeBmp24(layout.width, layout.height, pixels, true),
			]);
		}
		return Readable.from([
			writeBmp32(layout.width, layout.height, pixels, true),
		]);
	},
});
