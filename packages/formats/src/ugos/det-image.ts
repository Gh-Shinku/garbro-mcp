import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { unpackDetPicture } from "./det-bmp-reader.js";

const HEAD_SIZE = 0x10;
const MARK = 0x46;
const KIND_MASK = 0x5f;
const KIND = 0x45;
const BITS_PER_PICTURE_PLACE_8 = 8;
const BITS_PER_PICTURE_PLACE_24 = 0x18;
const BITS_PER_PICTURE_PLACE_32 = 0x20;
const BITS_PER_PICTURE_PLACE_KINDS: readonly number[] = [
	BITS_PER_PICTURE_PLACE_8,
	BITS_PER_PICTURE_PLACE_24,
	BITS_PER_PICTURE_PLACE_32,
];
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;

export interface DetLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The kind of the picture, which the reference reads from the word behind the word of its head. */
	method: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readDetLayout(
	data: Buffer,
	fileLength = data.length,
): DetLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if ((data[0] ?? 0) !== MARK) return undefined;
	const method = (data[1] ?? 0) & KIND_MASK;
	if (method !== KIND) return undefined;
	const bitsPerPixel = data[2] ?? 0;
	if (!BITS_PER_PICTURE_PLACE_KINDS.includes(bitsPerPixel)) return undefined;
	return {
		width: data.readUInt16LE(WIDTH_FIELD),
		height: data.readUInt16LE(HEIGHT_FIELD),
		bitsPerPixel,
		method,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export function decodeDetPicture(data: Buffer, layout: DetLayout): Buffer {
	if (layout.width <= 0 || layout.height <= 0)
		throw invalidPicture("A picture of no places stands nowhere");
	const places = unpackDetPicture(
		data.subarray(HEAD_SIZE),
		layout.width,
		layout.height,
		layout.bitsPerPixel,
	);
	if (layout.bitsPerPixel === BITS_PER_PICTURE_PLACE_8)
		return writeBmp8(layout.width, layout.height, places, false);
	return writeBmp32(layout.width, layout.height, places, false);
}

export const ugosDetBmpImageDescriptor: FormatDescriptor = {
	id: "ugos-bmp-image",
	name: "μ-GameOperationSystem compressed bitmap",
	extensions: ["bmp"],
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
			source: "ArcFormats/uGOS/ImageBMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ugosDetBmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ugosDetBmpImageDescriptor,
	detection: {
		signatures: BITS_PER_PICTURE_PLACE_KINDS.map((bits) => ({
			bytes: Buffer.from([MARK, KIND, bits]),
		})),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readDetLayout(data, HEAD_SIZE) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readDetLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(HEAD_SIZE),
					size: source.size - BigInt(HEAD_SIZE),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
						method: layout.method,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				method: layout.method,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readDetLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return Readable.from([decodeDetPicture(stored, layout)]);
	},
});
