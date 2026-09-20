import {
	readPb3Head,
	readPb3V6Name,
	pb3UnpackJbp,
	pb3UnpackV1,
	pb3UnpackV5,
	pb3UnpackV6,
	type Pb3BasePicture,
	type Pb3Head,
	type Pb3Picture,
} from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { readBmpImage, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("PB3B", "latin1");
const HEADER_SIZE = 0x24;
const ALPHA_FIELD = 0x2c;
const KIND_V1 = 1;
const KIND_JBP = 2;
const KIND_JBP_OTHER = 3;
const KIND_V5 = 5;
const KIND_V6 = 6;
const KIND_V6_OTHER = 8;
/** The underkind a picture of the first kind may stand as. */
const V1_SUBKIND = 0x10;
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

async function unpackPb3(
	data: Buffer,
	sourcePath: string,
): Promise<Pb3Picture> {
	const head = readPb3Head(data, data.length);
	if (!head) throw invalidPicture("Not a Purple picture");
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
		return unpackPb3V6(data, head, sourcePath);
	}
	if (kind === KIND_V6 || kind === KIND_V6_OTHER) {
		throw invalidPicture("Purple picture of a kind this project does not read");
	}
	throw invalidPicture("Purple picture of a kind this project does not read");
}

async function loadBasePicture(
	sourcePath: string,
	name: string,
	depth = 0,
): Promise<Pb3BasePicture | undefined> {
	if (depth > 4) return undefined;
	const at = resolve(dirname(sourcePath), name);
	if (at === resolve(sourcePath)) return undefined;
	const stored = await readFile(at).catch(() => undefined);
	if (!stored) return undefined;
	const head = readPb3Head(stored, stored.length);
	if (head) {
		const layout = readLayout(stored, stored.length);
		if (layout && head.width > 0 && head.height > 0) {
			if (head.kind === KIND_V1) {
				const picture = pb3UnpackV1(stored, head);
				return { stride: picture.stride, pixels: picture.pixels };
			}
			if (head.kind === KIND_V5) {
				const picture = pb3UnpackV5(stored, head);
				return { stride: picture.stride, pixels: picture.pixels };
			}
			if ((head.kind === KIND_JBP || head.kind === KIND_JBP_OTHER) && layout) {
				const picture = pb3UnpackJbp(
					stored,
					head,
					HEADER_SIZE + 0x10,
					stored.readInt32LE(ALPHA_FIELD),
				);
				return { stride: picture.stride, pixels: picture.pixels };
			}
		}
	}
	const bmp = readBmpImage(stored);
	if (bmp) {
		return { stride: bmp.width * 4, pixels: Buffer.from(bmp.pixels) };
	}
	return undefined;
}

async function unpackPb3V6(
	data: Buffer,
	head: Pb3Head,
	sourcePath: string,
): Promise<Pb3Picture> {
	const name = readPb3V6Name(data, data.length);
	if (undefined === name || 0 === name.length) {
		throw invalidPicture("Purple picture names no picture of its own");
	}
	const base = await loadBasePicture(sourcePath, `${name}.pb3`);
	if (!base) {
		throw invalidPicture(
			"Purple picture stands without the places of the picture its words name",
		);
	}
	return pb3UnpackV6(data, head, () => base);
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
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a Purple picture");
		let picture: Pb3Picture;
		try {
			picture = await unpackPb3(stored, sourcePath);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw invalidPicture(
				"Purple picture stands short of the places of its walk",
			);
		}
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
