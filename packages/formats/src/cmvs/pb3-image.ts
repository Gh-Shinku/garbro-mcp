// Format reference: GARbro "ArcFormats/Cmvs/ImagePB3.cs", class `Pb3Format` (a picture of the Purple engine
// that stands as the places of the picture itself: the head of the picture names the kind of the walk of its
// places, and the places of the picture stand as the places of the walk of the kind it names).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	readPb3Head,
	pb3UnpackJbp,
	pb3UnpackV1,
	pb3UnpackV5,
	type Pb3Picture,
} from "@garbro-mcp/codecs";
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
} from "../shared/fixed-archive.js";

/** The words a picture of this kind stands behind. */
const MARK = Buffer.from("PB3B", "latin1");
/** The head of a picture of this kind stands in six and thirty places. */
const HEADER_SIZE = 0x24;
const ALPHA_FIELD = 0x2c;
/** The kinds of the walk of the places of a picture of this kind. */
const KIND_V1 = 1;
const KIND_JBP = 2;
const KIND_JBP_OTHER = 3;
const KIND_V5 = 5;
const KIND_V6 = 6;
const KIND_V6_OTHER = 8;
/** The underkind a picture of the first kind may stand as. */
const V1_SUBKIND = 0x10;
/** How many places a place of a picture of this kind stands in. */
const BITS_PER_PLACE = 32;
const COLOURS_PER_PLACE = 4;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface Pb3Layout {
	kind: number;
	subKind: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	inputSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function readLayout(data: Buffer, fileLength: number): Pb3Layout | undefined {
	if (fileLength < HEADER_SIZE || data.length < HEADER_SIZE) {
		return undefined;
	}
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const head = readPb3Head(data, fileLength);
	if (undefined === head) return undefined;
	if (head.width === 0 || head.height === 0) return undefined;
	if (head.width * head.height > LIMIT) return undefined;
	if (head.bitsPerPixel !== 24 && head.bitsPerPixel !== 32) return undefined;
	return {
		kind: head.kind,
		subKind: head.subKind,
		width: head.width,
		height: head.height,
		bitsPerPixel: head.bitsPerPixel,
		inputSize: head.inputSize,
	};
}

/** The places of the picture, which stand as the places of the picture of the kind of the walk of its
 * places. */
function unpackPb3(data: Buffer): Pb3Picture {
	const head = readPb3Head(data, data.length);
	if (!head) throw invalidPicture("Not a Purple picture");
	// The reference reads the places of the file of a picture of the kinds that stand as a picture of the
	// Purple engine in the places of the whole file, and the places its own head names for the other kinds.
	const kind = head.kind;
	if (kind === KIND_JBP || kind === KIND_JBP_OTHER) {
		return pb3UnpackJbp(
			data,
			head,
			HEADER_SIZE + 0x10,
			data.readInt32LE(ALPHA_FIELD),
		);
	}
	if (kind === KIND_V1) {
		if (head.subKind !== V1_SUBKIND) {
			throw invalidPicture(
				"Purple picture of a kind this project does not read",
			);
		}
		return pb3UnpackV1(data, head);
	}
	if (kind === KIND_V5) return pb3UnpackV5(data, head);
	if (kind === KIND_V6 || kind === KIND_V6_OTHER) {
		// The reference reads the places of a picture of these kinds through the words of the engine and the
		// places of a picture of the game that stand beside them.
		throw invalidPicture("Purple picture of a kind this project does not read");
	}
	throw invalidPicture("Purple picture of a kind this project does not read");
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const cmvsPb3ImageDescriptor: FormatDescriptor = {
	id: "cmvs-pb3-image",
	name: "Purple Software image format",
	extensions: ["pb3"],
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
			source: "ArcFormats/Cmvs/ImagePB3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cmvsPb3ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cmvsPb3ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			return (
				readLayout(await readStored(source), Number(source.size)) !== undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Purple picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						kind: layout.kind,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				kind: layout.kind,
				subKind: layout.subKind,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Purple picture");
		let picture: Pb3Picture;
		try {
			picture = unpackPb3(stored);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw invalidPicture(
				"Purple picture stands short of the places of its walk",
			);
		}
		// The places of a picture of this kind stand as the places of four colours apiece; the reference stands
		// a picture of three colours apiece as the places of the picture itself, and this port hands every
		// picture of this kind out as the places of the colours of the picture.
		const places =
			layout.bitsPerPixel === BITS_PER_PLACE
				? picture.pixels
				: stripPb3Alpha(picture);
		const bmp =
			layout.bitsPerPixel === BITS_PER_PLACE
				? writeBmp32(layout.width, layout.height, places, false)
				: writeBmp24(layout.width, layout.height, places, false);
		return Readable.from([bmp]);
	},
});

/** The places of a picture of three colours apiece, which stand as the places of the picture of the colours of
 * the picture itself. */
export function stripPb3Alpha(picture: Pb3Picture): Buffer {
	const packed: Buffer = Buffer.alloc(picture.width * picture.height * 3, 0x00);
	for (let y = 0; y < picture.height; y += 1) {
		for (let x = 0; x < picture.width; x += 1) {
			const from = y * picture.stride + x * COLOURS_PER_PLACE;
			const to = (y * picture.width + x) * 3;
			packed[to] = picture.pixels[from] ?? 0;
			packed[to + 1] = picture.pixels[from + 1] ?? 0;
			packed[to + 2] = picture.pixels[from + 2] ?? 0;
		}
	}
	return packed;
}
