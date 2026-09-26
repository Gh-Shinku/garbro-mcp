// Format reference: GARbro "ArcFormats/Entis/ArcERI.cs" (class `EriOpener`) and the metadata reader of
// "ArcFormats/Entis/ImageERI.cs" (classes `EriFormat`, `EriFile`, `EriFileHeader`, `EriMetaData`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { EriReader, addEriImageBuffer, type EriPicture } from "./eri-reader.js";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	writeBmp24,
	writeBmp32,
	writeBmp8,
	writeBmp8Palette,
} from "../shared/bmp.js";
import { readCompanionFile } from "../shared/companion.js";

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
	/** The places of the counts of a colour of the picture, of a count of no colour at all. */
	paletteAt: bigint;
	paletteSize: number;
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
	let paletteAt = 0n;
	let paletteSize = 0;
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
		if (PALETTE_SECTION === id) {
			// The counts of a colour of the picture stand of the counts of the walk of the engine of the
			// count of the walk of the picture itself: the places of the picture stand of the counts of a
			// colour of the count of the walk of the engine behind them.
			if (
				metadata.imageInfo.bpp <= 8 &&
				sectionSize > 0n &&
				sectionSize % 4n === 0n &&
				sectionSize <= BigInt(PALETTE_LIMIT)
			) {
				paletteAt = currentOffset;
				paletteSize = Number(sectionSize);
			}
		} else if (FRAME_SECTIONS.has(id)) {
			if (!checkPlacement(currentOffset, sectionSize, source.size))
				return undefined;
			entries.push({
				path: `${baseName}#${String(index).padStart(4, "0")}.bmp`,
				offset: currentOffset,
				size: sectionSize,
				frameIndex: entries.length,
				isDiff: id === "DiffeFrm",
			});
			index += 1;
		}
		currentOffset += sectionSize;
	}
	if (entries.length === 0) return undefined;
	return {
		entries,
		imageInfo: metadata.imageInfo,
		fileHeader: metadata.fileHeader,
		description: metadata.description,
		streamPos,
		paletteAt,
		paletteSize,
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
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		// `EriMultiImage.GetFrame`: the places of every count of the walk of the picture stand of the
		// counts of the walk of the engine of the count of the walk of the picture in front of it, of the
		// counts of the walk of the engine of the places of the picture of its own.
		const parsed = await readEriIndex(source, "");
		if (!parsed) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Entis ERI layout");
		}
		const palette =
			parsed.paletteSize > 0
				? new Uint8Array(
						await source.readAt(parsed.paletteAt, parsed.paletteSize),
					)
				: undefined;
		const index = Number(
			(entry.metadata as { frameIndex?: unknown }).frameIndex ?? 0,
		);
		let previous: EriPicture | undefined;
		for (let at = 0; at <= index; at += 1) {
			const frame = parsed.entries[at];
			if (!frame) {
				throw new GarbroError("ENTRY_NOT_FOUND", "No frame of the picture");
			}
			const isDiff = frame.isDiff;
			const picture = await decodeEriPicture({
				info: parsed.imageInfo,
				data: Buffer.from(
					await source.readAt(frame.offset, Number(source.size - frame.offset)),
				),
				palette,
				keyFrame:
					isDiff && at > 0 && previous !== undefined
						? previous.pixels
						: undefined,
				sourcePath,
				description: parsed.description,
			});
			previous = picture;
		}
		if (!previous) {
			throw new GarbroError("ENTRY_NOT_FOUND", "No frame of the picture");
		}
		return Readable.from([eriBitmap(previous)]);
	},
});

/** `EriFormat.ReadMetaData`: the head of a picture of the engine, of the places of the picture of it. */
async function readEriPicture(source: ByteSource): Promise<
	| {
			fileHeader: EriFileHeader | undefined;
			imageInfo: EriImageInfo | undefined;
			description: string | undefined;
			streamPos: bigint;
	  }
	| undefined
