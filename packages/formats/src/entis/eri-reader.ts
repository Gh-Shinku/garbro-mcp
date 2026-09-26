// The walk of the places of a picture of the engine, of the counts of the engine itself
// ("ArcFormats/Entis/EriReader.cs", the class `EriReader` and the counts of a picture of the engine).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The walk stands of the places of the picture of the kind of the counts of a picture of the engine
// (`Lossless_ERI`) alone: the kinds of the counts of the picture of the engine of the two ways of it
// (`DCT_ERI`, `LOT_ERI`) and the places of the walk of the engine of the count of a picture of the engine
// (`ArithmeticCode`) stand unported here.

import { GarbroError } from "@garbro-mcp/core";
import {
	ErisaHuffmanDecodeContext,
	ErisaHuffmanTree,
	ErisaProbDecodeContext,
	ErisaProbModel,
	ErisaRleDecodeContext,
} from "@garbro-mcp/codecs";

/** The kinds of the walk of the places of a picture of the engine (`CvType`). */
export const TRANSFORMATION_LOSSLESS_ERI = 0x03020000;
export const TRANSFORMATION_LOSSLESS_EMI = 0x03010000;
export const TRANSFORMATION_DCT_ERI = 0x00000001;
export const TRANSFORMATION_LOT_ERI = 0x00000005;
export const TRANSFORMATION_LOT_ERI_MSS = 0x00000105;
/** The kinds of the counts of the walk of a picture of the engine (`EriCode`). */
export const ARCHITECTURE_ARITHMETIC = 32;
export const ARCHITECTURE_RUN_LENGTH_GAMMA = -1;
export const ARCHITECTURE_RUN_LENGTH_HUFFMAN = -4;
export const ARCHITECTURE_NEMESIS = -16;
/** The kinds of the places of a picture of the engine (`EriType`). */
export const TYPE_RGB = 0x00000001;
export const TYPE_GRAY = 0x00000002;
export const TYPE_MASK = 0x0000ffff;
export const TYPE_WITH_ALPHA = 0x04000000;
/** The counts of the walk of the counts of the engine of a picture of it. */
const VERSION_TWO = 2;
const VERSION_FOUR = 4;
const VERSION_SIXTEEN = 16;
const POINTS_PER_BLOCK = 4;
const PLACES_PER_PLACE = 2;
const PLACES_PER_WORD = 4;
const PLACES_PER_BLOCK_LINE = 1;
/** The counts of the walk of the engine of the places of a count of a block of the engine, of no sign. */
const BLOCK_DEGREE_LIMIT = 16;

export interface EriPictureInfo {
	version: number;
	transformation: number;
	architecture: number;
	formatType: number;
	width: number;
	height: number;
	verticalFlip: boolean;
	bpp: number;
	blockingDegree: number;
}

export interface EriPictureInput {
	info: EriPictureInfo;
	/** The places of the walk of the picture, of the places of the count of the walk of it behind them. */
	data: Buffer;
	/** The counts of a colour of the picture (`Palette `), of a count of no colour at all. */
	palette?: Uint8Array;
}

