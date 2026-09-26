// The incremental picture of the AliceSoft System engine ("ArcFormats/AliceSoft/ImageDCF.cs", classes
// `DcfFormat`, `DcfMetaData` and `DcfReader`) over the picture of the same engine ("ArchiveFormats/
// AliceSoft/ImageQNT.cs"). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// A picture of the engine stands of a head that names the picture of the count of the walk of the engine in
// front of it, and then a chain of chunks: the counts of a count of no name at all (a run of the places of
// the walk of the engine behind a stream of the places of the file of its own), the places of the count of
// the walk of the engine of the places of the count of the picture itself, and the places of the picture of
// the count of the walk of the engine of its own.

import { GarbroError, decodeCp932 } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
} from "../shared/fixed-archive.js";
import { readQntLayout, unpackQnt } from "./qnt-image.js";

const SIGNATURE_DCF = Buffer.from("dcf ", "latin1");
const SIGNATURE_PCF = Buffer.from("pcf ", "latin1");
const QNT_SIGNATURE = Buffer.from("QNT", "latin1");
const HEAD_SIZE = 0x1c;
const HEADER_SIZE_FIELD = 4;
const VERSION_FIELD = 8;
const WIDTH_FIELD = 0x0c;
const HEIGHT_FIELD = 0x10;
const BITS_FIELD = 0x14;
const NAME_LENGTH_FIELD = 0x18;
const CHUNK_HEAD = 8;
const DFDL = 0x6c646664;
const PDTL = 0x6c647470;
const DCGD = 0x64676364;
const PCGD = 0x64676370;
const BLOCK = 0x10;
const MASK_HEAD = 4;
const PLACES_LIMIT = 0x10000000;
const DEPTH_LIMIT = 4;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedPicture(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** `Binary.RotByteL`: the places of a count of the walk of the engine behind the places of its own. */
function rotatePlace(place: number, count: number): number {
	const shift = count & 7;
	return ((place << shift) | (place >>> (8 - shift))) & 0xff;
}

export interface DcfLayout {
	signature: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The name of the picture of the count of the walk of the engine in front of this one. */
	baseName: string;
	/** The places of the count of the walk of the engine behind the head of the picture. */
	dataOffset: number;
	isPcf: boolean;
}

/** `DcfFormat.ReadMetaData`: the head of the picture, of the name of the picture in front of it. */
export function readDcfLayout(data: Buffer, at = 0): DcfLayout | undefined {
	if (at + HEAD_SIZE > data.length) return undefined;
	const signature = data.readUInt32LE(at);
	const isPcf = signature === 0x20666370;
	const isDcf = signature === 0x20666364;
	if (!isDcf && !isPcf) return undefined;
	const headerSize = data.readUInt32LE(at + HEADER_SIZE_FIELD);
	if (1 !== data.readInt32LE(at + VERSION_FIELD)) return undefined;
	const width = data.readUInt32LE(at + WIDTH_FIELD);
	const height = data.readUInt32LE(at + HEIGHT_FIELD);
	const bitsPerPixel = data.readInt32LE(at + BITS_FIELD);
	const nameLength = data.readInt32LE(at + NAME_LENGTH_FIELD);
	if (nameLength <= 0 || width === 0 || height === 0) return undefined;
	if (width * height > PLACES_LIMIT) return undefined;
	const nameAt = at + HEAD_SIZE;
	if (nameAt + nameLength > data.length) return undefined;
	const shift = (nameLength % 7) + 1;
	const rotated = Buffer.alloc(nameLength);
	for (let place = 0; place < nameLength; place += 1) {
		rotated[place] = rotatePlace(data[nameAt + place] ?? 0, shift);
	}
	const dataOffset = at + 8 + headerSize;
	if (dataOffset >= data.length) return undefined;
	return {
		signature,
		width,
		height,
		bitsPerPixel,
		baseName: decodeCp932(rotated),
		dataOffset,
		isPcf,
	};
}

interface DcfChunks {
	mask: Buffer | undefined;
	ptX: number;
	ptY: number;
	overlayAt: number;
}

/** `DcfReader.Unpack`: the counts of the walk of the engine of the head of the picture. */
async function readDcfChunks(
	data: Buffer,
	layout: DcfLayout,
): Promise<DcfChunks> {
	let ptX = 0;
	let ptY = 0;
	let mask: Buffer | undefined;
	let at = layout.dataOffset;
	for (let count = 0; count < PLACES_LIMIT; count += 1) {
		if (at + CHUNK_HEAD > data.length) {
			throw invalidPicture(
				"The count of the walk of the picture stands short of its places",
			);
		}
		const id = data.readUInt32LE(at);
		const size = data.readUInt32LE(at + 4);
		const next = at + CHUNK_HEAD + size;
		if (DFDL === id) {
			const unpackedSize = data.readInt32LE(at + CHUNK_HEAD);
			if (unpackedSize > 0) {
				if (unpackedSize > PLACES_LIMIT) {
					throw invalidPicture(
						"The count of the walk of the picture stands past its places",
					);
				}
				mask = await inflateZlibBuffer(
					data.subarray(at + CHUNK_HEAD + 4, Math.min(next, data.length)),
				);
				if (mask.length < unpackedSize) {
					throw invalidPicture(
						"The count of the walk of the picture stands short of its places",
					);
				}
			}
		} else if (PDTL === id) {
			ptX = data.readInt32LE(at + CHUNK_HEAD);
			ptY = data.readInt32LE(at + CHUNK_HEAD + 4);
		} else if (DCGD === id || PCGD === id) {
			return { mask, ptX, ptY, overlayAt: at + CHUNK_HEAD };
		}
		if (next <= at) {
			throw invalidPicture(
				"The count of the walk of the picture stands past its places",
			);
		}
		at = next;
	}
	throw invalidPicture(
		"The count of the walk of the picture stands past its places",
	);
}

interface DcfOverlay {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	pixels: Buffer;
}

/** `QntFormat.Reader`: the places of the picture of the count of the walk of the engine of its own. */
async function readDcfOverlay(data: Buffer, at: number): Promise<DcfOverlay> {
	if (!data.subarray(at, at + QNT_SIGNATURE.length).equals(QNT_SIGNATURE)) {
		throw invalidPicture(
			"The places of the picture stand of no count of the walk of the engine",
		);
	}
	const layout = readQntLayout(data.subarray(at), data.length - at);
	if (!layout) {
		throw invalidPicture(
			"The places of the picture stand of no count of the walk of the engine",
		);
	}
	const colours = layout.alignedHeight * layout.alignedWidth * 3;
	const first = await inflateZlibBuffer(
		data.subarray(
			at + layout.headerSize,
			at + layout.headerSize + layout.rgbSize,
		),
	);
	if (first.length < colours) {
		throw invalidPicture("The places of the picture stand short of its places");
	}
	let second: Buffer | undefined;
	if (layout.alphaSize !== 0) {
		second = await inflateZlibBuffer(
			data.subarray(
				at + layout.headerSize + layout.rgbSize,
				at + layout.headerSize + layout.rgbSize + layout.alphaSize,
			),
		);
	}
	return {
		width: layout.width,
		height: layout.height,
		offsetX: layout.offsetX,
		offsetY: layout.offsetY,
		bitsPerPixel: layout.alphaSize !== 0 ? 32 : 24,
		pixels: unpackQnt(first, second, layout),
	};
}

export interface DcfPicture {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
}

/** `DcfReader.MaskOverlay`: the places of the picture of the count of the walk of the engine of its own. */
export function maskOverlay(
	overlay: Buffer,
	base: Buffer,
	width: number,
	height: number,
	mask: Buffer,
	baseBitsPerPixel: number,
	overlayBitsPerPixel: number,
): void {
	const blocksX = Math.trunc(width / BLOCK);
	const blocksY = Math.trunc(height / BLOCK);
	const baseStep = baseBitsPerPixel >> 3;
	const overlayStep = overlayBitsPerPixel >> 3;
	const baseStride = width * baseStep;
	const overlayStride = width * overlayStep;
	let maskAt = MASK_HEAD;
	for (let y = 0; y < blocksY; y += 1) {
		const baseAt = y * BLOCK * baseStride;
		const dstAt = y * BLOCK * overlayStride;
		for (let x = 0; x < blocksX; x += 1) {
			if (0 === (mask[maskAt] ?? 0)) {
				maskAt += 1;
				continue;
			}
			maskAt += 1;
			for (let by = 0; by < BLOCK; by += 1) {
				let src = baseAt + by * baseStride + x * BLOCK * baseStep;
				let dst = dstAt + by * overlayStride + x * BLOCK * overlayStep;
				for (let bx = 0; bx < BLOCK; bx += 1) {
					overlay[dst] = base[src] ?? 0;
					overlay[dst + 1] = base[src + 1] ?? 0;
					overlay[dst + 2] = base[src + 2] ?? 0;
					if (4 === overlayStep) {
						overlay[dst + 3] = 4 === baseStep ? (base[src + 3] ?? 0) : 0xff;
					}
					src += baseStep;
					dst += overlayStep;
				}
			}
		}
	}
}

/** `DcfReader.BlendOverlay`: the places of the picture of the count of the walk of the engine of its own. */
export function blendOverlay(
	base: Buffer,
	overlay: DcfOverlay,
	width: number,
	height: number,
): void {
	let overlayWidth = overlay.width;
	let overlayHeight = overlay.height;
	if (overlay.offsetX + overlayWidth > width) {
		overlayWidth = width - overlay.offsetX;
	}
	if (overlay.offsetY + overlayHeight > height) {
		overlayHeight = height - overlay.offsetY;
	}
	if (overlayHeight <= 0 || overlayWidth <= 0) return;
	const dstStride = width * 4;
	const srcStride = overlay.width * 4;
	let dst = overlay.offsetY * dstStride + overlay.offsetX * 4;
	let src = 0;
	const gap = dstStride - srcStride;
	for (let y = 0; y < overlayHeight; y += 1) {
		for (let x = 0; x < overlayWidth; x += 1) {
			const alpha = overlay.pixels[src + 3] ?? 0;
			if (0 !== alpha) {
				if (0xff === alpha || 0 === (base[dst + 3] ?? 0)) {
					base[dst] = overlay.pixels[src] ?? 0;
					base[dst + 1] = overlay.pixels[src + 1] ?? 0;
					base[dst + 2] = overlay.pixels[src + 2] ?? 0;
					base[dst + 3] = alpha;
				} else {
					for (let place = 0; place < 3; place += 1) {
						base[dst + place] = Math.trunc(
							((overlay.pixels[src + place] ?? 0) * alpha +
								(base[dst + place] ?? 0) * (0xff - alpha)) /
								0xff,
						);
					}
					base[dst + 3] = Math.max(alpha, base[dst + 3] ?? 0);
				}
			}
			dst += 4;
			src += 4;
		}
		dst += gap;
	}
}

/**
 * `DcfReader.ReadBaseImage`: the places of the picture of the count of the walk of the engine in front of
 * this one, of the name of the picture of the count of the walk of the engine of the two ways of it.
 */
async function readDcfBase(
	sourcePath: string,
	layout: DcfLayout,
	depth: number,
): Promise<DcfPicture | undefined> {
	if (depth > DEPTH_LIMIT) return undefined;
	const qntName = changeExtension(
		layout.baseName.replace(/^.*[/\\]/, ""),
		"qnt",
	);
	let stored = await readCompanionFile(sourcePath, qntName);
	if (stored) {
		const picture = await readQntPicture(stored);
		if (picture) return picture;
	}
	const pcfName = changeExtension(
		layout.baseName.replace(/^.*[/\\]/, ""),
		"pcf",
	);
	const ownName = sourcePath.replace(/^.*[/\\]/, "");
	if (pcfName.toLowerCase() === ownName.toLowerCase()) return undefined;
	stored = await readCompanionFile(sourcePath, pcfName);
	if (!stored) return undefined;
	const inner = readDcfLayout(stored);
	if (!inner) return undefined;
	const pieces = await readDcfPieces(
		stored,
		inner,
		sourcePath.replace(/[^/\\]*$/, pcfName),
		depth + 1,
	);
	return pieces;
}

/** The places of a picture of the counts of the walk of the picture of the engine of its own. */
async function readQntPicture(stored: Buffer): Promise<DcfPicture | undefined> {
	const layout = readQntLayout(stored, stored.length);
	if (!layout) return undefined;
	const pixels = await readDcfOverlay(stored, 0);
	void layout;
	return {
		width: pixels.width,
		height: pixels.height,
		bitsPerPixel: pixels.bitsPerPixel,
		pixels: pixels.pixels,
	};
}

/** `DcfReader.Unpack`: the places of the picture of the engine, of the counts of the walk of it. */
async function readDcfPieces(
	stored: Buffer,
	layout: DcfLayout,
	sourcePath: string,
	depth: number,
): Promise<DcfPicture | undefined> {
	const chunks = await readDcfChunks(stored, layout);
	const overlay = await readDcfOverlay(stored, chunks.overlayAt);
	let base: DcfPicture | undefined;
	if (chunks.mask !== undefined || layout.isPcf) {
		base = await readDcfBase(sourcePath, layout, depth);
		if (layout.isPcf && !base) {
			base = {
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
				pixels: Buffer.alloc(layout.width * layout.height * 4),
			};
		}
	}
	if (layout.isPcf) {
		if (!base) {
			throw unsupportedPicture(
				"The places of the picture stand of the counts of the walk of the engine of the places of the picture in front of it",
			);
		}
		overlay.offsetX = chunks.ptX;
		overlay.offsetY = chunks.ptY;
		blendOverlay(base.pixels, overlay, layout.width, layout.height);
		return {
			width: layout.width,
			height: layout.height,
			bitsPerPixel: base.bitsPerPixel,
			pixels: base.pixels,
		};
	}
	if (base) {
		if (chunks.mask === undefined) {
			throw invalidPicture(
				"The places of the picture stand of no count of the walk of the engine",
			);
		}
		maskOverlay(
			overlay.pixels,
			base.pixels,
			layout.width,
			layout.height,
			chunks.mask,
			base.bitsPerPixel,
			overlay.bitsPerPixel,
		);
		return {
			width: layout.width,
			height: layout.height,
			bitsPerPixel: overlay.bitsPerPixel,
			pixels: overlay.pixels,
		};
	}
	return {
		width: overlay.width,
		height: overlay.height,
		bitsPerPixel: overlay.bitsPerPixel,
		pixels: overlay.pixels,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The places of the picture of the engine stand of a bitmap of the project. */
function dcfBitmap(picture: DcfPicture): Buffer {
	return 24 === picture.bitsPerPixel
		? writeBmp24(picture.width, picture.height, picture.pixels, false)
		: writeBmp32(picture.width, picture.height, picture.pixels, false);
}

export const alicesoftDcfImageDescriptor: FormatDescriptor = {
	id: "alicesoft-dcf-image",
	name: "AliceSoft System incremental picture",
	extensions: ["dcf", "pcf"],
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
			source: "ArcFormats/AliceSoft/ImageDCF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const alicesoftDcfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: alicesoftDcfImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE_DCF }, { bytes: SIGNATURE_PCF }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const stored = await readStored(source);
			return readDcfLayout(stored) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readDcfLayout(stored);
		if (!layout) throw invalidPicture("Not an AliceSoft incremental picture");
		const extension = sourceExtension(sourcePath);
		const name =
			extension.length > 0
				? sourcePath.replace(/^.*[/\\]/, "").slice(0, -(extension.length + 1))
				: sourcePath.replace(/^.*[/\\]/, "");
		const entry = createFixedEntry({
			id: 0,
			path: `${name.length > 0 ? name : "image"}.bmp`,
			offset: 0n,
			size: source.size,
			compressed: true,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				baseName: layout.baseName,
				isPcf: layout.isPcf,
			} as Record<string, unknown>,
		});
		return {
			entries: [{ ...entry, sizeKnown: false }],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				baseName: layout.baseName,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readDcfLayout(stored);
		if (!layout) throw invalidPicture("Not an AliceSoft incremental picture");
		const picture = await readDcfPieces(stored, layout, sourcePath, 0);
		if (!picture) {
			throw unsupportedPicture(
				"The places of the picture stand of the counts of the walk of the engine of the places of the picture in front of it",
			);
		}
		return Readable.from([dcfBitmap(picture)]);
	},
});
