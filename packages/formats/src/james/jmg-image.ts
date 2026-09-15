// Format reference: GARbro "Legacy/James/ImageJMG.cs", classes `JmgFormat`, `JmgMetaData` and the enum
// `Obfuscation` (the JAMES engine obfuscated bitmap, seen in Berserker's "Situation" and "Situation 2").
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The two words the reference reads the obfuscation of a picture from, which are `'BM'` turned about. */
const ROTATE_MAGIC = Buffer.from([0xd4, 0x24]);
const REVERSE_MAGIC = Buffer.from([0xb2, 0x42]);
/** How much of the picture the reference takes the measurements from. */
const HEADER_PASS_SIZE = 0x40;

/** The two ways the reference obfuscates a picture: the words of the picture turned about, or their bits. */
export type JmgObfuscation = "rotateWords" | "reverseBits";

export interface JmgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	method: JmgObfuscation;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The obfuscation the two words at the start of a picture stand for, if any. */
function jmgMethod(data: Buffer): JmgObfuscation | undefined {
	if (data.length < 2) return undefined;
	const head = data.subarray(0, 2);
	if (head.equals(ROTATE_MAGIC)) return "rotateWords";
	if (head.equals(REVERSE_MAGIC)) return "reverseBits";
	return undefined;
}

/**
 * `JmgFormat.OpenAsBitmap` with the two ways of the reference behind it: `RotateWords` turns every word of
 * the picture left by four bits — four turns of the walk take a word back where it was, since the walk only
 * ever goes one way — and `ReverseBits` turns the sixteen bits of every word around, which is its own way
 * back. The reference reads a whole word at the end of the picture even when there is only half of one left,
 * which throws; the port refuses that picture.
 */
export function deobfuscateJmg(data: Buffer, method: JmgObfuscation): Buffer {
	const out = Buffer.from(data);
	if (0 !== out.length % 2) {
		throw invalidPicture("JAMES picture ends in the middle of a word");
	}
	for (let position = 0; position < out.length; position += 2) {
		const word = out.readUInt16LE(position);
		let value: number;
		if ("rotateWords" === method) {
			value = ((word >> 12) | (word << 4)) & 0xffff;
		} else {
			let bits = word;
			bits = ((bits & 0xaaaa) >> 1) | ((bits & 0x5555) << 1);
			bits = ((bits & 0xcccc) >> 2) | ((bits & 0x3333) << 2);
			bits = ((bits & 0xf0f0) >> 4) | ((bits & 0x0f0f) << 4);
			bits = ((bits & 0xff00) >> 8) | ((bits & 0x00ff) << 8);
			value = bits & 0xffff;
		}
		out.writeUInt16LE(value, position);
	}
	return out;
}

/**
 * `JmgFormat.ReadMetaData`: the picture begins with the obfuscated word `'BM'`, and the measurements come
 * from the header of the bitmap that stands behind it. The reference deobfuscates only the first `0x40`
 * bytes for this and reads the rest of the bitmap when the picture itself is asked for; a file too short to
 * hold that much is turned away, since the reference would read past the end of what it holds.
 */
export function readJmgLayout(data: Buffer): JmgLayout | undefined {
	if (data.length < HEADER_PASS_SIZE) return undefined;
	const method = jmgMethod(data);
	if (!method) return undefined;
	const head = deobfuscateJmg(data.subarray(0, HEADER_PASS_SIZE), method);
	const fields = readBmpHeaderFields(head);
	if (!fields) return undefined;
	return {
		width: fields.width,
		height: fields.height,
		bitsPerPixel: fields.bitsPerPixel,
		method,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const jamesJmgImageDescriptor: FormatDescriptor = {
	id: "james-jmg-image",
	name: "JAMES engine obfuscated bitmap",
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
			source: "Legacy/James/ImageJMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const jamesJmgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: jamesJmgImageDescriptor,
	// The reference registers the word of nothing, so the format is a candidate for every file; the two
	// obfuscated letters of a bitmap are what actually gates it.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 2n) return false;
		return readJmgLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readJmgLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a JAMES picture");
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
		const layout = readJmgLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a JAMES picture");
		}
		// The whole picture is turned back into the bitmap it is, which the port reads and writes out again.
		const plain = deobfuscateJmg(stored, layout.method);
		const image = readBmpImage(plain);
		if (!image) {
			throw invalidPicture("Not a JAMES picture");
		}
		return Readable.from([writeBmpImage(image)]);
	},
});
