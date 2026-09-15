// Format reference: GARbro "ArcFormats/Crowd/ImageCWL.cs", classes `CwdFormat` and `CwlFormat`. Both formats
// are the same picture: the second one keeps the first one, forty bytes of header and all, in a Microsoft
// packed stream, which the reference unfolds with the same walk the project uses elsewhere.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss, type LzssStreamSettings } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp16 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The four bytes of the first signature, which the reference packs into a word. */
const CWD_SIGNATURE = Buffer.from("cwd ", "latin1");
/** The letters the reference checks at the front of the header, which say more than the four bytes do. */
const CWD_TEXT = Buffer.from("cwd format  - version 1.00 -", "latin1");
const CWD_HEADER_SIZE = 0x38;
/** The measurements stand behind a count the byte at the end of the header is raised by. */
const KEY_FIELD = 0x34;
const KEY_BASE = 0x259a;
const WIDTH_FIELD = 0x2c;
const HEIGHT_FIELD = 0x30;
/** The pixels are two bytes to the pixel and stand behind the header. */
const BYTES_PER_PIXEL = 2;
/** The depth the port reports, which is the depth it writes rather than the fifteen the reference says. */
const REPORTED_DEPTH = 16;
const SZDD_SIGNATURE = Buffer.from("SZDD", "latin1");
const SZDD_HEADER_SIZE = 0x0e;
/** The packed stream keeps the length it unfolds to ten bytes in, not where the plain Microsoft variant does. */
const SZDD_LENGTH_FIELD = 10;
/** How much of the packed stream the reference gives its walk to find the header of the picture with. */
const SZDD_METADATA_INPUT = 100;
/** `CwlFormat`: the Microsoft variant of LZSS, a ring of spaces started one short of its end. */
const LZSS_SETTINGS: LzssStreamSettings = {
	frameSize: 0x1000,
	frameFill: 0x20,
	frameInitPosition: 0x1000 - 0x10,
};
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface CrowdLayout {
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `CwdFormat.ReadMetaData`: the letters `cwd format  - version 1.00 -`, then the measurements behind a count
 * the byte at the end of the header is raised by. The count is added to the measurements as a long word, so a
 * file that would measure past what a long word holds comes round again rather than being refused.
 */
export function readCwdLayout(data: Buffer): CrowdLayout | undefined {
	if (data.length < CWD_HEADER_SIZE) return undefined;
	if (!data.subarray(0, CWD_TEXT.length).equals(CWD_TEXT)) return undefined;
	const key = (data[KEY_FIELD] ?? 0) + KEY_BASE;
	const width = (data.readUInt32LE(WIDTH_FIELD) + key) >>> 0;
	const height = (data.readUInt32LE(HEIGHT_FIELD) + key) >>> 0;
	if (0 === width || 0 === height) return undefined;
	return { width, height };
}

/**
 * `CwlFormat.ReadMetaData`: the walk is handed only the first hundred bytes of the packed stream and is asked
 * for the header of the picture, which is what the port hands it as well, so a stream that does not give the
 * whole header up out of those hundred bytes is turned away.
 */
export function readCwlPrefix(data: Buffer): Buffer | undefined {
	if (data.length < SZDD_HEADER_SIZE + 1) return undefined;
	return inflateLzss(
		data.subarray(
			SZDD_HEADER_SIZE,
			Math.min(data.length, SZDD_HEADER_SIZE + SZDD_METADATA_INPUT),
		),
		{ ...LZSS_SETTINGS, outputLength: CWD_HEADER_SIZE },
	);
}

/** The header of the picture behind the packed stream, which is the header of the plain format. */
export function readCwlLayout(data: Buffer): CrowdLayout | undefined {
	if (!data.subarray(0, SZDD_SIGNATURE.length).equals(SZDD_SIGNATURE)) {
		return undefined;
	}
	const prefix = readCwlPrefix(data);
	if (!prefix || prefix.length < CWD_HEADER_SIZE) return undefined;
	return readCwdLayout(prefix);
}

/**
 * `CwlFormat.Read`: the length the header gives is how much the pack unfolds to, and everything behind the
 * fourteen byte header is the pack. A stream that unfolds to fewer bytes than the header asked for leaves the
 * rest of the picture as it stands rather than throwing, which is a deviation in the message only.
 */
export function unfoldCwl(data: Buffer): Buffer | undefined {
	if (data.length < SZDD_HEADER_SIZE) return undefined;
	if (!data.subarray(0, SZDD_SIGNATURE.length).equals(SZDD_SIGNATURE)) {
		return undefined;
	}
	const length = data.readInt32LE(SZDD_LENGTH_FIELD);
	if (length < 0) return undefined;
	return inflateLzss(data.subarray(SZDD_HEADER_SIZE), {
		...LZSS_SETTINGS,
		outputLength: length,
	});
}

/**
 * The pixels of a picture of the plain format, which stand behind its header. The reference takes the whole
 * picture and throws where the file is short of it, so a short one is refused here as well.
 */
export function readCwdPixels(data: Buffer, layout: CrowdLayout): Buffer {
	const size = layout.width * layout.height * BYTES_PER_PIXEL;
	if (CWD_HEADER_SIZE + size > data.length) {
		throw invalidPicture("Crowd picture is cut short of its pixels");
	}
	return Buffer.from(data.subarray(CWD_HEADER_SIZE, CWD_HEADER_SIZE + size));
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** How much of a file the plain format has to hold for its header, and the packed one for its whole header. */
async function readHead(source: ByteSource, length: number): Promise<Buffer> {
	const room = Number(
		source.size < BigInt(length) ? source.size : BigInt(length),
	);
	return Buffer.from(await source.readAt(0n, room));
}

function pictureSize(layout: CrowdLayout): number {
	return layout.width * layout.height * BYTES_PER_PIXEL;
}

function checkSize(layout: CrowdLayout): number {
	const size = pictureSize(layout);
	if (!Number.isSafeInteger(size) || size > LIMIT) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`Crowd picture of ${size} bytes is too large`,
		);
	}
	return size;
}

