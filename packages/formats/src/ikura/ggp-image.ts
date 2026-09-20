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
import { readPngHeaderFields } from "../shared/png.js";

/** The four bytes of the signature, which the reference packs into a word. */
const SIGNATURE = Buffer.from("GGPF", "latin1");
/** The letters the reference checks, which stand at the front of the header. */
const FAKE_HEADER = Buffer.from("GGPFAIKE", "latin1");
const HEADER_SIZE = 0x24;
/** The eight bytes of the key, which are laid over the first eight bytes of the header. */
const KEY_SIZE = 8;
const KEY_OFFSET = 0x0c;
const OFFSET_FIELD = 0x14;
const LENGTH_FIELD = 0x18;
/** How much of the picture is read to find the header of the portable network graphic inside it. */
const PNG_HEAD_SIZE = 0x40;

export interface GgpLayout {
	/** The key the picture is laid over with, which is eight bytes of the header laid over eight more. */
	key: Buffer;
	offset: number;
	length: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GgpFormat.ReadMetaData`: the letters `GGPFAIKE`, the eight bytes that stand twelve bytes behind them, and
 * the place and the length of the picture behind the header. The key is found by laying the first eight bytes
 * of the header — the letters themselves — over the eight bytes at offset `0x0C`, which is why a file whose
 * header is not all there or whose picture stands outside the file is turned away rather than throwing the way
 * the reference's own readers would.
 */
export function readGgpLayout(data: Buffer): GgpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, FAKE_HEADER.length).equals(FAKE_HEADER))
		return undefined;
	const key: Buffer = Buffer.alloc(KEY_SIZE, 0x00);
	for (let index = 0; index < KEY_SIZE; index += 1) {
		key[index] = (data[index] ?? 0) ^ (data[index + KEY_OFFSET] ?? 0);
	}
	const offset = data.readUInt32LE(OFFSET_FIELD);
	const length = data.readUInt32LE(LENGTH_FIELD);
	if (0 === length) return undefined;
	if (offset > data.length || length > data.length - offset) return undefined;
	return { key, offset, length };
}

/**
 * `EncryptedStream.Read`: every byte of the picture is laid over with the key, walking the key round and round
 * from its first byte, counted from the start of the picture rather than from anywhere the reader stands.
 */
export function decryptGgp(region: Buffer, key: Buffer): Buffer {
	const out: Buffer = Buffer.alloc(region.length, 0x00);
	for (let index = 0; index < region.length; index += 1) {
		out[index] = (region[index] ?? 0) ^ (key[index % KEY_SIZE] ?? 0);
	}
	return out;
}

/** What the portable network graphic behind the header says about itself. */
function readGgpPng(
	region: Buffer,
	key: Buffer,
): { width: number; height: number; bitsPerPixel: number } | undefined {
	const head = decryptGgp(region.subarray(0, PNG_HEAD_SIZE), key);
	return readPngHeaderFields(head);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ikuraGgpImageDescriptor: FormatDescriptor = {
	id: "ikura-ggp-image",
	name: "Digital Romance System encrypted image format",
	extensions: ["ggp", "gg"],
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
			source: "ArcFormats/Ikura/ImageGGP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikuraGgpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikuraGgpImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const stored = await readStored(source);
		const layout = readGgpLayout(stored);
		if (!layout) return false;
		const head = await source.readAt(
			BigInt(layout.offset),
			Math.min(layout.length, PNG_HEAD_SIZE),
		);
		return readGgpPng(Buffer.from(head), layout.key) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readGgpLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a GGP picture");
		}
		const region = stored.subarray(
			layout.offset,
			layout.offset + layout.length,
		);
		const png = readGgpPng(region, layout.key);
		if (!png) {
			throw invalidPicture(
				"GGP picture does not hold a portable network graphic",
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "png"),
						offset: BigInt(layout.offset),
						size: BigInt(layout.length),
						compressed: true,
						metadata: {
							type: "image",
							width: png.width,
							height: png.height,
							bitsPerPixel: png.bitsPerPixel,
						},
					}),
					sizeKnown: true,
				},
			],
			metadata: {
				image: "png",
				compression: "xor",
				width: png.width,
				height: png.height,
				bitsPerPixel: png.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGgpLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a GGP picture");
		}
		const region = stored.subarray(
			layout.offset,
			layout.offset + layout.length,
		);
		const png = readGgpPng(region, layout.key);
		if (!png) {
			throw invalidPicture(
				"GGP picture does not hold a portable network graphic",
			);
		}
		return Readable.from([decryptGgp(region, layout.key)]);
	},
});
