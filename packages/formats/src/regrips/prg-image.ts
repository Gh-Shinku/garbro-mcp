// Format reference: GARbro "Legacy/Regrips/ImagePRG.cs", class `PrgFormat` (Regrips encrypted image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import { PNG_SIGNATURE, readPngHeaderFields } from "../shared/png.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The whole file is xored with this byte; the reference's own stream takes a single byte key. */
export const REGRIPS_KEY = 0xff;
/** Eight bytes of signature, the chunk's own length and type, then the thirteen byte header. */
const PNG_MINIMUM_SIZE = 16 + 13;

/** Decrypts a Regrips file, which is a single byte xor over every byte of it. */
export function decryptRegrips(input: Buffer): Buffer {
	const output: Buffer = Buffer.alloc(input.length);
	for (let index = 0; index < input.length; index += 1) {
		output[index] = (input[index] ?? 0) ^ REGRIPS_KEY;
	}
	return output;
}

export { PNG_SIGNATURE, readPngHeaderFields };

export const prgImageDescriptor: FormatDescriptor = {
	id: "regrips-prg-image",
	name: "Regrips encrypted image",
	extensions: [],
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
			source: "Legacy/Regrips/ImagePRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const prgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: prgImageDescriptor,
	// The file is an xored portable network graphic, so the stored bytes are the signature's own xor.
	detection: {
		signatures: [
			{ bytes: PNG_SIGNATURE.subarray(0, 4).map((x) => x ^ REGRIPS_KEY) },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(PNG_MINIMUM_SIZE)) return false;
		try {
			const head = Buffer.from(await source.readAt(0n, PNG_MINIMUM_SIZE));
			return readPngHeaderFields(decryptRegrips(head)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		if (source.size < BigInt(PNG_MINIMUM_SIZE)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips image");
		}
		const head = Buffer.from(await source.readAt(0n, PNG_MINIMUM_SIZE));
		const fields = readPngHeaderFields(decryptRegrips(head));
		if (!fields)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "png"),
				// Decrypting keeps the length, so the reference's own stream reports the whole file.
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: fields.width,
					height: fields.height,
					bitsPerPixel: fields.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "png",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if (source.size >= BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new GarbroError("INVALID_ARCHIVE", "Regrips image is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const plain = decryptRegrips(file);
		if (!readPngHeaderFields(plain)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips image");
		}
		// The reference decodes the graphic and re-encodes it; the port hands the decrypted original over, which
		// keeps every chunk it holds.
		return Readable.from([plain]);
	},
});
