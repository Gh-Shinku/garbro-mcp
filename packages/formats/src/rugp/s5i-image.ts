// Format reference: GARbro ArcFormats/rUGP/ImageS5I.cs, class `S5iFormat` (tag "S5I"), over the walk of the
// head of an object of the engine (`CRioArchive.LoadRioTypeCore`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// A picture of the engine is not an archive: the object of it stands as the whole of the file, of the mark of
// an object at the head of it (`ObjectSignature`) rather than of the mark of an archive, and of the class
// `CS5i` behind that mark. The places of the picture stand of the class itself:
//
//   * a count of the places of the head of the walk of the object stands behind the mark (a schema), and the
//     places of the picture stand of it: a schema of nothing keeps the places of it right behind the head of
//     the object, and any other schema keeps a count of the places of the picture there and the picture
//     behind that count.
//   * the places of the object behind the head are the counts of the picture at `+8`, of thirty two places
//     of a colour (BGRA) a place.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { RIO_OBJECT_SIGNATURE, RioClassReader, RioStream } from "./rio-core.js";

const SIGNATURE = Buffer.from("a4cbf629", "hex");
/** The class of the picture, and the places of the counts of it behind the head of the object. */
const CLASS_NAME = "CS5i";
const WIDTH_AT = 8;
const HEIGHT_AT = 10;
/** The places the count of the picture stands at where the schema of the object names one. */
const SIZE_AT = 0x14;
const PIXELS_AT = 0x14;
const PIXELS_AT_SIZED = 0x18;
const PLACES_PER_PLACE = 4;

export interface S5iLayout {
	readonly width: number;
	readonly height: number;
	readonly schema: number;
	readonly pixelsAt: number;
	readonly size: number;
}

/**
 * `S5iFormat.ReadMetaData`: the head of an object of the engine, the class of it, and the counts of the
 * picture behind both. A file of no mark of an object, of another class, or of a head that runs past the
 * places of the file is not a picture of this engine at all.
 */
export function readS5iLayout(data: Buffer): S5iLayout | undefined {
	if (data.length < 8 || data.readUInt32LE(0) !== RIO_OBJECT_SIGNATURE) {
		return undefined;
	}
	const stream = new RioStream(data);
	const reader = new RioClassReader();
	const walked = reader.loadRioTypeCore(stream);
	if (!walked || walked.className !== CLASS_NAME) return undefined;
	const objectAt = stream.position;
	if (objectAt + HEIGHT_AT + 2 > data.length) return undefined;
	const width = data.readUInt16LE(objectAt + WIDTH_AT);
	const height = data.readUInt16LE(objectAt + HEIGHT_AT);
	if (0 === width || 0 === height) return undefined;
	const places = width * height * PLACES_PER_PLACE;
	const schema = walked.schema;
	if (0 === schema) {
		if (objectAt + PIXELS_AT + places > data.length) return undefined;
		return {
			width,
			height,
			schema,
			pixelsAt: objectAt + PIXELS_AT,
			size: places,
		};
	}
	if (objectAt + PIXELS_AT_SIZED > data.length) return undefined;
	const size = data.readInt32LE(objectAt + SIZE_AT);
	if (size < places || objectAt + PIXELS_AT_SIZED + size > data.length) {
		return undefined;
	}
	return {
		width,
		height,
		schema,
		pixelsAt: objectAt + PIXELS_AT_SIZED,
		size,
	};
}

/** `S5iFormat.Read`: the places of the picture, of the count of them the schema of the object names. */
export function unpackS5i(data: Buffer, layout: S5iLayout): Buffer {
	const places = layout.width * layout.height * PLACES_PER_PLACE;
	return writeBmp32(
		layout.width,
		layout.height,
		data.subarray(layout.pixelsAt, layout.pixelsAt + places),
		false,
	);
}

export const s5iDescriptor: FormatDescriptor = {
	id: "rugp-s5i-image",
	name: "rUGP engine image",
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
			source: "ArcFormats/rUGP/ImageS5I.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/rUGP/ArcRIO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export const s5iFormat: ArchiveFormat = defineFixedArchive({
	descriptor: s5iDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, _sourcePath: string): Promise<boolean> {
		if (source.size < 8n) return false;
		return (
			readS5iLayout(await source.readAt(0n, Number(source.size))) !== undefined
		);
	},
	async read(source: ByteSource, _sourcePath: string) {
		const data = await source.readAt(0n, Number(source.size));
		const layout = readS5iLayout(data);
		if (!layout) throw invalidPicture("Not a Purple picture");
		return {
			entries: [
				createFixedEntry({
					id: "0",
					path: "image.bmp",
					offset: 0n,
					size: source.size,
					metadata: {
						width: layout.width,
						height: layout.height,
						bitsPerPixel: 32,
						schema: layout.schema,
					},
				}),
			],
			metadata: {
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				schema: layout.schema,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath: string) {
		const data = await source.readAt(0n, Number(source.size));
		const layout = readS5iLayout(data);
		if (!layout) throw invalidPicture("Not a Purple picture");
		return Readable.from([unpackS5i(data, layout)]);
	},
});
