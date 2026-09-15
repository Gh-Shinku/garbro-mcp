// Format reference: GARbro "Legacy/Saiki/ImageJPX.cs", classes `ObfuscatedImageFormat`, `JpxFormat` and
// `BmxFormat` (Saiki's obfuscated pictures). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	readBmpHeaderFields,
	readBmpImage,
	writeBmpImage,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";

/** The two words the reference reads behind the two letters of a picture. */
const JPX_SIGNATURE = Buffer.from([0x00, 0x93, 0xff, 0x38]);
const BMX_SIGNATURE = Buffer.from([0xbd, 0x59]);
/** How much of the file behind the two letters is obfuscated. */
const ENCRYPTED_LENGTH = 200;

export interface SaikiLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** GARbro `Binary.RotByteL`: a byte turned left, its top bits coming back in at the bottom. */
function rotateLeft(value: number, count: number): number {
	const shift = count & 7;
	return ((value << shift) | (value >> (8 - shift))) & 0xff;
}

/**
 * `ObfuscatedImageFormat.OpenEncrypted`: the first two bytes of the file are turned about and then a run of
 * two hundred bytes from the third on is turned left by a shift that walks from one to six and starts over
 * every so many bytes — how many, and which of the two bytes the file begins with says so, is itself decided
 * by the same two bytes, and the shift starts over at four turns or less. The whole header is handed back in
 * front of the rest of the file, which stands as it is. A file too short to hold its header gives up; the
 * reference reads what there is and the port does the same, with nothing behind the shortened header.
 */
export function decryptSaiki(
	data: Buffer,
	encryptedLength = ENCRYPTED_LENGTH,
): Buffer | undefined {
	const length = Math.min(data.length, encryptedLength + 2);
	if (length < 2) return undefined;
	const header = Buffer.from(data.subarray(0, length));
	header[0] = (header[0] ?? 0) ^ 0xff;
	// The complement is taken of the byte itself, as the reference casts it back to a byte first.
	header[1] = rotateLeft(~(header[1] ?? 0) & 0xff, 1);
	let shift = 1;
	let count = header[0] ?? 0;
	for (let index = 2; index < header.length; index += 1) {
		header[index] = rotateLeft(header[index] ?? 0, shift);
		shift += 1;
		if (shift >= 7) shift = 1;
		count -= 1;
		if (0 === count) {
			count = shift <= 4 ? (header[1] ?? 0) : (header[0] ?? 0);
			shift = 1;
		}
	}
	return Buffer.concat([header, data.subarray(header.length)]);
}

/** `JpxFormat.ReadMetaData`: the two letters, and then an obfuscated picture that has to be a JPEG. */
export function readSaikiJpxLayout(data: Buffer): SaikiLayout | undefined {
	if (data.length < 2) return undefined;
	if (data[0] !== 0x00 || data[1] !== 0x93) return undefined;
	const plain = decryptSaiki(data);
	if (!plain) return undefined;
	const fields = readJpegHeaderFields(plain);
	if (!fields) return undefined;
	return {
		width: fields.width,
		height: fields.height,
		bitsPerPixel: fields.bitsPerPixel,
	};
}

/** `BmxFormat.ReadMetaData`: the two letters, and then an obfuscated picture that has to be a bitmap. */
export function readSaikiBmxLayout(data: Buffer): SaikiLayout | undefined {
	if (data.length < 2) return undefined;
	if (data[0] !== BMX_SIGNATURE[0] || data[1] !== BMX_SIGNATURE[1]) {
		return undefined;
	}
	const plain = decryptSaiki(data);
	if (!plain) return undefined;
	const fields = readBmpHeaderFields(plain);
	if (!fields) return undefined;
	return {
		width: fields.width,
		height: fields.height,
		bitsPerPixel: fields.bitsPerPixel,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const saikiJpxImageDescriptor: FormatDescriptor = {
	id: "saiki-jpx-image",
	name: "Saiki obfuscated JPEG image",
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
			source: "Legacy/Saiki/ImageJPX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const saikiJpxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: saikiJpxImageDescriptor,
	// The reference registers `0x38FF9300` beside the word of nothing, which is the two letters above.
	detection: { signatures: [{ bytes: JPX_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 2n) return false;
		return readSaikiJpxLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readSaikiJpxLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a Saiki picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "jpg"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "jpeg",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		if (!readSaikiJpxLayout(stored)) {
			throw invalidPicture("Not a Saiki picture");
		}
		// The picture is handed out as the JPEG it is once the obfuscation is off, because the project carries
		// no decoder for it; the bytes are the ones the reference decodes.
		const plain = decryptSaiki(stored);
		if (!plain) {
			throw invalidPicture("Not a Saiki picture");
		}
		return Readable.from([plain]);
	},
});

export const saikiBmxImageDescriptor: FormatDescriptor = {
	id: "saiki-bmx-image",
	name: "Saiki obfuscated bitmap",
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
			source: "Legacy/Saiki/ImageJPX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const saikiBmxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: saikiBmxImageDescriptor,
	// The reference registers the word of nothing for this format, so it is a candidate for every file; the
	// two letters behind the obfuscation are what actually gate it.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 2n) return false;
		return readSaikiBmxLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readSaikiBmxLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a Saiki picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: layout.bitsPerPixel,
						},
					}),
					sizeKnown: false,
				},
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
		if (!readSaikiBmxLayout(stored)) {
			throw invalidPicture("Not a Saiki picture");
		}
		const plain = decryptSaiki(stored);
		if (!plain) {
			throw invalidPicture("Not a Saiki picture");
		}
		// The obfuscation is taken off and the bitmap behind it is read and written out again, the way the
		// reference reads and writes it.
		const image = readBmpImage(plain);
		if (!image) {
			throw invalidPicture("Not a Saiki picture");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