export interface EriPicture {
	/** The places of the picture, of the places of a colour of it, one behind the other. */
	pixels: Uint8Array;
	width: number;
	height: number;
	bpp: number;
	/** The places of the picture stand of the count of the places of a line of it behind it. */
	stride: number;
	/** The places of the picture stand of the places of the picture behind them, of a sign of it. */
	bottomUp: boolean;
	/** The counts of a colour of the picture, of a count of no colour at all. */
	palette: Uint8Array | undefined;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedPicture(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/**
 * `EriReader`: the walk of the places of a picture of the engine, of the counts of the engine itself. The
 * kinds of the counts of a picture of the engine of the two ways of it (`DCT_ERI`, `LOT_ERI`) and the kinds
 * of the walk of the places of the picture of the counts of the walk of the engine (`ArithmeticCode`, of the
 * kinds 2 and 4 of the walk of the places of it) stand refused, of the reference as well: the reference
 * stands of the counts of the walk of the engine of the kind `ArithmeticCode` of no count of the walk of it
 * at all (`NotImplementedException`).
 */
export class EriReader {
	readonly info: EriPictureInfo;
	readonly channelCount: number;
	readonly blockSize: number;
	readonly blockArea: number;
	readonly blockSamples: number;
	readonly widthBlocks: number;
	readonly heightBlocks: number;
	readonly bytesPerLine: number;
	readonly operations: Uint8Array;
	readonly columnBuf: Int8Array;
	readonly lineBuf: Int8Array;
	readonly decodeBuf: Int8Array;
	readonly arrangeBuf: Uint8Array;
	readonly arrangeTable: Int32Array;
	readonly context: ErisaRleDecodeContext;
	readonly palette: Uint8Array | undefined;
	table: Int32Array;
	output: Uint8Array;
	tree: ErisaHuffmanTree | undefined;
	model: ErisaProbModel | undefined;
	restore: (reader: EriReader) => void;
	dst: number;
	dstLineBytes: number;
	dstPixelBytes: number;
	dstWidth: number;
	dstHeight: number;
	dstBlockAt: number;

	constructor(input: EriPictureInput) {
		const info = input.info;
		this.info = info;
		this.palette = input.palette;
		// The places of a picture of the engine stand of the counts of the walk of the engine of the
		// counts of a picture of the engine alone: every other kind of the walk of the places of it stands
		// refused, of the counts of the walk of the engine of the reference as well.
		if (TRANSFORMATION_LOSSLESS_ERI !== info.transformation) {
			if (
				TRANSFORMATION_LOT_ERI === info.transformation ||
				TRANSFORMATION_DCT_ERI === info.transformation ||
				TRANSFORMATION_LOT_ERI_MSS === info.transformation
			) {
				throw unsupportedPicture(
					"The places of a picture of the engine stand of the walks of the counts of a picture of the engine",
				);
			}
			if (TRANSFORMATION_LOSSLESS_EMI === info.transformation) {
				throw unsupportedPicture(
					"The places of a picture of the engine stand of the walk of the places of a picture of the engine of the kind `Lossless_EMI`",
				);
			}
			throw invalidPicture("Invalid Entis picture transformation");
		}
		if (
			ARCHITECTURE_NEMESIS !== info.architecture &&
			ARCHITECTURE_RUN_LENGTH_HUFFMAN !== info.architecture &&
			ARCHITECTURE_RUN_LENGTH_GAMMA !== info.architecture
		) {
			if (ARCHITECTURE_ARITHMETIC === info.architecture) {
				throw unsupportedPicture(
					"The places of a picture of the engine stand of the counts of the walk of the engine of the kind `ArithmeticCode`",
				);
			}
			throw invalidPicture("Invalid Entis picture architecture");
		}
		if (0 === info.blockingDegree) {
			throw invalidPicture("Invalid Entis picture blocking degree");
		}
		// The reference stands of the count of the walk of the engine of the places of a count of a block of
		// the engine of no count of the walk of the engine at all: this port stands of a count of the walk of
		// the engine of sixteen places of the count at most, of the counts of the places of the picture of
		// the engine itself.
		if (info.blockingDegree > BLOCK_DEGREE_LIMIT) {
			throw invalidPicture("Invalid Entis picture blocking degree");
		}
		// The counts of the places of a colour of a picture of the engine stand of the kinds of the places
		// of the picture itself, of the counts of the places of the walk of the engine behind the places of
		// the count of the walk of it.
		switch (info.formatType & TYPE_MASK) {
			case TYPE_RGB:
				if (info.bpp <= 8) {
					this.channelCount = 1;
				} else if (0 === (info.formatType & TYPE_WITH_ALPHA)) {
					this.channelCount = 3;
				} else {
					this.channelCount = 4;
				}
				break;
			case TYPE_GRAY:
				this.channelCount = 1;
				break;
			default:
				throw invalidPicture("Invalid Entis picture format type");
		}
		this.blockSize = 1 << info.blockingDegree;
		this.blockArea = 1 << (info.blockingDegree * PLACES_PER_PLACE);
		this.blockSamples = this.blockArea * this.channelCount;
		this.widthBlocks = (info.width + this.blockSize - 1) >> info.blockingDegree;
		this.heightBlocks =
			(info.height + this.blockSize - 1) >> info.blockingDegree;
		this.operations = new Uint8Array(this.widthBlocks * this.heightBlocks);
		this.columnBuf = new Int8Array(this.blockSize * this.channelCount);
		this.lineBuf = new Int8Array(
			this.channelCount * (this.widthBlocks << info.blockingDegree),
		);
		this.decodeBuf = new Int8Array(this.blockSamples);
		this.arrangeBuf = new Uint8Array(this.blockSamples);
		this.arrangeTable = new Int32Array(POINTS_PER_BLOCK);
		this.table = new Int32Array(0);
		this.output = new Uint8Array(0);
		this.bytesPerLine = 0;
		this.dst = 0;
		this.dstLineBytes = 0;
		this.dstPixelBytes = 0;
		this.dstWidth = 0;
		this.dstHeight = 0;
		this.dstBlockAt = 0;
		this.initializeArrangeTable();
		// The counts of the walk of the engine of the counts of the walk of the picture of the kind
		// `0x00020200` stand of the counts of a picture of the engine of their own.
		if (0x00020200 === info.version) {
			if (ARCHITECTURE_RUN_LENGTH_HUFFMAN === info.architecture) {
				this.tree = new ErisaHuffmanTree();
			} else if (ARCHITECTURE_NEMESIS === info.architecture) {
				this.model = new ErisaProbModel();
			}
		}
		if (ARCHITECTURE_RUN_LENGTH_HUFFMAN === info.architecture) {
			this.context = new ErisaHuffmanDecodeContext(0x10000);
		} else if (ARCHITECTURE_NEMESIS === info.architecture) {
			this.context = new ErisaProbDecodeContext(0x10000);
		} else {
			this.context = new ErisaRleDecodeContext(0x10000);
		}
		const bytes = Math.trunc((info.width * info.bpp) / 8 + 3) & ~3;
		this.bytesPerLine = bytes;
		this.output = new Uint8Array(bytes * info.height);
		// The reference stands of the places of the picture from the count of the places of it behind it
		// where the places of the picture stand of the walk of the places of the engine in front of the
		// places of the count of the walk of it.
		if (!info.verticalFlip) {
			this.dst = (info.height - 1) * bytes;
			this.dstLineBytes = -bytes;
		} else {
			this.dst = 0;
			this.dstLineBytes = bytes;
		}
		this.restore = eriRestoreFunction(this);
		this.context.attachInputFile(input.data);
	}

	/** `InitializeArrangeTable`: the counts of the walk of the places of a count of a block of it. */
	initializeArrangeTable(): void {
		const samples = this.blockSamples;
		const size = this.blockSize;
		this.table = new Int32Array(samples * POINTS_PER_BLOCK);
		this.arrangeTable[0] = 0;
		this.arrangeTable[1] = samples;
		this.arrangeTable[2] = samples * PLACES_PER_PLACE;
		this.arrangeTable[3] = samples * 3;
		// The counts of the walk of the engine of the count of the walk of the places of a block of the
		// engine stand of the counts of the walk of the engine of the places of the count of the walk of
		// the engine of its own.
		let next = this.arrangeTable[0] ?? 0;
		for (let at = 0; at < samples; at += 1) this.table[next + at] = at;
		next = this.arrangeTable[1] ?? 0;
		let line = 0;
		for (let channel = 0; channel < this.channelCount; channel += 1) {
			for (let y = 0; y < size; y += 1) {
				let place = line + y;
				for (let x = 0; x < size; x += 1) {
					this.table[next] = place;
					next += 1;
					place += size;
				}
			}
			line += this.blockArea;
		}
		next = this.arrangeTable[2] ?? 0;
		for (let at = 0; at < this.blockArea; at += 1) {
			let place = at;
			for (let channel = 0; channel < this.channelCount; channel += 1) {
				this.table[next] = place;
				next += 1;
				place += this.blockArea;
			}
		}
		next = this.arrangeTable[3] ?? 0;
		for (let y = 0; y < size; y += 1) {
			let at = y;
			for (let x = 0; x < size; x += 1) {
				let place = at;
				at += size;
				for (let channel = 0; channel < this.channelCount; channel += 1) {
					this.table[next] = place;
					next += 1;
					place += this.blockArea;
				}
			}
		}
	}

	/** `DecodeImage`: the places of the picture of the engine, of the counts of the walk of it. */
	decodeImage(): EriPicture {
		this.decodeLosslessImage();
		return {
			pixels: this.output,
			width: this.info.width,
			height: this.info.height,
			bpp: this.info.bpp,
			stride: Math.abs(this.bytesPerLine),
			bottomUp: !this.info.verticalFlip,
			palette: this.palette,
		};
	}

	/** `DecodeLosslessImage`: the places of a picture of the engine of the counts of a picture of it. */
	decodeLosslessImage(): void {
		const context = this.context;
		context.flushBuffer();
		const version = context.getNBits(8);
		const opTable = context.getNBits(8);
		const encodeType = context.getNBits(8);
		const bitCount = context.getNBits(8);
		if (0 !== opTable || 0 !== (encodeType & 0xfe)) {
			throw invalidPicture("Invalid Entis picture walk");
		}
		switch (version) {
			case 1:
				if (0 !== bitCount) throw invalidPicture("Invalid Entis picture walk");
				break;
			case VERSION_TWO:
				if (0 !== bitCount || 0 !== encodeType) {
					throw invalidPicture("Invalid Entis picture walk");
				}
				throw unsupportedPicture(
					"The places of a picture of the engine stand of the counts of the walk of the engine of the kind 2",
				);
			case VERSION_FOUR:
				throw unsupportedPicture(
					"The places of a picture of the engine stand of the counts of the walk of the engine of the kind 4",
				);
			case 8:
				if (8 !== bitCount) throw invalidPicture("Invalid Entis picture walk");
				break;
			case VERSION_SIXTEEN:
				if (8 !== bitCount || 0 !== encodeType) {
					throw invalidPicture("Invalid Entis picture walk");
				}
				break;
			default:
				throw invalidPicture("Invalid Entis picture walk");
		}
		this.dstPixelBytes = this.info.bpp >> 3;
		let operationAt = 0;
		if (0 !== (encodeType & 1) && this.channelCount >= 3) {
			if (ARCHITECTURE_NEMESIS === this.info.architecture) {
				throw invalidPicture("Invalid Entis picture walk");
			}
			const blockCount = this.widthBlocks * this.heightBlocks;
			for (let at = 0; at < blockCount; at += 1) {
				if (ARCHITECTURE_RUN_LENGTH_GAMMA === this.info.architecture) {
					this.operations[at] = (context.getNBits(4) | 0xc0) & 0xff;
				} else {
					// The counts of the walk of the engine of the places of the picture stand of the counts
					// of the walk of the engine of the counts of a count of the walk of it: the reference
					// stands of the count of the walk of the engine of the kind `0x00020100` of no count of
					// the walk of the engine at all, of a count of the walk of the engine of the walk of it.
					if (!this.tree) {
						throw unsupportedPicture(
							"The places of a picture of the engine stand of the counts of the walk of the engine of the walk of the picture of the port",
						);
					}
					this.operations[at] =
						(context as ErisaHuffmanDecodeContext).getHuffmanCode(this.tree) &
						0xff;
				}
			}
		}
		if (0 !== context.getABit()) {
			throw invalidPicture("Invalid Entis picture walk");
		}
		if (ARCHITECTURE_RUN_LENGTH_GAMMA === this.info.architecture) {
			if (0 !== (encodeType & 1)) context.initGammaContext();
		} else if (ARCHITECTURE_RUN_LENGTH_HUFFMAN === this.info.architecture) {
			(context as ErisaHuffmanDecodeContext).prepareToDecodeErinaCode();
		} else {
			(context as ErisaProbDecodeContext).prepareToDecodeErisaCode();
		}
		this.lineBuf.fill(0);
		const blockLines = this.blockSize * this.channelCount;
		let leftHeight = this.info.height;
		for (let posY = 0; posY < this.heightBlocks; posY += 1) {
			this.columnBuf.fill(0);
			this.dstBlockAt = this.dst + posY * this.dstLineBytes * this.blockSize;
			this.dstHeight = Math.min(this.blockSize, leftHeight);
			let leftWidth = this.info.width;
			let lineAt = 0;
			for (let posX = 0; posX < this.widthBlocks; posX += 1) {
				this.dstWidth = Math.min(this.blockSize, leftWidth);
				let operation: number;
				if (this.channelCount >= 3) {
					if (0 !== (encodeType & 1)) {
						operation = this.operations[operationAt] ?? 0;
						operationAt += 1;
					} else if (
						ARCHITECTURE_RUN_LENGTH_HUFFMAN === this.info.architecture
					) {
						if (!this.tree) {
							throw unsupportedPicture(
								"The places of a picture of the engine stand of the counts of the walk of the engine of the walk of the picture of the port",
							);
						}
						operation = (context as ErisaHuffmanDecodeContext).getHuffmanCode(
							this.tree,
						);
					} else if (ARCHITECTURE_NEMESIS === this.info.architecture) {
						if (!this.model) {
							throw unsupportedPicture(
								"The places of a picture of the engine stand of the counts of the walk of the engine of the walk of the picture of the port",
							);
						}
						operation = (context as ErisaProbDecodeContext).decodeErisaCode(
							this.model,
						);
					} else {
						operation = context.getNBits(4) | 0xc0;
						context.initGammaContext();
					}
				} else if (TYPE_GRAY === this.info.formatType) {
					operation = 0xc0;
				} else {
					operation = 0;
					if (
						0 === (encodeType & 1) &&
						ARCHITECTURE_RUN_LENGTH_GAMMA === this.info.architecture
					) {
						context.initGammaContext();
					}
				}
				if (
					context.decodeBytes(this.arrangeBuf, this.blockSamples) <
					this.blockSamples
				) {
					throw invalidPicture(
						"The count of the walk of the picture stands short of its places",
					);
				}
				this.performOperation(operation, blockLines, lineAt);
				lineAt += this.blockSize * this.channelCount;
				this.restore(this);
				this.dstBlockAt += this.dstPixelBytes * this.blockSize;
				leftWidth -= this.blockSize;
			}
			leftHeight -= this.blockSize;
		}
	}

	/** `PerformOperation`: the counts of the walk of the engine of a block of the picture of it. */
	performOperation(
		operation: number,
		blockLines: number,
		lineAt: number,
	): void {
		const colorOperation = operation & 0x0f;
		const arrangeCode = (operation >> 4) & 0x03;
		const diffOperation = (operation >> 6) & 0x03;
		if (0 === arrangeCode) {
			this.decodeBuf.set(this.arrangeBuf.subarray(0, this.blockSamples));
			if (0 === operation) return;
		} else {
			const at = this.arrangeTable[arrangeCode] ?? 0;
			for (let place = 0; place < this.blockSamples; place += 1) {
				this.decodeBuf[this.table[at + place] ?? 0] =
					this.arrangeBuf[place] ?? 0;
			}
		}
		eriColorOperation(colorOperation, this.decodeBuf, this.blockArea);
		let next = 0;
		let column = 0;
		if (0 !== (diffOperation & PLACES_PER_BLOCK_LINE)) {
			for (let line = 0; line < blockLines; line += 1) {
				let last = this.columnBuf[column] ?? 0;
				for (let x = 0; x < this.blockSize; x += 1) {
					last = (last + (this.decodeBuf[next] ?? 0)) & 0xff;
					this.decodeBuf[next] = (last << 24) >> 24;
					next += 1;
				}
				this.columnBuf[column] = (last << 24) >> 24;
				column += 1;
			}
		} else {
			for (let line = 0; line < blockLines; line += 1) {
				this.columnBuf[column] = this.decodeBuf[next + this.blockSize - 1] ?? 0;
				column += 1;
				next += this.blockSize;
			}
		}
		let dstAt = 0;
		for (let channel = 0; channel < this.channelCount; channel += 1) {
			let lastLine: Int8Array = this.lineBuf;
			let lastAt = lineAt;
			for (let y = 0; y < this.blockSize; y += 1) {
				for (let x = 0; x < this.blockSize; x += 1) {
					this.decodeBuf[dstAt + x] =
						((this.decodeBuf[dstAt + x] ?? 0) + (lastLine[lastAt + x] ?? 0)) &
						0xff;
				}
				lastLine = this.decodeBuf;
				lastAt = dstAt;
				dstAt += this.blockSize;
			}
			this.lineBuf.set(
				lastLine.subarray(lastAt, lastAt + this.blockSize),
				lineAt,
			);
			lineAt += this.blockSize;
		}
	}
}

/**
 * `PerformOperation`, the counts of the walk of the engine of the counts of a colour of a block of the
 * engine: every count of a colour stands of the counts of the walk of the engine of the count of the walk
 * of the engine of a count of a colour of its own.
 */
export function eriColorOperation(
	operation: number,
	buffer: Int8Array,
	area: number,
): void {
	const two = area * PLACES_PER_PLACE;
	switch (operation) {
		case 5:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at] ?? 0;
				buffer[at + area] = ((buffer[at + area] ?? 0) + base) & 0xff;
			}
			return;
		case 6:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at] ?? 0;
				buffer[at + two] = ((buffer[at + two] ?? 0) + base) & 0xff;
			}
			return;
		case 7:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at] ?? 0;
				buffer[at + area] = ((buffer[at + area] ?? 0) + base) & 0xff;
				buffer[at + two] = ((buffer[at + two] ?? 0) + base) & 0xff;
			}
			return;
		case 9:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at + area] ?? 0;
				buffer[at] = ((buffer[at] ?? 0) + base) & 0xff;
			}
			return;
		case 10:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at + area] ?? 0;
				buffer[at + two] = ((buffer[at + two] ?? 0) + base) & 0xff;
			}
			return;
		case 11:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at + area] ?? 0;
				buffer[at] = ((buffer[at] ?? 0) + base) & 0xff;
				buffer[at + two] = ((buffer[at + two] ?? 0) + base) & 0xff;
			}
			return;
		case 13:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at + two] ?? 0;
				buffer[at] = ((buffer[at] ?? 0) + base) & 0xff;
			}
			return;
		case 14:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at + two] ?? 0;
				buffer[at + area] = ((buffer[at + area] ?? 0) + base) & 0xff;
			}
			return;
		case 15:
			for (let at = 0; at < area; at += 1) {
				const base = buffer[at + two] ?? 0;
				buffer[at] = ((buffer[at] ?? 0) + base) & 0xff;
				buffer[at + area] = ((buffer[at + area] ?? 0) + base) & 0xff;
			}
			return;
		default:
			// The counts of the walk of the engine of the counts of a colour of the kinds of no count of
			// the walk of the engine at all stand of no count of the walk of the engine of their own.
			return;
	}
}