> {
	if (source.size < BigInt(HEADER_SIZE + SECTION_HEADER_SIZE)) return undefined;
	const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (!SUPPORTED_IDS.has(head.readUInt32LE(ID_OFFSET))) return undefined;
	const identifier = head.subarray(0x10);
	if (
		!IDENTIFIERS.some((value) =>
			identifier.subarray(0, value.length).equals(value),
		)
	)
		return undefined;
	const sectionHeader = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE), SECTION_HEADER_SIZE),
	);
	const header = readSectionHeader(sectionHeader, 0);
	if (!header || header.id !== HEADER_SECTION || header.length <= 0n) {
		return undefined;
	}
	const bodySize = Number(header.length);
	if (bodySize > 0x1000000) return undefined;
	if (
		BigInt(HEADER_SIZE + SECTION_HEADER_SIZE) + BigInt(bodySize) >
		source.size
	) {
		return undefined;
	}
	const block = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE + SECTION_HEADER_SIZE), bodySize),
	);
	const metadata = readEriMetadata(block);
	return { ...metadata, streamPos: BigInt(FIRST_SECTION_END + bodySize) };
}

/** The counts of a colour of the picture, of the count of the walk of the places of it. */
const PALETTE_SECTION = "Palette ";
const PALETTE_LIMIT = 0x400;

/**
 * `EriFormat.ReadImageData`: the places of the walk of the picture of the engine, of the sections of the
 * head of it behind the places of the walk of the engine (`Stream  `) and of the counts of a colour of the
 * picture (`Palette `) in front of them.
 */
async function readEriFrame(
	source: ByteSource,
	streamPos: bigint,
	bpp: number,
): Promise<{ data: Buffer; palette: Uint8Array | undefined } | undefined> {
	let offset = streamPos;
	let palette: Uint8Array | undefined;
	for (;;) {
		if (offset + BigInt(SECTION_HEADER_SIZE) > source.size) return undefined;
		const record = Buffer.from(
			await source.readAt(offset, SECTION_HEADER_SIZE),
		);
		const id = record.toString("latin1", 0, 8);
		const length = record.readBigInt64LE(8);
		offset += BigInt(SECTION_HEADER_SIZE);
		if (length < 0n || length > 0x7fffffffn) return undefined;
		const bodyAt = offset;
		if (id === STREAM_SECTION) continue;
		if (id === "ImageFrm") {
			if (bodyAt + length > source.size) return undefined;
			// The reference stands of the places of the picture of the count of the walk of the engine
			// behind the places of the count of the walk of it: the places of the picture stand of the
			// counts of the walk of the engine of the count of the walk of the picture itself.
			return {
				data: Buffer.from(
					await source.readAt(bodyAt, Number(source.size - bodyAt)),
				),
				palette,
			};
		}
		if (id === PALETTE_SECTION && bpp <= 8 && length <= BigInt(PALETTE_LIMIT)) {
			const colors = Number(length) / 4;
			if (colors <= 0 || colors > 0x100 || Number(length) % 4 !== 0) {
				return undefined;
			}
			palette = new Uint8Array(await source.readAt(bodyAt, Number(length)));
		}
		offset = bodyAt + length;
	}
}

/**
 * `EriFormat.ParseTagInfo`: the counts of the walk of the engine of the name of a picture of it. The name of
 * the picture of the engine stands of the places of the walk of the engine of the count of the walk of the
 * engine of its own.
 */
export function parseEriTags(
	description: string | undefined,
): Map<string, string> {
	const tags = new Map<string, string>();
	if (!description) return tags;
	if (!description.startsWith("#")) {
		tags.set("comment", description);
		return tags;
	}
	const lines = description.split(/\r?\n/);
	let at = 0;
	while (at < lines.length) {
		const match = /^\s*#\s*(\S+)/.exec(lines[at] ?? "");
		if (!match) break;
		const tag = match[1] ?? "";
		at += 1;
		let value = "";
		for (;;) {
			if (at >= lines.length) break;
			let line = lines[at] ?? "";
			if (line.startsWith("#")) {
				if (line.length < 2 || "#" !== line[1]) break;
				line = line.slice(1);
			}
			value += `${line}\n`;
			at += 1;
		}
		tags.set(tag, value);
	}
	return tags;
}

