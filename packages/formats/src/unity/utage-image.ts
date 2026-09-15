// Format reference: GARbro "ArcFormats/Unity/Utage/ImageUTAGE.cs", classes `UtageFormat`,
// `UtageMetaData` and `UtageEncryptedStream` (Utage engine encrypted image). GARbro commit
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
} from "../shared/fixed-archive.js";
import { readJpegHeaderFields } from "../shared/jpeg.js";
import { readPngHeaderFields } from "../shared/png.js";

/** The portrait of the signature of a PNG behind the key of this format, which the reference registers too. */
const SIGNATURE = Buffer.from([0xc0, 0x3e, 0x3e, 0x32]);
/** `UtageFormat.KnownKey`, the key the reference carries for the pictures of the engine. */
const KNOWN_KEY = Buffer.from("InputOriginalKey", "utf8");

export type UtageImageKind = "png" | "jpeg";

export interface UtageLayout {
	kind: UtageImageKind;
	width: number;
	height: number;
	bitsPerPixel: number;
}

/**
 * `UtageEncryptedStream.Read`: every byte is taken with the key byte that stands over it — the key repeated —
 * and kept as it is when it is **nothing** or when it is the key byte itself, and turned over with it
 * otherwise. The rule is its own opposite, so this both reads and writes the stream. A byte at the end of the
 * file that the key would turn over into nothing, or into the key byte, is where the reference loses the
 * plain byte, and is left where it is.
 */
export function decryptUtage(data: Buffer): Buffer {
	const output: Buffer = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1) {
		const key = KNOWN_KEY[index % KNOWN_KEY.length] ?? 0;
		const byte = output[index] ?? 0;
		if (byte !== 0 && byte !== key) {
			output[index] = byte ^ key;
		}
	}
	return output;
}

/**
 * `UtageFormat.ReadMetaData`: the picture behind the key is a **PNG** when the file carries the word the
 * format registers for it, and a **JPEG** otherwise — the reference registers the word of nothing as well, so
 * a file of any name is offered to it, and a file that does not turn into a JPEG is not claimed. The
 * measurements come from the header of that picture.
 */
export function readUtageLayout(data: Buffer): UtageLayout | undefined {
	if (data.length < 4) return undefined;
	const decrypted = decryptUtage(data);
	if (data.subarray(0, 4).equals(SIGNATURE)) {
		const fields = readPngHeaderFields(decrypted);
		return fields ? { kind: "png", ...fields } : undefined;
	}
	const fields = readJpegHeaderFields(decrypted);
	return fields ? { kind: "jpeg", ...fields } : undefined;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const utageImageDescriptor: FormatDescriptor = {
	id: "unity-utage-image",
	name: "Utage engine encrypted image",
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
			source: "ArcFormats/Unity/Utage/ImageUTAGE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The picture is handed out as it stands, because the project carries no decoder for either of the two. */
const EXTENSIONS: Record<UtageImageKind, string> = {
	png: "png",
	jpeg: "jpg",
};

export const utageImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: utageImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
		extensionFallback: true,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 4n) return false;
		return readUtageLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readUtageLayout(await readStored(source));
		if (!layout) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Utage picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, EXTENSIONS[layout.kind]),
						offset: 0n,
						size: source.size,
						compressed: false,
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
				image: EXTENSIONS[layout.kind],
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		if (!readUtageLayout(stored)) {
			throw new GarbroError("INVALID_ARCHIVE", "Not a Utage picture");
		}
		return Readable.from([decryptUtage(stored)]);
	},
});
