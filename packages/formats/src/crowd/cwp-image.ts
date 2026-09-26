import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { readPngImage } from "../shared/png-image.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { PNG_SIGNATURE, readPngHeaderFields } from "../shared/png.js";

const MARKS = [Buffer.from("CWDP", "latin1"), Buffer.from("AMNP", "latin1")];
const HEAD_SIZE = 0x11;
const WIDTH_FIELD = 0x04;
const HEIGHT_FIELD = 0x08;
const BITS_FIELD = 0x0c;
const COLOUR_TYPE_FIELD = 0x0d;
const PNG_HEAD_SIZE = 0x29;
const HEADER_LENGTH_FIELD = 0x0b;
const HEADER_LENGTH = 0x0d;
const HEADER_WORD_FIELD = 0x0c;
const PLACES_FIELD = 0x10;
const PLACES_SIZE = 0x15;
const DATA_WORD_FIELD = 0x25;
const DATA_OFFSET = 0x19;
/** The words that stand at the end of a portable network graphic. */
// The chunk that ends the picture: its count of the places, which is nought, the word `IEND` and the check
// word of both. The reference writes the count of the places with three bytes instead of four, which leaves
// the stream one byte short of a chunk; the decoder of the platform stops at the places of the picture
// before it reads that far, so the reference works, and this port stands the four bytes where they belong.
const PNG_FOOTER: Buffer = Buffer.from([
	0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const OUTPUT_PLACES = 32;
const HIGHEST_BITS = 16;

export interface CwpLayout {
	width: number;
	height: number;
	bits: number;
	colourType: number;
	bitsPerPixel: number;
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readCwpLayout(
	data: Buffer,
	fileLength = data.length,
): CwpLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const mark = data.subarray(0, 4);
	if (!MARKS.some((known) => mark.equals(known))) return undefined;
	const width = data.readUInt32BE(WIDTH_FIELD);
	const height = data.readUInt32BE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const bits = data.readUInt8(BITS_FIELD);
	if (
		bits !== 1 &&
		bits !== 2 &&
		bits !== 4 &&
		bits !== 8 &&
		bits !== HIGHEST_BITS
	) {
		return undefined;
	}
	const colourType = data.readUInt8(COLOUR_TYPE_FIELD);
	if (colourType > 6 || 1 === colourType || 5 === colourType) return undefined;
	return {
		width,
		height,
		bits,
		colourType,
		bitsPerPixel: OUTPUT_PLACES,
		dataOffset: DATA_OFFSET,
	};
}

export function standCwpAsPng(data: Buffer, layout: CwpLayout): Buffer {
	if (WIDTH_FIELD + PLACES_SIZE > data.length) {
		throw invalidPicture(
			"Crowd picture is cut short of the places of its head",
		);
	}
	const head: Buffer = Buffer.alloc(PNG_HEAD_SIZE, 0x00);
	PNG_SIGNATURE.copy(head, 0);
	// The reference stands the length of the head of a portable network graphic as one place, the places before
	// it standing as nothing.
	head.writeUInt8(HEADER_LENGTH, HEADER_LENGTH_FIELD);
	head.write("IHDR", HEADER_WORD_FIELD, "latin1");
	data.copy(head, PLACES_FIELD, WIDTH_FIELD, WIDTH_FIELD + PLACES_SIZE);
	head.write("IDAT", DATA_WORD_FIELD, "latin1");
	return Buffer.concat([head, data.subarray(layout.dataOffset), PNG_FOOTER]);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const crowdCwpImageDescriptor: FormatDescriptor = {
	id: "crowd-cwp-image",
	name: "Crowd engine image format",
	extensions: ["cwp", "amp"],
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
			source: "ArcFormats/Crowd/ImageCWP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const crowdCwpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdCwpImageDescriptor,
	detection: { signatures: MARKS.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const stored = await readStored(source);
			const layout = readCwpLayout(stored, Number(source.size));
			if (!layout) return false;
			return readPngHeaderFields(standCwpAsPng(stored, layout)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readCwpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Crowd picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: BigInt(layout.dataOffset),
					size: source.size - BigInt(layout.dataOffset),
					compressed: false,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bits: layout.bits,
						colourType: layout.colourType,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCwpLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Crowd picture");
		// `CwpFormat.Read` hands the rebuilt stream to the platform's PNG decoder and this port reads it with
		// its own reader of that format, handing out a bitmap named `.bmp`.
		const picture = await readPngImage(standCwpAsPng(stored, layout));
		if (!picture) {
			throw invalidPicture(
				"The picture behind the head stands of no picture of its own",
			);
		}
		return Readable.from([
			writeBmp32(picture.width, picture.height, picture.pixels),
		]);
	},
});
