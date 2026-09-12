// Format reference: GARbro ArcFormats/Ail/ArcAil.cs and ArcFormats/Ail/ArcLNK2.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveDetectionHints,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const LNK2_SIGNATURE = Buffer.from("LNK2", "ascii");
const TRAILING_LIMIT = 0x80000n;
const PREVIEW_SIZE = 16;
const SIGNATURE_SIZE = 4;
const HEADER_SIZE = 6;

/** The Ail opener uses the reversed control bit and a space-filled 4 KiB frame. */
const AIL_LZSS = {
	frameSize: 0x1000,
	frameFill: 0x20,
	frameInitPosition: 0xfee,
	literalBit: 0 as const,
};

const SIGNATURE_EXTENSIONS: readonly {
	signature: Buffer;
	extension: string;
}[] = [
	{ signature: Buffer.from("OggS", "ascii"), extension: "ogg" },
	{ signature: Buffer.from("RIFF", "ascii"), extension: "wav" },
	{ signature: Buffer.from([0x89, 0x50, 0x4e, 0x47]), extension: "png" },
	{ signature: Buffer.from("BM", "ascii"), extension: "bmp" },
];

function inferExtension(signature: Buffer): string | undefined {
	if (signature.length >= 4 && signature.readUInt32LE(0) === 0xba010000)
		return "mpg";
	return SIGNATURE_EXTENSIONS.find((candidate) =>
		signature
			.subarray(0, candidate.signature.length)
			.equals(candidate.signature),
	)?.extension;
}

function descriptor(
	id: string,
	name: string,
	extensions: string[],
): FormatDescriptor {
	return {
		id,
		name,
		extensions,
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
				source: "ArcFormats/Ail/ArcAil.cs",
				license: "MIT",
				commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
			},
			{
				project: "GARbro",
				source: "ArcFormats/Ail/ArcLNK2.cs",
				license: "MIT",
				commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
			},
		],
	};
}

export const ailDatDescriptor = descriptor("ail-dat", "Ail resource archive", [
	"dat",
	"snl",
]);

export const lnk2Descriptor = descriptor(
	"ail-lnk2",
	"Ail LNK2 resource archive",
	["dat"],
);

interface AilEntryInfo {
	packed: boolean;
	unpackedSize: bigint;
	extension?: string;
}

function infoOf(entry: FixedEntry): AilEntryInfo {
	const metadata = entry.metadata ?? {};
	return {
		packed: metadata.packed === true,
		unpackedSize: BigInt(
			typeof metadata.unpackedSize === "string"
				? metadata.unpackedSize
				: entry.size,
		),
		...(typeof metadata.extension === "string"
			? { extension: metadata.extension }
			: {}),
	};
}

const ailEntryOpener: FixedEntryOpener = async (source, entry) => {
	const info = infoOf(entry);
	if (!info.packed) return source.createReadStream(entry.offset, entry.size);
	const uncompressedLength = Number(info.unpackedSize);
	if (
		!Number.isSafeInteger(uncompressedLength) ||
		uncompressedLength < 0 ||
		uncompressedLength > 0x7fffffff
	) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Ail entry declares an invalid unpacked size",
		);
	}
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	const output = inflateLzss(compressed, {
		...AIL_LZSS,
		outputLength: uncompressedLength,
	});
	if (output.length !== uncompressedLength) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Ail entry LZSS stream ended before the declared size",
		);
	}
	return Readable.from([output]);
};

