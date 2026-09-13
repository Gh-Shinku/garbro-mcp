// Format reference: GARbro "ArcFormats/Entis/ArcERI.cs" (class `EriOpener`) and the metadata reader of
// "ArcFormats/Entis/ImageERI.cs" (classes `EriFormat`, `EriFile`, `EriFileHeader`, `EriMetaData`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("Enti", "ascii");
/** The identifier word sits after the signature and must read as one of the supported versions. */
const ID_OFFSET = 8;
const SUPPORTED_IDS = new Set([0x03000100, 0x02000100]);
/** The description strings accepted at 0x10, compared byte by byte like the reference. */
const IDENTIFIERS = [
	"Entis Rasterized Image",
	"Moving Entis Image",
	"EMSAC-Image",
].map((value) => Buffer.from(value, "ascii"));
const HEADER_SIZE = 0x40;
/** Every section is an eight byte identifier and a little endian 64 bit length. */
const SECTION_HEADER_SIZE = 0x10;
/** End of the first section header, which is where the stream position of the frames is derived from. */
const FIRST_SECTION_END = 0x50;
const HEADER_SECTION = "Header  ";
const FILE_HEADER_SECTION = "FileHdr ";
const IMAGE_INFO_SECTION = "ImageInf";
const DESCRIPTION_SECTION = "descript";
const STREAM_SECTION = "Stream  ";
const FRAME_SECTIONS = new Set(["ImageFrm", "DiffeFrm"]);
const MIN_ERI_VERSION = 0x00020100;
const IMAGE_INFO_VERSIONS = new Set([0x00020100, 0x00020200]);
const BOM = 0xfeff;

interface EriFileHeader {
	version: number;
	containedFlag: number;
	keyFrameCount: number;
	frameCount: number;
	allFrameTime: number;
}

interface EriImageInfo {
	version: number;
	transformation: number;
	architecture: number;
	formatType: number;
	width: number;
	height: number;
	verticalFlip: boolean;
	bpp: number;
	clippedPixel: number;
	samplingFlags: number;
	quantumizedBits: bigint;
	allottedBits: bigint;
	blockingDegree: number;
	lappedBlock: number;
	frameTransform: number;
	frameDegree: number;
}

/** A sequential little endian reader over the metadata block. */
class EriCursor {
	readonly #data: Buffer;
	#position = 0;

	constructor(data: Buffer) {
		this.#data = data;
	}

	get position(): number {
		return this.#position;
	}

	get remaining(): number {
		return this.#data.length - this.#position;
	}