const CWD_DESCRIPTOR_BASE = {
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
			source: "ArcFormats/Crowd/ImageCWL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
} as const;

export const crowdCwdImageDescriptor: FormatDescriptor = {
	id: "crowd-cwd-image",
	name: "Crowd hi-color bitmap",
	...CWD_DESCRIPTOR_BASE,
};

export const crowdCwlImageDescriptor: FormatDescriptor = {
	id: "crowd-cwl-image",
	name: "LZ-compressed Crowd bitmap",
	...CWD_DESCRIPTOR_BASE,
};

export const crowdCwdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdCwdImageDescriptor,
	detection: { signatures: [{ bytes: CWD_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(CWD_HEADER_SIZE)) return false;
		return readCwdLayout(await readHead(source, CWD_HEADER_SIZE)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCwdLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a Crowd picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: BigInt(CWD_HEADER_SIZE),
						size: BigInt(checkSize(layout)),
						compressed: false,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: REPORTED_DEPTH,
						},
					}),
					sizeKnown: true,
				},
			],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: REPORTED_DEPTH,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readCwdLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a Crowd picture");
		}
		checkSize(layout);
		const pixels = readCwdPixels(stored, layout);
		return Readable.from([
			writeBmp16(layout.width, layout.height, pixels, false),
		]);
	},
});

export const crowdCwlImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crowdCwlImageDescriptor,
	detection: { signatures: [{ bytes: SZDD_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(SZDD_HEADER_SIZE)) return false;
		return (
			readCwlLayout(
				await readHead(source, SZDD_HEADER_SIZE + SZDD_METADATA_INPUT),
			) !== undefined
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readCwlLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a Crowd picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: BigInt(CWD_HEADER_SIZE + checkSize(layout)),
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: REPORTED_DEPTH,
						},
					}),
					sizeKnown: true,
				},
			],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: REPORTED_DEPTH,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const unfolded = unfoldCwl(stored);
		if (!unfolded) {
			throw invalidPicture("Not a Crowd picture");
		}
		const layout = readCwdLayout(unfolded);
		if (!layout) {
			throw invalidPicture("Crowd picture does not hold a whole header");
		}
		checkSize(layout);
		const pixels = readCwdPixels(unfolded, layout);
		return Readable.from([
			writeBmp16(layout.width, layout.height, pixels, false),
		]);
	},
});