async function detectFileTypes(
	source: ByteSource,
	entries: FixedEntry[],
): Promise<void> {
	for (const entry of entries) {
		if (entry.size < BigInt(HEADER_SIZE)) continue;
		const header = await source.readAt(
			entry.offset,
			Number(entry.size > 8n ? 8n : entry.size),
		);
		const signature = header.readUInt32LE(0);
		let extra = BigInt(HEADER_SIZE);
		let packed = false;
		let unpackedSize = entry.size;
		if ((signature & 0xffff) === 1) {
			packed = true;
			unpackedSize = BigInt(header.readUInt32LE(2));
		} else if (
			signature === 0 ||
			header.subarray(4, 8).equals(Buffer.from("OggS", "ascii"))
		) {
			extra = 4n;
		}
		const dataOffset = entry.offset + extra;
		const dataSize = entry.size - extra;
		if (dataSize < 0n) continue;
		let typeSignature: Buffer;
		if (packed) {
			const previewLength = Number(
				dataSize > BigInt(PREVIEW_SIZE) ? BigInt(PREVIEW_SIZE) : dataSize,
			);
			const preview = await source.readAt(dataOffset, previewLength);
			typeSignature = inflateLzss(preview, {
				...AIL_LZSS,
				outputLength: SIGNATURE_SIZE,
			});
		} else {
			const previewLength = Number(dataSize > 4n ? 4n : dataSize);
			typeSignature = await source.readAt(dataOffset, previewLength);
		}
		const extension = inferExtension(typeSignature);
		const metadata: Record<string, unknown> = { packed };
		if (packed) metadata.unpackedSize = unpackedSize.toString();
		if (extension) metadata.extension = extension;
		const path = extension ? `${entry.path}.${extension}` : entry.path;
		const updated = createFixedEntry({
			id: entry.id,
			path,
			offset: dataOffset,
			size: dataSize,
			compressed: packed,
			metadata,
		});
		if (entry.rawPath !== undefined) updated.rawPath = entry.rawPath;
		Object.assign(entry, updated);
	}
}

async function readAilIndex(
	source: ByteSource,
	sourcePath: string,
	indexOffset: number,
	count: number,
): Promise<FixedEntry[]> {
	const baseName = basename(sourcePath, extname(sourcePath));
	let offset = BigInt(indexOffset + count * 4);
	if (offset >= source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "Ail index is truncated");
	}
	const index = await source.readAt(BigInt(indexOffset), count * 4);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const size = BigInt(index.readUInt32LE(id * 4));
		if (size === 0n || size === 0xffffffffn) continue;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Ail entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: `${baseName}#${String(id).padStart(5, "0")}`,
				offset,
				size,
			}),
		);
		offset += size;
	}
	if (entries.length === 0 || source.size - offset > TRAILING_LIMIT) {
		throw new GarbroError("INVALID_ARCHIVE", "Ail index layout is invalid");
	}
	await detectFileTypes(source, entries);
	return entries;
}

function createAilFormat(options: {
	descriptor: FormatDescriptor;
	detection: ArchiveDetectionHints;
	detect(source: ByteSource, sourcePath: string): Promise<boolean>;
	read(
		source: ByteSource,
		sourcePath: string,
	): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }>;
}): ArchiveFormat {
	return defineFixedArchive({
		...options,
		openEntry: ailEntryOpener,
	});
}

export const ailDatFormat: ArchiveFormat = createAilFormat({
	descriptor: ailDatDescriptor,
	detection: { extensionFallback: true },
	async detect(source, sourcePath) {
		const extension = sourceExtension(sourcePath);
		if (extension !== "dat" && extension !== "snl") return false;
		if (source.size < 8n) return false;
		const count = (await source.readAt(0n, 4)).readInt32LE(0);
		if (!isSaneCount(count)) return false;
		return BigInt(4 + count * 4) < source.size;
	},
	async read(source, sourcePath) {
		const count = (await source.readAt(0n, 4)).readInt32LE(0);
		if (!isSaneCount(count)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ail DAT entry count");
		}
		const entries = await readAilIndex(source, sourcePath, 4, count);
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
});

async function parseLnk2(source: ByteSource): Promise<number | undefined> {
	if (source.size < 8n) return undefined;
	const header = await source.readAt(0n, 8);
	if (!header.subarray(0, 4).equals(LNK2_SIGNATURE)) return undefined;
	const count = header.readInt32LE(4) * 2;
	if (!isSaneCount(count)) return undefined;
	if (BigInt(8 + count * 4) >= source.size) return undefined;
	return count;
}

export const lnk2Format: ArchiveFormat = createAilFormat({
	descriptor: lnk2Descriptor,
	detection: { signatures: [{ bytes: LNK2_SIGNATURE }] },
	async detect(source) {
		return (await parseLnk2(source)) !== undefined;
	},
	async read(source, sourcePath) {
		const count = await parseLnk2(source);
		if (count === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ail LNK2 header");
		}
		const entries = await readAilIndex(source, sourcePath, 8, count);
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
});
