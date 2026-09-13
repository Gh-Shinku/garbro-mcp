// Format reference: GARbro ArcFormats/MokoPro/CompressedFile.cs, classes `MokoCrypt` and `NNNNOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'NNNN', the signature of the compressed container. */
const SIGNATURE = 0x4e4e4e4e;
/** The payload starts with the signature and the unpacked size. */
const HEADER_SIZE = 8;
const UNPACKED_SIZE_FIELD = 4;
/** GARbro `MokoCrypt.DefaultKey`. */
const KEY_FIRST = 1;
const KEY_SECOND = 0x23;
/** GARbro `LzssStream` with a ring buffer filled with spaces. */
const FRAME_FILL = 0x20;

/**
 * GARbro `MokoCrypt.Decrypt`: a backward pass over the payload that mixes every byte with its successor
 * and with the two key bytes.
 */
export function decryptMoko(input: Buffer): void {
	for (let i = input.length - 2; i >= 0; i -= 1) {
		input[i] = (input[i] ?? 0) ^ (KEY_SECOND ^ (input[i + 1] ?? 0));
		input[i + 1] = (input[i + 1] ?? 0) ^ (KEY_FIRST ^ (input[i] ?? 0));
	}
}

async function readHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize <= 0) return undefined;
	return unpackedSize;
}

function toFixedEntries(
	size: number,
	packedSize: bigint,
	sourcePath: string,
): FixedEntry[] {
	return [
		createFixedEntry({
			id: 0,
			path: basename(sourcePath),
			offset: 0n,
			size: BigInt(size),
			packedSize,
			compressed: true,
			encrypted: true,
			metadata: { type: "data" },
		}),
	];
}

/**
 * GARbro `NNNNOpener.OpenEntry` runs the whole file through `MokoCrypt` and decodes the result as an LZSS
 * stream, so the port decrypts a copy of the payload and unpacks it with a space filled ring buffer.
 */
async function openNnnnEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	// The reference decrypts everything behind the header, not the header itself.
	const payload = stored.subarray(HEADER_SIZE);
	decryptMoko(payload);
	return Readable.from([
		inflateLzss(payload, {
			outputLength: Number(entry.size),
			frameFill: FRAME_FILL,
		}),
	]);
}

export const mokoProNnnnDescriptor: FormatDescriptor = {
	id: "mokopro-nnnn",
	name: "Mokopro compressed file",
	extensions: ["dat"],
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
			source: "ArcFormats/MokoPro/CompressedFile.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mokoProNnnnFormat = defineFixedArchive({
	descriptor: mokoProNnnnDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("NNNN", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readHeader(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const unpackedSize = await readHeader(source);
		if (unpackedSize === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mokopro layout");
		return {
			entries: toFixedEntries(unpackedSize, source.size, sourcePath),
			metadata: { entryCount: 1 },
		};
	},
	openEntry: openNnnnEntry,
});
