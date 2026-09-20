// Format reference: GARbro "ArcFormats/AdvSys/ImageGR2.cs", class `PolaFormat` (the compressed kind of the
// pictures of the AdvSys engine: the places of a picture of this kind stand walked, and the places the walk
// stands for stand as a picture of the kind of the places of a picture of the engine itself, so the walk is
// walked twice, once to stand the words of the head of that picture and once to stand the places of it).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import {
	BITS_PER_PLACE_16,
	BITS_PER_PLACE_24,
	packGr2Rows,
	readGr2Layout,
	unpackGr2Picture,
} from "./gr2-image.js";
import { unpackPolaPicture } from "./pola-reader.js";

/** The words a picture of this kind names itself with stand in the first places of the file. */
const MARK = Buffer.from("*Pola", "latin1");
const HEAD_SIZE = 0x14;
/** The places of the head of a picture of the second kind of the walk of it stand behind the words of the kind
 * of the picture, and the places of the pictures of the two kinds stand in kinds of their own. */
const KIND_FIELD = 5;
const KIND_WORDS = "*  ";
const OLD_HEAD_SIZE = 0xd;
const UNPACKED_SIZE_FIELD = 8;
/** The words of the head of a picture of the walk of it stand as sixteen places of a picture, so the reference
 * stands the words of the head of the picture itself from the walk of a picture of that many places. */
const PROBE_SIZE = 64;

export interface PolaLayout {
	/** Where the walk of the places of the picture stands in the file. */
	dataOffset: number;
	/** How many places the walk of the picture stands for. */
	unpackedSize: number;
	newVersion: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PolaFormat.ReadMetaData`: the words of the head of a picture of this kind name the kind of the walk of the
 * places of it and how many places the walk of it stands for, and the places of the walk stand behind them.
 * The kind of the walk of the picture stands as the words `*  ` behind the words of the kind of the picture.
 */
export function readPolaLayout(
	data: Buffer,
	fileLength = data.length,
): PolaLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const newVersion =
		data.toString("latin1", KIND_FIELD, KIND_FIELD + KIND_WORDS.length) ===
		KIND_WORDS;
	const dataOffset = newVersion ? HEAD_SIZE : OLD_HEAD_SIZE;
	if (dataOffset > fileLength || dataOffset > data.length) return undefined;
	return {
		dataOffset,
		unpackedSize: data.readInt32LE(UNPACKED_SIZE_FIELD),
		newVersion,
	};
}

/** The places of the picture of the engine a walk of this kind stands for, with the words of the head of that
 * picture standing within them. */
function unpackPolaGr2(
	data: Buffer,
	layout: PolaLayout,
): {
	gr2: Buffer;
	pixels: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
} {
	// The words of the head of the picture of the engine stand within the places of the walk of the picture of
	// this kind, and a picture of the first kind of the walk does not name how many places the walk of it stands
	// for, so the reference stands the walk of the picture short and reads the places of the head of it.
	const probe = unpackPolaPicture(
		data.subarray(layout.dataOffset),
		Math.max(PROBE_SIZE, layout.unpackedSize),
	);
	const head = readGr2Layout(probe, probe.length);
	if (!head)
		throw invalidPicture(
			"The walk of a picture of this kind stands for no picture of the engine",
		);
	// A picture of the first kind of the walk names no places of the walk of it, so the places the walk of the
	// picture stands for stand as the places of the head of the picture of the engine and the places of it.
	const unpackedSize = layout.newVersion
		? layout.unpackedSize
		: 0x10 + head.stride * head.height;
	const walked = unpackPolaPicture(
		data.subarray(layout.dataOffset),
		unpackedSize,
	);
	const gr2 = walked.subarray(0, unpackedSize);
	const picture = readGr2Layout(gr2, gr2.length);
	if (!picture)
		throw invalidPicture(
			"The walk of a picture of this kind stands for no picture of the engine",
		);
	return {
		gr2,
		pixels: packGr2Rows(unpackGr2Picture(gr2, picture), picture),
		width: picture.width,
		height: picture.height,
		bitsPerPixel: picture.bitsPerPixel,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const advsysPolaImageDescriptor: FormatDescriptor = {
	id: "advsys-pola-image",
	name: "AdvSys engine compressed image format",
	extensions: ["gr2"],
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
			source: "ArcFormats/AdvSys/ImageGR2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const advsysPolaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advsysPolaImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readPolaLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPolaLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		const picture = unpackPolaGr2(stored, layout);
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(layout.dataOffset),
					size: source.size - BigInt(layout.dataOffset),
					compressed: true,
					metadata: {
						type: "image",
						width: picture.width,
						height: picture.height,
						bitsPerPixel: picture.bitsPerPixel,
						unpackedSize: layout.unpackedSize,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: picture.width,
				height: picture.height,
				bitsPerPixel: picture.bitsPerPixel,
				unpackedSize: layout.unpackedSize,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = await readStored(source);
		const layout = readPolaLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		const picture = unpackPolaGr2(stored, layout);
		if (picture.bitsPerPixel === BITS_PER_PLACE_16)
			return Readable.from([
				writeBmp16(picture.width, picture.height, picture.pixels, false),
			]);
		if (picture.bitsPerPixel === BITS_PER_PLACE_24)
			return Readable.from([
				writeBmp24(picture.width, picture.height, picture.pixels, false),
			]);
		return Readable.from([
			writeBmp32(picture.width, picture.height, picture.pixels, false),
		]);
	},
});
