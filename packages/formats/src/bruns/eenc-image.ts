// Format reference: GARbro "ArcFormats/Bruns/ImageEENC.cs", classes `EencFormat`, `EencMetaData` and
// `EencStream` (a Bruns picture: a walk of bytes over a key of four bytes, then — where the fourth letter of
// the word is a Z — a walk of the zlib kind, behind which a picture of a kind this project knows stands).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readPngHeaderFields } from "../shared/png.js";

/** The two words the reference registers: `EENC`, and `EENZ` where the payload is packed. */
const SIGNATURE = Buffer.from("EENC", "latin1");
const SIGNATURE_PACKED = Buffer.from("EENZ", "latin1");
const HEADER_SIZE = 8;
/** The key the word of the head stands over. */
const EENC_KEY = 0xdeadbeef;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface EencLayout {
	/** Whether the picture behind the walk of bytes is packed by a walk of the zlib kind. */
	compressed: boolean;
	/** The key the walk of bytes stands over. */
	key: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `EencFormat.ReadMetaData`: the four bytes at the beginning of the file are the word of the format, the
 * fourth of them saying by a `Z` whether the picture behind the walk of bytes is packed; the word behind the
 * word stands over a key of the reference, which is the key the walk of bytes stands over.
 */
export function readEencLayout(
	data: Buffer,
	fileLength = data.length,
): EencLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const word = data.subarray(0, 4);
	if (!word.equals(SIGNATURE) && !word.equals(SIGNATURE_PACKED)) {
		return undefined;
	}
	if (fileLength <= HEADER_SIZE) return undefined;
	return {
		compressed: 0x5a === (data[3] ?? 0),
		key: (data.readUInt32LE(4) ^ EENC_KEY) >>> 0,
	};
}

/**
 * `EencStream.Read`: every byte of the walk stands over a byte of the key, the four bytes of the key standing
 * over and over from the lowest of them.
 */
export function decryptEenc(payload: Buffer, key: number): Buffer {
	const output: Buffer = Buffer.alloc(payload.length, 0x00);
	for (let index = 0; index < payload.length; index += 1) {
		const shift = (index & 3) << 3;
		output[index] = (payload[index] ?? 0) ^ ((key >>> shift) & 0xff);
	}
	return output;
}

/** What stands behind the walk of bytes of the head, walked out of the zlib kind where the head says so. */
export async function unpackEenc(
	stored: Buffer,
	layout: EencLayout,
): Promise<Buffer> {
	const plain = decryptEenc(stored.subarray(HEADER_SIZE), layout.key);
	if (!layout.compressed) return plain;
	return inflateZlibBufferCapped(plain, LIMIT);
}

/** What kind of picture stands behind the walk of bytes, as far as this project reads one. */
export function readEencPicture(
	payload: Buffer,
):
	| { extension: string; width: number; height: number; bitsPerPixel: number }
	| undefined {
	const bmp = readBmpMetaData(payload);
	if (bmp) {
		return {
			extension: "bmp",
			width: bmp.width,
			height: bmp.height,
			bitsPerPixel: bmp.bitsPerPixel,
		};
	}
	const png = readPngHeaderFields(payload);
	if (png) {
		return {
			extension: "png",
			width: png.width,
			height: png.height,
			bitsPerPixel: png.bitsPerPixel,
		};
	}
	return undefined;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The reference reads any picture its own catalog knows; the port reads a bitmap and a portable network graphic. */
async function readPicture(source: ByteSource): Promise<
	| {
			payload: Buffer;
			picture: {
				extension: string;
				width: number;
				height: number;
				bitsPerPixel: number;
			};
	  }
	| undefined
> {
	const layout = readEencLayout(
		Buffer.from(await source.readAt(0n, HEADER_SIZE)),
		Number(source.size),
	);
	if (!layout) return undefined;
	const payload = await unpackEenc(await readStored(source), layout);
	const picture = readEencPicture(payload);
	return picture ? { payload, picture } : undefined;
}

export const brunsEencImageDescriptor: FormatDescriptor = {
	id: "bruns-eenc-image",
	name: "Bruns system encrypted image",
	extensions: ["brs", "png", "bmp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Bruns/ImageEENC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const brunsEencImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: brunsEencImageDescriptor,
	// The reference registers the two words `EENC` and `EENZ`, and the three names of the format.
	detection: {
		signatures: [{ bytes: SIGNATURE }, { bytes: SIGNATURE_PACKED }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size <= BigInt(HEADER_SIZE)) return false;
		try {
			return (await readPicture(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const picture = await readPicture(source);
		if (!picture) throw invalidPicture("Not a Bruns picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, picture.picture.extension),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				encrypted: true,
				metadata: {
					type: "image",
					width: picture.picture.width,
					height: picture.picture.height,
					bitsPerPixel: picture.picture.bitsPerPixel,
				},
			}),
			// The walk of bytes gives the picture as it stands, of whichever of the two kinds it is.
		};
		return {
			entries: [entry],
			metadata: {
				image: picture.picture.extension,
				bitsPerPixel: picture.picture.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const picture = await readPicture(source);
		if (!picture) throw invalidPicture("Not a Bruns picture");
		return Readable.from([picture.payload]);
	},
});
