// Format reference: GARbro "ArcFormats/Valkyria/ImageMG2.cs", classes `Mg2Format` and `Mg2EncryptedStream`
// (a Valkyria picture: a head naming a portable network graphic or a JPEG whose first places stand under a
// mask, and, behind it, a shape of the places that stands under the same mask). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { PNG_SIGNATURE, readPngHeaderFields } from "../shared/png.js";

/** 'MICO', the word the reference registers. */
const SIGNATURE = Buffer.from("MICO", "latin1");
/** The word the head carries behind the word of the format. */
const FORMAT_WORD = "CG01";
const FORMAT_WORD_FIELD = 0x04;
const HEADER_SIZE = 0x10;
/** The places of the picture stand behind the head, and the shape of them behind those places. */
const IMAGE_LENGTH_FIELD = 0x08;
const ALPHA_LENGTH_FIELD = 0x0c;
const PAYLOAD_OFFSET = 0x10;
/** The word a JPEG of this engine begins with: the start of the picture, then the first of its tables. */
const JPEG_WORD = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
/** How many bytes of a picture stand under the mask, and which mask they stand under, for each way the
 * reference knows. */
const MASKED_V1 = "v1";
const MASKED_V2 = "v2";
const V2_MASKED_PLACES = 25;

/** A picture the reference would read into memory whole; anything past this is refused rather than held. */
const LIMIT = 256 * 1024 * 1024;

export interface Mg2Layout {
	/** How many bytes the places of the picture stand in. */
	imageLength: number;
	/** How many bytes the shape of the places stands in, which is nought where the picture has no shape. */
	alphaLength: number;
}

export interface Mg2Payload {
	/** Which way the places of the picture stand under the mask. */
	scheme: string;
	/** Whether the places of the picture stand as a portable network graphic or as a JPEG. */
	kind: "png" | "jpeg";
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Mg2Format.ReadMetaData`: the word `MICO` stands at the beginning of the file with the word `CG01` behind
 * it, the word at `0x08` names how many bytes the places of the picture stand in and the word at `0x0C` how
 * many the shape of those places stands in.
 */
export function readMg2Layout(
	data: Buffer,
	fileLength = data.length,
): Mg2Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.toString("latin1", FORMAT_WORD_FIELD, FORMAT_WORD_FIELD + 4) !==
		FORMAT_WORD
	) {
		return undefined;
	}
	const imageLength = data.readInt32LE(IMAGE_LENGTH_FIELD);
	const alphaLength = data.readInt32LE(ALPHA_LENGTH_FIELD);
	if (imageLength <= 0 || alphaLength < 0) return undefined;
	if (imageLength > LIMIT || alphaLength > LIMIT) return undefined;
	if (PAYLOAD_OFFSET + imageLength > fileLength) return undefined;
	if (PAYLOAD_OFFSET + imageLength + alphaLength > fileLength) return undefined;
	return { imageLength, alphaLength };
}

/** `Mg2EncryptedStream.CreateV1` and `CreateV2`: how many places of a region stand under the mask and which
 * mask they stand under, the second way taking as many places as name it. */
function maskedPlaces(scheme: string, length: number): number {
	if (scheme === MASKED_V1) return Math.floor(length / 5);
	return Math.min(V2_MASKED_PLACES, length);
}

function maskKey(scheme: string, length: number): number {
	return scheme === MASKED_V1 ? 0 : length & 0xff;
}

/**
 * `Mg2EncryptedStream.Read`: the places of a region stand under a mask that walks one place at a time from the
 * mask of the region, and every place of a region behind the last place that stands under the mask stands as
 * it is.
 */
export function unmaskMg2(
	data: Buffer,
	offset: number,
	length: number,
	scheme: string,
): Buffer {
	if (length < 0 || offset < 0 || offset + length > data.length) {
		throw invalidPicture("MICO picture is cut short of its places");
	}
	const unmasked = Buffer.from(data.subarray(offset, offset + length));
	const masked = maskedPlaces(scheme, length);
	const key = maskKey(scheme, length);
	for (let at = 0; at < masked && at < unmasked.length; at += 1) {
		unmasked[at] = ((unmasked[at] ?? 0) ^ ((key + at) & 0xff)) & 0xff;
	}
	return unmasked;
}

/**
 * `Mg2Format.ReadMetaData`: the places of a picture stand as a portable network graphic or as a JPEG, and which
 * of the two ways they stand under the mask is told by the first of the two the words of the file agree with.
 * The reference tells the two kinds of a picture by the word at the front of them and reads the width, the
 * height and the places of a colour out of the header behind it.
 */
export function readMg2Payload(
	data: Buffer,
	layout: Mg2Layout,
): Mg2Payload | undefined {
	for (const scheme of [MASKED_V1, MASKED_V2]) {
		const unmasked = unmaskMg2(
			data,
			PAYLOAD_OFFSET,
			layout.imageLength,
			scheme,
		);
		if (unmasked.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
			const header = readPngHeaderFields(unmasked);
			if (header) return { scheme, kind: "png", ...header };
			continue;
		}
		if (unmasked.subarray(0, JPEG_WORD.length).equals(JPEG_WORD)) {
			const header = readJpegHeaderFields(unmasked);
			if (header) return { scheme, kind: "jpeg", ...header };
		}
	}
	return undefined;
}

/**
 * `Mg2Format.Read`: the places of the picture stand as they are behind the head; the shape of those places
 * stands behind them, and the reference gathers it out of a picture of its own and stands it in the fourth
 * place of every colour, which this project does not read.
 */
export function extractMg2(
	data: Buffer,
	layout: Mg2Layout,
	payload: Mg2Payload,
): Buffer {
	if (0 !== layout.alphaLength) {
		throw invalidPicture(
			"MICO picture carries a shape of its own, which this project does not read",
		);
	}
	return unmaskMg2(data, PAYLOAD_OFFSET, layout.imageLength, payload.scheme);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const valkyriaMg2ImageDescriptor: FormatDescriptor = {
	id: "valkyria-mg2-image",
	name: "Valkyria image format",
	extensions: ["mg2"],
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
			source: "ArcFormats/Valkyria/ImageMG2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const KINDS = { png: "png", jpeg: "jpg" } as const;

async function readMg2(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readMg2Layout(stored, Number(source.size));
	if (!layout) throw invalidPicture("Not a MICO picture");
	const payload = readMg2Payload(stored, layout);
	if (!payload)
		throw invalidPicture("MICO picture holds no picture of its own");
	return { stored, layout, payload };
}

export const valkyriaMg2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: valkyriaMg2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			const layout = readMg2Layout(header, Number(source.size));
			if (!layout) return false;
			// The head alone does not name the places of the picture, which stand under a mask.
			const stored = await readStored(source);
			return readMg2Payload(stored, layout) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const { layout, payload } = await readMg2(source);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, KINDS[payload.kind]),
			offset: BigInt(PAYLOAD_OFFSET),
			size: BigInt(layout.imageLength),
			compressed: true,
			metadata: {
				type: "image",
				width: payload.width,
				height: payload.height,
				bitsPerPixel: payload.bitsPerPixel,
				scheme: payload.scheme,
			},
		});
		return {
			entries: [entry],
			metadata: { image: payload.kind, scheme: payload.scheme },
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath) {
		void sourcePath;
		const { stored, layout, payload } = await readMg2(source);
		// The places of the picture stand as a portable network graphic or as a JPEG, which this project hands
		// out as they stand.
		return Readable.from([extractMg2(stored, layout, payload)]);
	},
});