/**
 * `GetLLRestoreFunc`: the places of the walk of the engine of the counts of a block of the picture, of the
 * counts of the places of a colour of it. The picture of the engine in front of the places of the walk of
 * the picture stands unported (`RestoreDelta*`), of the reference as well: the reference stands of the
 * counts of the walk of the engine of the picture in front of it, of the counts of the walk of the engine
 * of the count of the walk of the picture itself.
 */
function eriRestoreFunction(reader: EriReader): (reader: EriReader) => void {
	switch (reader.info.bpp) {
		case 32:
			return 0 === (reader.info.formatType & TYPE_WITH_ALPHA)
				? restoreRgb24
				: restoreRgba32;
		case 24:
			return restoreRgb24;
		case 8:
			return restoreGray8;
		default:
			throw unsupportedPicture(
				"The places of a picture of the engine stand of the places of the count of the walk of the engine of its own",
			);
	}
}

/** `RestoreRGBA32`: the places of a picture of four counts of a colour. */
export function restoreRgba32(reader: EriReader): void {
	const area = reader.blockArea;
	const output = reader.output;
	let dstLine = reader.dstBlockAt;
	let srcLine = 0;
	for (let y = 0; y < reader.dstHeight; y += 1) {
		let dst = dstLine;
		let src = srcLine;
		for (let x = 0; x < reader.dstWidth; x += 1) {
			output[dst] = reader.decodeBuf[src] ?? 0;
			output[dst + 1] = reader.decodeBuf[src + area] ?? 0;
			output[dst + 2] = reader.decodeBuf[src + area * PLACES_PER_PLACE] ?? 0;
			output[dst + 3] = reader.decodeBuf[src + area * 3] ?? 0;
			src += 1;
			dst += PLACES_PER_WORD;
		}
		srcLine += reader.blockSize;
		dstLine += reader.dstLineBytes;
	}
}

