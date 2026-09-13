// Format reference: GARbro "Legacy/Regrips/ImagePRG.cs", class `BrgFormat` (Regrips encrypted bitmap), which
// extends `PrgFormat` and shares its encryption.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpHeaderFields } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { decryptRegrips } from "./prg-image.js";

/** `BM` xored, which is all the reference checks before it decrypts. */
export const BRG_PREFIX: Buffer = Buffer.from([0xbd, 0xb2]);
/** A bitmap's file header plus the shortest DIB header the shared reader accepts. */
const BMP_MINIMUM_SIZE = 54;

export const brgImageDescriptor: FormatDescriptor = {
	id: "regrips-brg-image",
	name: "Regrips encrypted bitmap",
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

async function readDecrypted(
	source: ByteSource,
	length: number,
): Promise<Buffer | undefined> {
	try {
		const head = Buffer.from(
			await source.readAt(0n, Math.min(length, Number(source.size))),
		);
		return decryptRegrips(head);
	} catch {
		return undefined;
	}
}

export const brgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: brgImageDescriptor,
	detection: { signatures: [{ bytes: BRG_PREFIX }] },
	async detect(source: ByteSource): Promise<boolean> {
		const plain = await readDecrypted(source, BMP_MINIMUM_SIZE);
		if (!plain) return false;
		// Only the header is available here, so the bitmap's own size word is not compared with anything: the
		// reference clamps a size larger than the file rather than refusing it.
		return readBmpHeaderFields(plain) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const plain = await readDecrypted(source, BMP_MINIMUM_SIZE);
		const fields = plain ? readBmpHeaderFields(plain) : undefined;
		if (!fields)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				// The xor keeps the length, so the whole file is the entry.
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
				image: "bmp",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if (source.size >= BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new GarbroError("INVALID_ARCHIVE", "Regrips bitmap is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const plain = decryptRegrips(file);
		if (!readBmpHeaderFields(plain)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips bitmap");
		}
		// The reference decodes the bitmap; the port hands the decrypted original over, padding and all.
		return Readable.from([plain]);
	},
});