/** The name of the picture of the engine the places of the picture in front of it stand of. */
const REFERENCE_TAG = "reference-file";

/** The places of the walk of a picture of the engine, of the counts of the walk of the picture of it. */
async function readEriPictureParts(
	source: ByteSource,
	sourcePath: string,
): Promise<
	| {
			info: EriImageInfo;
			description: string | undefined;
			data: Buffer;
			palette: Uint8Array | undefined;
			sourcePath: string;
	  }
	| undefined
> {
	const picture = await readEriPicture(source);
	if (!picture?.imageInfo) return undefined;
	const frame = await readEriFrame(
		source,
		picture.streamPos,
		picture.imageInfo.bpp,
	);
	if (!frame) return undefined;
	return {
		info: picture.imageInfo,
		description: picture.description,
		data: frame.data,
		palette: frame.palette,
		sourcePath,
	};
}

/**
 * `EriFormat.ReadImageData`: the places of a picture of the engine, of the counts of the walk of the
 * picture of the engine in front of it (`reference-file`) as well: the counts of the walk of the engine of
 * the picture in front of it stand of the counts of the walk of the engine of the places of the count of the
 * walk of the picture of its own, of the counts of the walk of the engine of every count of a colour of the
 * picture itself.
 */
async function decodeEriPicture(input: {
	info: EriImageInfo;
	data: Buffer;
	palette: Uint8Array | undefined;
	keyFrame: Uint8Array | undefined;
	sourcePath: string;
	description: string | undefined;
}): Promise<EriPicture> {
	const reader = new EriReader({
		info: {
			version: input.info.version,
			transformation: input.info.transformation,
			architecture: input.info.architecture,
			formatType: input.info.formatType,
			width: input.info.width,
			height: input.info.height,
			verticalFlip: input.info.verticalFlip,
			bpp: input.info.bpp,
			blockingDegree: input.info.blockingDegree,
		},
		data: input.data,
		...(input.palette !== undefined ? { palette: input.palette } : {}),
		...(input.keyFrame !== undefined ? { keyFrame: input.keyFrame } : {}),
	});
	const picture = reader.decodeImage();
	const tags = parseEriTags(input.description);
	const reference = (tags.get(REFERENCE_TAG) ?? "").replace(/\0/g, "").trim();
	if (reference.length === 0) return picture;
	if ((input.info.bpp + 7) >> 3 < 3) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid Entis picture of the picture in front of it",
		);
	}
	const bytes = await readCompanionFile(input.sourcePath, reference);
	if (!bytes) {
		throw new GarbroError("ENTRY_NOT_FOUND", "Referenced image not found");
	}
	const parts = await readEriPictureParts(
		new BufferByteSource(bytes),
		resolve(dirname(input.sourcePath), reference),
	);
	if (!parts) {
		throw new GarbroError("ENTRY_NOT_FOUND", "Referenced image not found");
	}
	const referenced = await decodeEriPicture({
		info: parts.info,
		data: parts.data,
		palette: parts.palette,
		keyFrame: undefined,
		sourcePath: parts.sourcePath,
		description: parts.description,
	});
	const sourcePlaces = (parts.info.bpp + 7) >> 3 === 4 ? 4 : 3;
	const destinationPlaces = (input.info.bpp + 7) >> 3 === 4 ? 4 : 3;
	addEriImageBuffer({
		destination: picture.pixels,
		destinationStride: picture.stride,
		destinationPlaces,
		source: referenced.pixels,
		sourceStride: referenced.stride,
		sourcePlaces,
		width: picture.width,
		height: picture.height,
		alpha: 4 === sourcePlaces && 4 === destinationPlaces,
	});
	return picture;
}