	readBytes(length: number): Buffer | undefined {
		if (length < 0 || this.#position + length > this.#data.length)
			return undefined;
		const value = this.#data.subarray(this.#position, this.#position + length);
		this.#position += length;
		return value;
	}

	skip(length: number): boolean {
		if (length < 0 || this.#position + length > this.#data.length) return false;
		this.#position += length;
		return true;
	}

	readInt32(): number | undefined {
		const value = this.readBytes(4);
		return value?.readInt32LE(0);
	}

	readInt64(): bigint | undefined {
		const value = this.readBytes(8);
		return value?.readBigInt64LE(0);
	}

	readUInt16(): number | undefined {
		const value = this.readBytes(2);
		return value?.readUInt16LE(0);
	}

	readUInt64(): bigint | undefined {
		const value = this.readBytes(8);
		return value?.readBigUInt64LE(0);
	}
}

interface EriSectionHeader {
	id: string;
	length: bigint;
}

function readSectionHeader(
	data: Buffer,
	offset: number,
): EriSectionHeader | undefined {
	if (offset + SECTION_HEADER_SIZE > data.length) return undefined;
	const id = data.toString("latin1", offset, offset + 8);
	const length = data.readBigInt64LE(offset + 8);
	return { id, length };
}

/** GARbro `EriFormat.ReadMetaData`: the header sections that are needed to find the frame data. */
function readEriMetadata(block: Buffer): {
	fileHeader: EriFileHeader | undefined;
	imageInfo: EriImageInfo | undefined;
	description: string | undefined;
} {
	const cursor = new EriCursor(block);
	let headerSize = block.length;
	let fileHeader: EriFileHeader | undefined;
	let imageInfo: EriImageInfo | undefined;
	let description: string | undefined;
	while (headerSize > SECTION_HEADER_SIZE) {
		const header = readSectionHeader(block, cursor.position);
		if (!header) break;
		if (!cursor.skip(SECTION_HEADER_SIZE)) break;
		headerSize -= SECTION_HEADER_SIZE;
		if (header.length <= 0n || header.length > BigInt(headerSize)) break;
		if (header.id === FILE_HEADER_SECTION) {
			const version = cursor.readInt32();
			const containedFlag = cursor.readInt32();
			const keyFrameCount = cursor.readInt32();
			const frameCount = cursor.readInt32();
			const allFrameTime = cursor.readInt32();
			if (
				version === undefined ||
				containedFlag === undefined ||
				keyFrameCount === undefined ||
				frameCount === undefined ||
				allFrameTime === undefined
			)
				break;
			// The reference rejects anything newer than the version it knows.
			if (version > MIN_ERI_VERSION)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid ERI file version");
			fileHeader = {
				version,
				containedFlag,
				keyFrameCount,
				frameCount,
				allFrameTime,
			};
		} else if (header.id === IMAGE_INFO_SECTION) {
			const version = cursor.readInt32();
			if (version === undefined) break;
			if (!IMAGE_INFO_VERSIONS.has(version))
				return { fileHeader, imageInfo, description };
			const transformation = cursor.readInt32();
			const architecture = cursor.readInt32();
			const formatType = cursor.readInt32();
			const width = cursor.readInt32();
			const height = cursor.readInt32();
			const bpp = cursor.readInt32();
			const clippedPixel = cursor.readInt32();
			const samplingFlags = cursor.readInt32();
			const quantumizedBits = cursor.readUInt64();
			const allottedBits = cursor.readUInt64();
			const blockingDegree = cursor.readInt32();
			const lappedBlock = cursor.readInt32();
			const frameTransform = cursor.readInt32();
			const frameDegree = cursor.readInt32();
			const values = [
				transformation,
				architecture,
				formatType,
				width,
				height,
				bpp,
				clippedPixel,
				samplingFlags,
				blockingDegree,
				lappedBlock,
				frameTransform,
				frameDegree,
			];
			if (values.some((value) => value === undefined)) break;
			if (quantumizedBits === undefined || allottedBits === undefined) break;
			imageInfo = {
				version,
				transformation: transformation ?? 0,
				architecture: architecture ?? 0,
				formatType: formatType ?? 0,
				width: Math.abs(width ?? 0),
				height: Math.abs(height ?? 0),
				verticalFlip: (height ?? 0) < 0,
				bpp: bpp ?? 0,
				clippedPixel: clippedPixel ?? 0,
				samplingFlags: samplingFlags ?? 0,
				quantumizedBits,
				allottedBits,
				blockingDegree: blockingDegree ?? 0,
				lappedBlock: lappedBlock ?? 0,
				frameTransform: frameTransform ?? 0,
				frameDegree: frameDegree ?? 0,
			};
		} else if (header.id === DESCRIPTION_SECTION) {
			const length = Number(header.length);
			const bom = cursor.readUInt16();
			if (bom === undefined) break;
			if (bom === BOM) {
				const text = cursor.readBytes(Math.floor(length / 2) - 1);
				if (!text) break;
				description = text.toString("utf16le");
			} else {
				// The two bytes that were read as the mark are part of the text itself.
				const rest = cursor.readBytes(length - 2);
				if (!rest) break;
				description = Buffer.concat([
					Buffer.from([bom & 0xff, (bom >> 8) & 0xff]),
					rest,
				]).toString("utf8");
			}
		} else if (!cursor.skip(Number(header.length))) {
			break;
		}
		headerSize -= Number(header.length);
	}
	return { fileHeader, imageInfo, description };
}

interface EriParsedEntry {
	path: string;
	offset: bigint;
	size: bigint;
	frameIndex: number;
	isDiff: boolean;
}

interface EriParsedArchive {
	entries: EriParsedEntry[];
	imageInfo: EriImageInfo;
	fileHeader: EriFileHeader;
	description: string | undefined;
	streamPos: bigint;
}

/** GARbro `EriOpener.TryOpen`: header sections followed by a chain of frame sections. */
async function readEriIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<EriParsedArchive | undefined> {
	if (source.size < BigInt(HEADER_SIZE + SECTION_HEADER_SIZE)) return undefined;
	const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (!SUPPORTED_IDS.has(head.readUInt32LE(ID_OFFSET))) return undefined;
	const identifier = head.subarray(0x10);
	if (
		!IDENTIFIERS.some((value) =>
			identifier.subarray(0, value.length).equals(value),
		)
	)
		return undefined;
	return readEriBody(source, sourcePath);
}

/** Reads the metadata block and the frame chain of an ERI file. */
async function readEriBody(
	source: ByteSource,
	sourcePath: string,
): Promise<EriParsedArchive | undefined> {
	const sectionHeader = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE), SECTION_HEADER_SIZE),
	);
	const header = readSectionHeader(sectionHeader, 0);
	if (!header || header.id !== HEADER_SECTION || header.length <= 0n)
		return undefined;
	const bodySize = Number(header.length);
	if (bodySize > 0x1000000) return undefined;
	if (
		BigInt(HEADER_SIZE + SECTION_HEADER_SIZE) + BigInt(bodySize) >
		source.size
	)
		return undefined;
	const block = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE + SECTION_HEADER_SIZE), bodySize),
	);
	const metadata = readEriMetadata(block);
	if (!metadata.imageInfo || !metadata.fileHeader) return undefined;
	if (!isSaneCount(metadata.fileHeader.frameCount)) return undefined;
	const extension = sourceExtension(sourcePath);
	const baseName =
		extension.length > 0
			? basename(sourcePath, `.${extension}`)
			: basename(sourcePath);
	const streamPos = BigInt(FIRST_SECTION_END + bodySize);
	const entries: EriParsedEntry[] = [];
	let currentOffset = streamPos;
	let index = 0;
	while (
		index < metadata.fileHeader.frameCount &&
		currentOffset < source.size
	) {
		if (currentOffset + BigInt(SECTION_HEADER_SIZE) > source.size) break;
		const record = Buffer.from(
			await source.readAt(currentOffset, SECTION_HEADER_SIZE),
		);
		const id = record.toString("latin1", 0, 8);
		if (id === STREAM_SECTION) {
			currentOffset += BigInt(SECTION_HEADER_SIZE);
			continue;
		}
		const sectionSize = record.readBigInt64LE(8);
		if (sectionSize < 0n || sectionSize > 0x7fffffffn)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ERI section size");
		currentOffset += BigInt(SECTION_HEADER_SIZE);
		if (sectionSize === 0n) continue;
		if (FRAME_SECTIONS.has(id)) {
			if (!checkPlacement(currentOffset, sectionSize, source.size))
				return undefined;
			entries.push({
				path: `${baseName}#${String(index).padStart(4, "0")}`,
				offset: currentOffset,
				size: sectionSize,
				frameIndex: entries.length,
				isDiff: id === "DiffeFrm",
			});
			index += 1;
		}
		// Palette sections are skipped here; only the image decoder consumes them.
		currentOffset += sectionSize;
	}
	if (entries.length === 0) return undefined;
	return {
		entries,
		imageInfo: metadata.imageInfo,
		fileHeader: metadata.fileHeader,
		description: metadata.description,
		streamPos,
	};
}

export const entisEriDescriptor: FormatDescriptor = {
	id: "entis-eri",
	name: "Entis multi-frame image format",
	extensions: ["eri"],
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
			source: "ArcFormats/Entis/ArcERI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const entisEriFormat: ArchiveFormat = defineFixedArchive({
	descriptor: entisEriDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEriIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const parsed = await readEriIndex(source, sourcePath);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Entis ERI layout");
		const entries: FixedEntry[] = parsed.entries.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				metadata: {
					type: "image",
					frameIndex: entry.frameIndex,
					isDiff: entry.isDiff,
				} as Record<string, unknown>,
			}),
		);
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				frameCount: parsed.fileHeader.frameCount,
				streamPos: parsed.streamPos.toString(),
				width: parsed.imageInfo.width,
				height: parsed.imageInfo.height,
				bpp: parsed.imageInfo.bpp,
				...(parsed.description !== undefined
					? { description: parsed.description }
					: {}),
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		// Frames are stored verbatim; the Entis image decoder is out of scope.
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
