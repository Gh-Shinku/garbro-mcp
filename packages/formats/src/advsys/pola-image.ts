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

const MARK = Buffer.from("*Pola", "latin1");
const HEAD_SIZE = 0x14;
const KIND_FIELD = 5;
const KIND_WORDS = "*  ";
const OLD_HEAD_SIZE = 0xd;
const UNPACKED_SIZE_FIELD = 8;
/** The words of the head of a picture of the walk of it stand as sixteen places of a picture, so the reference
 * stands the words of the head of the picture itself from the walk of a picture of that many places. */
const PROBE_SIZE = 64;

export interface PolaLayout {
	dataOffset: number;
	unpackedSize: number;
	newVersion: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

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
	const probe = unpackPolaPicture(
		data.subarray(layout.dataOffset),
		Math.max(PROBE_SIZE, layout.unpackedSize),
	);
	const head = readGr2Layout(probe, probe.length);
	if (!head)
		throw invalidPicture(
			"The walk of a picture of this kind stands for no picture of the engine",
		);
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