/** `RestoreRGB24`: the places of a picture of three counts of a colour. */
export function restoreRgb24(reader: EriReader): void {
	const area = reader.blockArea;
	const output = reader.output;
	let dstLine = reader.dstBlockAt;
	let srcLine = 0;
	for (let y = 0; y < reader.dstHeight; y += 1) {
		let dst = dstLine;
		let src = srcLine;
		for (let x = 0; x < reader.dstWidth; x += 1) {
			output[dst] = reader.decodeBuf[src] ?? 0;
			output[dst + 1] = reader.decodeBuf[src + area] ?? 0;
			output[dst + 2] = reader.decodeBuf[src + area * PLACES_PER_PLACE] ?? 0;
			src += 1;
			dst += reader.dstPixelBytes;
		}
		srcLine += reader.blockSize;
		dstLine += reader.dstLineBytes;
	}
}

/** `RestoreGray8`: the places of a picture of one count of a colour. */
export function restoreGray8(reader: EriReader): void {
	let dstLine = reader.dstBlockAt;
	let srcLine = 0;
	for (let y = 0; y < reader.dstHeight; y += 1) {
		reader.output.set(
			reader.decodeBuf.subarray(srcLine, srcLine + reader.dstWidth),
			dstLine,
		);
		srcLine += reader.blockSize;
		dstLine += reader.dstLineBytes;
	}
}
