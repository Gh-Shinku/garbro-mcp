// Format reference: GARBro ArcFormats/Cyberworks/ArcAPP.cs, class `AppOpener` plus `AppendixReader`, which
// stands on the `TocUnpacker` and `IndexReader` machinery of ArcDAT.cs.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readTocIndex, unpackToc } from "./toc.js";

/** The reference registers the archive with a one-byte signature that has to be the first byte of the count. */
const SIGNATURE_BYTE = 0x2f;
/** The tables of contents of this family use eight-digit decimal fields. */
const TOC_NUM_LENGTH = 8;
/** The data area starts behind the fields and the packed table. */
const TOC_HEADER_SIZE = TOC_NUM_LENGTH * 2;
const TYPE_LOW = 0x20;
const TYPE_HIGH = 0x7f;
/** Extensions that mark an entry as an image, and the ones that mark audio. */
const IMAGE_EXTENSIONS = new Set(["b0", "n0", "o0", "0b", "w0"]);
const AUDIO_EXTENSIONS = new Set(["j0", "k0", "u0"]);

/**
 * GARBro `AppendixReader.ReadEntryType`. Two bytes hold the entry's extension when both are printable, and only
 * the first one when the second is not. A payload offset is rebased by the data area the table declared before
 * placement is checked.
 */
function readAppendixType(
	index: Buffer,
	position: number,
	dataOffset: bigint,
): { extension?: string; type?: string; image?: boolean; offsetDelta: bigint } {
	// The reference reads the bytes as stream bytes, so a truncated record yields no extension.
	const first = index[position];
	const second = index[position + 1];
	const outcome: {
		extension?: string;
		type?: string;
		image?: boolean;
		offsetDelta: bigint;
	} = { offsetDelta: dataOffset };
	if (first === undefined || first <= TYPE_LOW || first >= TYPE_HIGH)
		return outcome;
	const printable =
		second !== undefined && second > TYPE_LOW && second < TYPE_HIGH;
	const extension = printable
		? String.fromCharCode(first, second)
		: String.fromCharCode(first);
	outcome.extension = extension;
	if (IMAGE_EXTENSIONS.has(extension)) {
		outcome.type = "image";
		outcome.image = true;
	} else if (AUDIO_EXTENSIONS.has(extension)) {
		outcome.type = "audio";
	}
	return outcome;
}

/**
 * GARBro `AppOpener.TryOpen`. The count word opens the file and doubles as the signature, and the table of
 * contents it points at is a decimal-prefixed LZSS stream. Entry payloads are rebased by the data area behind
 * that table, and an archive without entries is declined.
 */
async function readCyberworksAppendix(
	source: ByteSource,
): Promise<{ entries: FixedEntry[]; hasImages: boolean } | undefined> {
	if (source.size < 8n) return undefined;
	const header = await source.readAt(0n, 8);
	if ((header[0] ?? 0) !== SIGNATURE_BYTE) return undefined;
	const indexOffset = 4 + header.readInt32LE(0) * 2;
	if (indexOffset <= 4 || BigInt(indexOffset) >= source.size) return undefined;
	const toc = await unpackToc(source, indexOffset, TOC_NUM_LENGTH);
	if (!toc) return undefined;
	const dataOffset = BigInt(indexOffset + TOC_HEADER_SIZE + toc.packedSize);
	const result = readTocIndex(toc.toc, source.size, (index, position) =>
		readAppendixType(index, position, dataOffset),
	);
	if (!result || result.entries.length === 0) return undefined;
	return result;
}

/** GARBro `DatOpener.OpenEntry`: packed payloads are LZSS streams, everything else is stored. */
async function openAppendixEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	return Readable.from([inflateLzssAll(data)]);
}

export const cyberworksAppendixDescriptor: FormatDescriptor = {
	id: "cyberworks-appendix",
	name: "WendyBell resource archive",
	extensions: ["appendix"],
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
			source: "ArcFormats/Cyberworks/ArcAPP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cyberworksAppendixFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cyberworksAppendixDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([SIGNATURE_BYTE]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readCyberworksAppendix(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const result = await readCyberworksAppendix(source);
		if (!result)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Cyberworks APP layout");
		return {
			entries: result.entries,
			metadata: {
				entryCount: result.entries.length,
				hasImages: result.hasImages,
			},
		};
	},
	openEntry: openAppendixEntry,
});