/** The places of a picture of the engine stand of a bitmap of the project. */
function eriBitmap(decoded: EriPicture): Buffer {
	// The places of the picture stand of the places of a line of the counts of the walk of the engine
	// itself: the bitmap stands of the places of the count of the walk of the engine of every line of it,
	// of no place of the walk of the count of the walk of the engine at all.
	const packed = packEriRows(
		decoded.pixels,
		decoded.stride,
		((decoded.width * decoded.bpp + 31) >> 5) * 4,
		decoded.height,
	);
	const buffer = Buffer.from(packed);
	const bottomUp = decoded.bottomUp;
	if (decoded.bpp <= 8) {
		return decoded.palette !== undefined
			? writeBmp8Palette(
					decoded.width,
					decoded.height,
					buffer,
					Buffer.from(decoded.palette),
					bottomUp,
				)
			: writeBmp8(decoded.width, decoded.height, buffer, bottomUp);
	}
	if (24 === decoded.bpp) {
		return writeBmp24(decoded.width, decoded.height, buffer, bottomUp);
	}
	return writeBmp32(decoded.width, decoded.height, buffer, bottomUp);
}

export const entisEriImageDescriptor: FormatDescriptor = {
	id: "entis-eri-image",
	name: "Entis rasterized image",
	extensions: ["eri", "emi"],
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
			source: "ArcFormats/Entis/ImageERI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * The Entis rasterized picture, of the walk of the head of it alone: the places of the picture stand of the
 * walks of the engine (`ArcFormats/Entis/EriReader.cs`), which stand unported here. A picture of the engine
 * stands of the same head as the archives of it (`entis-eri`), of the places of a picture of the kind
 * `ImageFrm` behind them.
 */
export const entisEriImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: entisEriImageDescriptor,
	detection: {
		signatures: [
			{ bytes: SIGNATURE },
			{ bytes: Buffer.from("VIST", "latin1") },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		try {
			const picture = await readEriPicture(source);
			return picture?.imageInfo !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const picture = await readEriPicture(source);
		if (!picture?.imageInfo) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Entis picture layout");
		}
		const info = picture.imageInfo;
		const extension = sourceExtension(sourcePath);
		const name =
			extension.length > 0
				? basename(sourcePath, `.${extension}`)
				: basename(sourcePath);
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: `${name.length > 0 ? name : "image"}.bmp`,
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: info.width,
					height: info.height,
					bitsPerPixel: info.bpp,
					transformation: info.transformation,
					architecture: info.architecture,
					formatType: info.formatType,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: info.width,
				height: info.height,
				bitsPerPixel: info.bpp,
				transformation: info.transformation,
				architecture: info.architecture,
				formatType: info.formatType,
				version: info.version,
				frameCount: picture.fileHeader?.frameCount ?? 0,
				...(picture.description !== undefined
					? { description: picture.description }
					: {}),
			},
		};
	},
	async openEntry(source: ByteSource, _entry: FixedEntry, sourcePath: string) {
		const parts = await readEriPictureParts(source, sourcePath);
		if (!parts) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Entis picture layout");
		}
		const picture = await decodeEriPicture({
			info: parts.info,
			data: parts.data,
			palette: parts.palette,
			keyFrame: undefined,
			sourcePath: parts.sourcePath,
			description: parts.description,
		});
		return Readable.from([eriBitmap(picture)]);
	},
});

/** The places of a picture of the engine of the count of the places of a line of it. */
function packEriRows(
	pixels: Uint8Array,
	stride: number,
	rowBytes: number,
	height: number,
): Uint8Array {
	const packed = new Uint8Array(rowBytes * height);
	for (let y = 0; y < height; y += 1) {
		const from = y * stride;
		packed.set(pixels.subarray(from, from + rowBytes), y * rowBytes);
	}
	return packed;
}
