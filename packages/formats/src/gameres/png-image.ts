// Port of GARbro "GameRes/ImagePNG.cs" (tag "PNG", class PngFormat), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The places of a portable network graphic stand of
// the reader of this project, and the head of it of the reader the reference stands of.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { readPngHeaderFields, PNG_SIGNATURE } from "../shared/png.js";
import { readPngImage } from "../shared/png-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const CHUNK_AT = 8;
const CHUNK_HEAD_SIZE = 8;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PngFormat.ReadMetaData`: the place of the picture in the picture it stands of, of the places of the
 * first `oFFs` chunk before the places of the picture itself.
 */
export function readPngOffsets(
	png: Buffer,
): { x: number; y: number } | undefined {
	let at = CHUNK_AT;
	while (at + CHUNK_HEAD_SIZE <= png.length) {
		const length = png.readUInt32BE(at);
		const kind = png.toString("latin1", at + 4, at + 8);
		if ("IDAT" === kind || "IEND" === kind) return undefined;
		if ("oFFs" === kind) {
			if (at + CHUNK_HEAD_SIZE + 5 > png.length) return undefined;
			const x = png.readInt32BE(at + CHUNK_HEAD_SIZE);
			const y = png.readInt32BE(at + CHUNK_HEAD_SIZE + 4);
			if (0 !== (png[at + CHUNK_HEAD_SIZE + 8] ?? 1)) return undefined;
			return { x, y };
		}
		at += CHUNK_HEAD_SIZE + length + 4;
	}
	return undefined;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameresPngImageDescriptor: FormatDescriptor = {
	id: "gameres-png-image",
	name: "Portable Network Graphics image",
	extensions: ["png"],
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
			source: "GameRes/ImagePNG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresPngImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresPngImageDescriptor,
	detection: { signatures: [{ bytes: PNG_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(PNG_SIGNATURE.length)) return false;
		try {
			return readPngHeaderFields(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = await readStored(source);
		const fields = readPngHeaderFields(data);
		if (!fields) throw invalidPicture("Not a portable network graphic");
		const offsets = readPngOffsets(data);
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: fields.width,
					height: fields.height,
					bitsPerPixel: fields.bitsPerPixel,
					offsetX: offsets?.x ?? 0,
					offsetY: offsets?.y ?? 0,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const image = await readPngImage(await readStored(source));
		if (!image)
			throw invalidPicture(
				"The places of the picture stand of no picture of their own",
			);
		return Readable.from([
			32 === image.bitsPerPixel
				? writeBmp32(image.width, image.height, image.pixels)
				: writeBmp24(image.width, image.height, image.pixels),
		]);
	},
});
