// The sound of the Entis engine (`MIO`), of the reference `ArcFormats/Entis/AudioMIO.cs` (`MioAudio`,
// `MioInput`) over the walks of `ArcFormats/Entis/MioDecoder.cs` (`MioDecoder`, `MioInfoHeader`,
// `MioDataHeader`).
//
// A sound of the engine stands of the head of the archives of it (`Enti`, the identifier of the kind of the
// file and the name of it) and of the sections of the head of it: the `SoundInf` section (the counts of the
// sound and the kind of the places of the walk of it) and then a chain of `SoundStm` sections, every one of
// them a count of the places of the walk of the sound. A sound of the kind `Lossless_ERI` stands of the
// counts of a picture of the engine alone, of a count of no sign at all and of a count of the counts behind
// it, which the walk of the engine stands of (`codecs/erisa-context.ts`); a sound of the kinds `LOT_ERI`
// and `LOT_ERI_MSS` stands of the walks of a picture of the engine itself (the walks of the counts of a
// picture, of the places of a colour and of the places of a block of it), which stand unported here.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import {
	type EriSinCos,
	ErisaHuffmanDecodeContext,
	createRevolveParameter,
	fastIdct,
	fastIlot,
	fastIplot,
	oddGivensInverseMatrix,
	revolve2x2,
	roundR32ToWordArray,
} from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";

const SIGNATURE = Buffer.from("Enti", "latin1");
const HEADER_SIZE = 0x40;
const SECTION_HEADER_SIZE = 0x10;
const ID_OFFSET = 8;
const SUPPORTED_ID = 0x03000100;
const MUSIC_NAME = "Music Interleaved";
const HEADER_SECTION = "Header  ";
const SOUND_INFO_SECTION = "SoundInf";
const STREAM_SECTION = "Stream  ";
const SOUND_STREAM_SECTION = "SoundStm";
const CHUNK_HEADER_SIZE = 0x08;
const BODY_LIMIT = 0x1000000;
const CHUNK_LIMIT = 0x100000;
/** The kinds of the walk of the places of a sound of the engine (`CvType`). */
const TRANSFORMATION_LOSSLESS_ERI = 0x03020000;
const TRANSFORMATION_LOT_ERI = 0x00000005;
const TRANSFORMATION_LOT_ERI_MSS = 0x00000105;
/** The kinds of the counts of the walk of a sound of the engine (`EriCode`). */
const ARCHITECTURE_RUN_LENGTH_HUFFMAN = -4;
const ARCHITECTURE_NEMESIS = -16;
const BITS_PER_SAMPLE_8 = 8;
const BITS_PER_SAMPLE_16 = 16;
const CHANNEL_LIMIT = 2;
/** The flag of the count of the walk of a sound of the engine: the walk of the counts of it begins. */
const MIO_LEAD_BLOCK = 0x01;
/** The counts of the walk of the picture of the engine of a sound of the counts of the walk of it. */
const ARCHITECTURE_RUN_LENGTH_GAMMA = -1;
const MIN_SUBBAND_DEGREE = 8;
const MAX_SUBBAND_DEGREE = 12;
const LAPPED_DEGREE = 1;
/** The counts of the walk of the counts of a picture of the engine. */
const DIVISION_BITS = 2;
const REVOLVE_BITS = 4;
const CODE_MARGIN = 10;
const WORD_PLACES = 2;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedSound(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** `MioInfoHeader`: the counts of a sound of the engine and the kind of the walk of the places of it. */
export interface MioInfoHeader {
	version: number;
	transformation: number;
	architecture: number;
	channelCount: number;
	samplesPerSec: number;
	blocksetCount: number;
	subbandDegree: number;
	allSampleCount: number;
	lappedDegree: number;
	bitsPerSample: number;
}

/** A count of the places of the walk of a sound of the engine (`SoundStm`). */
export interface MioChunk {
	/** The places of the count of the walk of the engine within the file. */
	offset: number;
	/** The count of the places of the count of the walk of the engine. */
	size: number;
	version: number;
	flags: number;
	sampleCount: number;
}

export interface MioLayout {
	info: MioInfoHeader;
	chunks: MioChunk[];
}

/** `EriFile.ReadSection`: the name of a section of the engine and the count of the places behind it. */
function readSectionHead(
	data: Buffer,
	at: number,
): { id: string; length: number } | undefined {
	if (at + SECTION_HEADER_SIZE > data.length) return undefined;
	const id = data.toString("latin1", at, at + 8);
	const length = data.readBigInt64LE(at + 8);
	if (length < 0n || length > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
	return { id, length: Number(length) };
}

/** `MioAudio.TryOpen`: the head of a sound of the engine and the sections of it. */
export function readMioLayout(data: Buffer): MioLayout | undefined {
	if (data.length < HEADER_SIZE + SECTION_HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (SUPPORTED_ID !== data.readUInt32LE(ID_OFFSET)) return undefined;
	const name = data.subarray(0x10, 0x10 + MUSIC_NAME.length);
	if (!name.equals(Buffer.from(MUSIC_NAME, "latin1"))) return undefined;
	const layer = readSectionHead(data, HEADER_SIZE);
	if (!layer || layer.id !== HEADER_SECTION || layer.length <= 0) {
		return undefined;
	}
	const bodySize = layer.length;
	if (bodySize > BODY_LIMIT) return undefined;
	const bodyAt = HEADER_SIZE + SECTION_HEADER_SIZE;
	if (bodyAt + bodySize > data.length) return undefined;
	let info: MioInfoHeader | undefined;
	let at = bodyAt;
	let left = bodySize;
	while (left > SECTION_HEADER_SIZE) {
		const section = readSectionHead(data, at);
		if (!section) break;
		at += SECTION_HEADER_SIZE;
		left -= SECTION_HEADER_SIZE;
		if (section.length <= 0 || section.length > left) break;
		if (SOUND_INFO_SECTION === section.id) {
			if (at + 0x30 > data.length) return undefined;
			info = {
				version: data.readInt32LE(at),
				transformation: data.readInt32LE(at + 4),
				architecture: data.readInt32LE(at + 8),
				channelCount: data.readInt32LE(at + 0x0c),
				samplesPerSec: data.readUInt32LE(at + 0x10),
				blocksetCount: data.readUInt32LE(at + 0x14),
				subbandDegree: data.readInt32LE(at + 0x18),
				allSampleCount: data.readUInt32LE(at + 0x1c),
				lappedDegree: data.readUInt32LE(at + 0x20),
				bitsPerSample: data.readUInt32LE(at + 0x24),
			};
			break;
		}
		at += section.length;
		left -= section.length;
	}
	if (!info) return undefined;
	if (1 !== info.channelCount && CHANNEL_LIMIT !== info.channelCount) {
		return undefined;
	}
	// The walk of the places of a sound of the engine stands of the counts of the engine alone
	// (`Lossless_ERI`) or of the walks of a picture of the engine (`LOT_ERI`), of the counts of no sign at
	// all or of the counts of the walk of the engine.
	if (TRANSFORMATION_LOSSLESS_ERI === info.transformation) {
		if (ARCHITECTURE_RUN_LENGTH_HUFFMAN !== info.architecture) {
			return undefined;
		}
		if (
			BITS_PER_SAMPLE_8 !== info.bitsPerSample &&
			BITS_PER_SAMPLE_16 !== info.bitsPerSample
		) {
			return undefined;
		}
	} else if (
		TRANSFORMATION_LOT_ERI === info.transformation ||
		TRANSFORMATION_LOT_ERI_MSS === info.transformation
	) {
		// `MioDecoder.Initialize`: a sound of the walk of the picture of the engine stands of the counts of
		// the walk of the engine of the two ways of it, of the places of the walk of the counts of a count
		// of the engine itself, of the counts of a walk of the picture of the engine.
		if (
			ARCHITECTURE_RUN_LENGTH_GAMMA !== info.architecture &&
			ARCHITECTURE_RUN_LENGTH_HUFFMAN !== info.architecture &&
			ARCHITECTURE_NEMESIS !== info.architecture
		) {
			return undefined;
		}
		if (BITS_PER_SAMPLE_16 !== info.bitsPerSample) return undefined;
		if (
			info.subbandDegree < MIN_SUBBAND_DEGREE ||
			info.subbandDegree > MAX_SUBBAND_DEGREE
		) {
			return undefined;
		}
		if (LAPPED_DEGREE !== info.lappedDegree) return undefined;
	} else {
		return undefined;
	}
	// The places of the sound of the engine stand of the sections of the head of it (`Stream  `), of the
	// counts of the walk of the engine behind them.
	const streamSection = findSection(data, bodyAt + bodySize, STREAM_SECTION);
	if (!streamSection) return undefined;
	const chunks: MioChunk[] = [];
	let chunkAt = streamSection.at;
	while (chunks.length < CHUNK_LIMIT) {
		const chunk = findSection(data, chunkAt, SOUND_STREAM_SECTION);
		if (!chunk) break;
		if (chunk.length < CHUNK_HEADER_SIZE) break;
		const head = chunk.at;
		const sampleCount = data.readUInt32LE(head + 4);
		const places = data.subarray(head + CHUNK_HEADER_SIZE, head + chunk.length);
		chunks.push({
			offset: head + CHUNK_HEADER_SIZE,
			size: chunk.length - CHUNK_HEADER_SIZE,
			version: data[head] ?? 0,
			flags: data[head + 1] ?? 0,
			sampleCount,
		});
		chunkAt = head + chunk.length;
		if (places.length !== chunk.length - CHUNK_HEADER_SIZE) break;
	}
	if (0 === chunks.length) return undefined;
	return { info, chunks };
}

/** `EriFile.FindSection`: the places of a section of the engine, of the name of it. */
function findSection(
	data: Buffer,
	at: number,
	name: string,
): { at: number; length: number } | undefined {
	let place = at;
	while (place + SECTION_HEADER_SIZE <= data.length) {
		const section = readSectionHead(data, place);
		if (!section) return undefined;
		const head = place + SECTION_HEADER_SIZE;
		if (section.id === name) return { at: head, length: section.length };
		place = head + section.length;
	}
	return undefined;
}

/** The widths of the places of the walk of the counts of a picture of the engine, of the count of it. */
const FREQ_WIDTH = [-6, -6, -5, -4, -3, -2, -1];
const FREQ_POINTS = 7;
const WEIGHT_BITS = 5;
const WEIGHT_MASK = 0x1f;
const WEIGHT_MIDDLE = 15;
const WEIGHT_ODD_SHIFT = 30;
const WEIGHT_ODD_MASK = 0x03;
const WEIGHT_STEP = 16;

/** `MioDecoder`: the places of a sound of the engine, of the counts of the walk of the engine. */
export class MioDecoder {
	info: MioInfoHeader;
	/** The count of the places of the walk of the block of the engine of the walk of the places of it. */
	degree: number;
	places: number;
	revolve: EriSinCos[];
	frequencyPoints: number[];
	weightTable: Float32Array;
	/** The places of the walks of a picture of the engine, of the counts of a count of the walk of it. */
	matrixBuf: Float32Array;
	internalBuf: Float32Array;
	workBuf: Float32Array;
	lastDctBuf: Float32Array;
	buffer1: Int32Array;
	buffer2: Int32Array;
	weightCodes: Int32Array;
	coefficients: Int32Array;
	nextWeight: number;
	nextCoefficient: number;
	nextSource: number;
	lastDctAt: number;

	constructor(info: MioInfoHeader) {
		this.info = info;
		this.degree = 0;
		this.places = 0;
		this.revolve = [];
		this.frequencyPoints = [];
		this.weightTable = new Float32Array(0);
		this.matrixBuf = new Float32Array(0);
		this.internalBuf = new Float32Array(0);
		this.workBuf = new Float32Array(0);
		this.lastDctBuf = new Float32Array(0);
		this.buffer1 = new Int32Array(0);
		this.buffer2 = new Int32Array(0);
		this.weightCodes = new Int32Array(0);
		this.coefficients = new Int32Array(0);
		this.nextWeight = 0;
		this.nextCoefficient = 0;
		this.nextSource = 0;
		this.lastDctAt = 0;
	}

	/** `InitializeWithDegree`: the counts of the walks of the counts of a picture of the engine. */
	initializeWithDegree(degree: number): void {
		this.degree = degree;
		this.places = 1 << degree;
		this.revolve = createRevolveParameter(degree);
		this.frequencyPoints = [];
		let counted = 0;
		for (let at = 0; at < FREQ_POINTS; at += 1) {
			const width = 1 << (degree + (FREQ_WIDTH[at] ?? 0));
			this.frequencyPoints.push(counted + Math.trunc(width / 2));
			counted += width;
		}
		this.weightTable = new Float32Array(this.places);
	}

	/** `IQuantumize`: the counts of the walk of a count of the engine, of the counts of the walk of it. */
	iQuantumize(
		dst: Float32Array,
		at: number,
		quantized: Int32Array,
		from: number,
		degree: number,
		weightCode: number,
		coefficient: number,
	): void {
		const scale = Math.sqrt(2 / degree);
		const counted = scale * coefficient;
		const ratios: number[] = [];
		for (let place = 0; place < FREQ_POINTS - 1; place += 1) {
			// The counts of the walk of the engine stand of the counts of the walk of the count of the
			// engine of the two ways of it: the highest place of the count of the walk of the engine stands
			// of a count of its own, and the places of the walk of the engine stand of the counts of the
			// walk of the engine of the two ways of it of the count of the walk of it.
			const code =
				((weightCode >>> (place * WEIGHT_BITS)) & WEIGHT_MASK) - WEIGHT_MIDDLE;
			ratios.push(1 / 2 ** (code * 0.5));
		}
		ratios.push(1);
		const table = this.weightTable;
		const first = this.frequencyPoints[0] ?? 0;
		for (let place = 0; place < first && place < table.length; place += 1) {
			table[place] = ratios[0] ?? 1;
		}
		let place = first;
		for (let point = 1; point < FREQ_POINTS; point += 1) {
			const before = ratios[point - 1] ?? 1;
			const limit = this.frequencyPoints[point] ?? place;
			const step = (ratios[point] ?? 1) - before;
			const width = limit - (this.frequencyPoints[point - 1] ?? 0);
			const grade = 0 === width ? 0 : step / width;
			while (place < limit) {
				table[place] =
					grade * (place - (this.frequencyPoints[point - 1] ?? 0)) + before;
				place += 1;
			}
		}
		while (place < degree) {
			table[place] = ratios[FREQ_POINTS - 1] ?? 1;
			place += 1;
		}
		const odd = (((weightCode >>> WEIGHT_ODD_SHIFT) & WEIGHT_ODD_MASK) + 2) / 2;
		for (let step = 15; step < degree; step += WEIGHT_STEP) {
			table[step] = (table[step] ?? 0) * odd;
		}
		table[degree - 1] = coefficient;
		for (let step = 0; step < degree; step += 1) {
			table[step] = 1 / (table[step] ?? 1);
		}
		for (let step = 0; step < degree; step += 1) {
			dst[at + step] =
				counted * (table[step] ?? 0) * (quantized[from + step] ?? 0);
		}
	}

	/** `DecodeLeadBlock`: the places of the first count of the walk of a block of the engine. */
	decodeLeadBlock(weightCode: number, coefficient: number): void {
		const half = Math.trunc(this.places / 2);
		for (let place = 0; place < half; place += 1) {
			this.buffer1[place * 2] = 0;
			this.buffer1[place * 2 + 1] = this.buffer2[this.nextSource + place] ?? 0;
		}
		this.nextSource += half;
		this.iQuantumize(
			this.lastDctBuf,
			this.lastDctAt,
			this.buffer1,
			0,
			this.places,
			weightCode,
			coefficient,
		);
		oddGivensInverseMatrix(
			this.lastDctBuf,
			this.lastDctAt,
			this.revolve,
			this.degree,
		);
		for (let place = 0; place < this.places; place += 2) {
			this.lastDctBuf[this.lastDctAt + place] =
				this.lastDctBuf[this.lastDctAt + place + 1] ?? 0;
		}
		fastIplot(this.lastDctBuf, this.lastDctAt, this.degree);
	}

	/** `DecodeInternalBlock`: the places of a count of the walk of a block of the engine. */
	decodeInternalBlock(
		dst: Uint8Array,
		at: number,
		samples: number,
		weightCode: number,
		coefficient: number,
	): void {
		this.iQuantumize(
			this.matrixBuf,
			0,
			this.buffer2,
			this.nextSource,
			this.places,
			weightCode,
			coefficient,
		);
		this.nextSource += this.places;
		oddGivensInverseMatrix(this.matrixBuf, 0, this.revolve, this.degree);
		fastIplot(this.matrixBuf, 0, this.degree);
		fastIlot(
			this.workBuf,
			this.lastDctBuf,
			this.lastDctAt,
			this.matrixBuf,
			0,
			this.degree,
		);
		for (let place = 0; place < this.places; place += 1) {
			this.lastDctBuf[this.lastDctAt + place] = this.matrixBuf[place] ?? 0;
			this.matrixBuf[place] = this.workBuf[place] ?? 0;
		}
		fastIdct(
			this.internalBuf,
			0,
			this.matrixBuf,
			0,
			1,
			this.workBuf,
			this.degree,
		);
		if (0 !== samples) {
			roundR32ToWordArray(
				dst,
				at,
				this.info.channelCount,
				this.internalBuf,
				samples,
			);
		}
	}

	/** `DecodePostBlock`: the places of the last count of the walk of a block of the engine. */
	decodePostBlock(
		dst: Uint8Array,
		at: number,
		samples: number,
		weightCode: number,
		coefficient: number,
	): void {
		const half = Math.trunc(this.places / 2);
		for (let place = 0; place < half; place += 1) {
			this.buffer1[place * 2] = 0;
			this.buffer1[place * 2 + 1] = this.buffer2[this.nextSource + place] ?? 0;
		}
		this.nextSource += half;
		this.iQuantumize(
			this.matrixBuf,
			0,
			this.buffer1,
			0,
			this.places,
			weightCode,
			coefficient,
		);
		oddGivensInverseMatrix(this.matrixBuf, 0, this.revolve, this.degree);
		for (let place = 0; place < this.places; place += 2) {
			this.matrixBuf[place] = -(this.matrixBuf[place + 1] ?? 0);
		}
		fastIplot(this.matrixBuf, 0, this.degree);
		fastIlot(
			this.workBuf,
			this.lastDctBuf,
			this.lastDctAt,
			this.matrixBuf,
			0,
			this.degree,
		);
		for (let place = 0; place < this.places; place += 1) {
			this.matrixBuf[place] = this.workBuf[place] ?? 0;
		}
		fastIdct(
			this.internalBuf,
			0,
			this.matrixBuf,
			0,
			1,
			this.workBuf,
			this.degree,
		);
		if (0 !== samples) {
			roundR32ToWordArray(
				dst,
				at,
				this.info.channelCount,
				this.internalBuf,
				samples,
			);
		}
	}

	/** `DecodeSoundDCT`: the places of a sound of the engine, of the walk of the picture of it. */
	decodeSoundDct(chunk: MioChunk, places: Buffer): Uint8Array {
		const info = this.info;
		const degreeWidth = 1 << info.subbandDegree;
		const subbandCount = Math.trunc(
			(chunk.sampleCount + degreeWidth - 1) / degreeWidth,
		);
		const sampleCount = subbandCount * degreeWidth;
		const channelCount = info.channelCount;
		const allSampleCount = sampleCount * channelCount;
		const allSubbandCount = subbandCount * channelCount;
		const blockSize = channelCount * degreeWidth;
		// The reference stands of the counts of the walk of the count of the engine of the places of a
		// count of the walk of it alone: this port stands of the places of the walk of the engine of the
		// count of the walk of it and of the count of the places of the walk of the engine behind it, of
		// no count of a walk of the engine.
		const codeCount = allSubbandCount * CODE_MARGIN + channelCount;
		this.matrixBuf = new Float32Array(blockSize);
		this.internalBuf = new Float32Array(blockSize);
		this.workBuf = new Float32Array(degreeWidth);
		this.lastDctBuf = new Float32Array(blockSize * info.lappedDegree);
		this.buffer1 = new Int32Array(blockSize);
		this.buffer2 = new Int32Array(allSampleCount);
		this.weightCodes = new Int32Array(codeCount);
		this.coefficients = new Int32Array(codeCount);
		const divisionTable = new Uint8Array(allSubbandCount);
		if (ARCHITECTURE_RUN_LENGTH_HUFFMAN !== info.architecture) {
			throw unsupportedSound(
				"The places of a sound of the engine stand of the walk of the counts of it of no walk of the engine",
			);
		}
		const context = new ErisaHuffmanDecodeContext(0x10000);
		context.attachInputFile(places);
		context.flushBuffer();
		if (0 !== context.getABit()) {
			throw invalidSound(
				"The walk of the counts of the sound of the engine stands of no count of it",
			);
		}
		let nextDivision = 0;
		this.nextWeight = 0;
		this.nextCoefficient = 0;
		const lastDivision = new Int32Array(channelCount).fill(-1);
		for (let subband = 0; subband < subbandCount; subband += 1) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				const division = context.getNBits(DIVISION_BITS);
				divisionTable[nextDivision] = division;
				nextDivision += 1;
				if (division !== (lastDivision[channel] ?? -1)) {
					if (0 !== subband) {
						this.weightCodes[this.nextWeight] = context.getNBits(32);
						this.nextWeight += 1;
						this.coefficients[this.nextCoefficient] = context.getNBits(16);
						this.nextCoefficient += 1;
					}
					lastDivision[channel] = division;
				}
				const divisionCount = 1 << division;
				for (let place = 0; place < divisionCount; place += 1) {
					this.weightCodes[this.nextWeight] = context.getNBits(32);
					this.nextWeight += 1;
					this.coefficients[this.nextCoefficient] = context.getNBits(16);
					this.nextCoefficient += 1;
				}
			}
		}
		if (subbandCount > 0) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				this.weightCodes[this.nextWeight] = context.getNBits(32);
				this.nextWeight += 1;
				this.coefficients[this.nextCoefficient] = context.getNBits(16);
				this.nextCoefficient += 1;
			}
		}
		if (0 !== context.getABit()) {
			throw invalidSound(
				"The walk of the counts of the sound of the engine stands of no count of it",
			);
		}
		if (0 !== (chunk.flags & MIO_LEAD_BLOCK)) {
			context.prepareToDecodeErinaCode();
		}
		const decoded = new Uint8Array(allSampleCount * WORD_PLACES);
		if (
			context.decodeBytes(decoded, allSampleCount * WORD_PLACES) <
			allSampleCount * WORD_PLACES
		) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		// The places of the walk of the engine stand of the counts of the place of the walk of the count
		// above and of the count of the place of the walk of the engine behind it of every count of the
		// walk of the engine of a count of the sound of the engine.
		let high = 0;
		let low = allSampleCount;
		for (let place = 0; place < degreeWidth; place += 1) {
			let quantumized = place;
			for (let subband = 0; subband < allSubbandCount; subband += 1) {
				const lowPlace = ((decoded[low] ?? 0) << 24) >> 24;
				const highPlace =
					(((decoded[high] ?? 0) << 24) >> 24) ^ (lowPlace >> 8);
				this.buffer2[quantumized] = (lowPlace & 0xff) | (highPlace << 8);
				quantumized += degreeWidth;
				low += 1;
				high += 1;
			}
		}
		const out = new Uint8Array(chunk.sampleCount * channelCount * WORD_PLACES);
		const rest = new Int32Array(channelCount);
		const dest = new Int32Array(channelCount);
		for (let channel = 0; channel < channelCount; channel += 1) {
			rest[channel] = chunk.sampleCount;
			dest[channel] = channel * WORD_PLACES;
		}
		nextDivision = 0;
		this.nextWeight = 0;
		this.nextCoefficient = 0;
		this.nextSource = 0;
		lastDivision.fill(-1);
		let currentDivision = -1;
		for (let subband = 0; subband < subbandCount; subband += 1) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				const division = divisionTable[nextDivision] ?? 0;
				nextDivision += 1;
				const divisionCount = 1 << division;
				this.lastDctAt = degreeWidth * info.lappedDegree * channel;
				let lead = false;
				if ((lastDivision[channel] ?? -1) !== division) {
					if (0 !== subband) {
						if (currentDivision !== (lastDivision[channel] ?? -1)) {
							this.initializeWithDegree(
								info.subbandDegree - (lastDivision[channel] ?? 0),
							);
							currentDivision = lastDivision[channel] ?? 0;
						}
						const samples = Math.min(rest[channel] ?? 0, this.places);
						this.decodePostBlock(
							out,
							dest[channel] ?? 0,
							samples,
							this.weightCodes[this.nextWeight] ?? 0,
							this.coefficients[this.nextCoefficient] ?? 0,
						);
						this.advanceBlock(channel, samples, rest, dest, channelCount);
					}
					lastDivision[channel] = division;
					lead = true;
				}
				if (currentDivision !== division) {
					this.initializeWithDegree(info.subbandDegree - division);
					currentDivision = division;
				}
				for (let place = 0; place < divisionCount; place += 1) {
					if (lead) {
						this.decodeLeadBlock(
							this.weightCodes[this.nextWeight] ?? 0,
							this.coefficients[this.nextCoefficient] ?? 0,
						);
						this.nextWeight += 1;
						this.nextCoefficient += 1;
						lead = false;
					} else {
						const samples = Math.min(rest[channel] ?? 0, this.places);
						this.decodeInternalBlock(
							out,
							dest[channel] ?? 0,
							samples,
							this.weightCodes[this.nextWeight] ?? 0,
							this.coefficients[this.nextCoefficient] ?? 0,
						);
						this.nextWeight += 1;
						this.nextCoefficient += 1;
						this.advanceBlock(channel, samples, rest, dest, channelCount);
					}
				}
			}
		}
		if (subbandCount > 0) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				this.lastDctAt = degreeWidth * info.lappedDegree * channel;
				if (currentDivision !== (lastDivision[channel] ?? -1)) {
					this.initializeWithDegree(
						info.subbandDegree - (lastDivision[channel] ?? 0),
					);
					currentDivision = lastDivision[channel] ?? 0;
				}
				const samples = Math.min(rest[channel] ?? 0, this.places);
				this.decodePostBlock(
					out,
					dest[channel] ?? 0,
					samples,
					this.weightCodes[this.nextWeight] ?? 0,
					this.coefficients[this.nextCoefficient] ?? 0,
				);
				this.advanceBlock(channel, samples, rest, dest, channelCount);
			}
		}
		return out;
	}

	/** The counts of the walk of the engine of a count of a picture of the engine, behind the walk of it. */
	private advanceBlock(
		channel: number,
		samples: number,
		rest: Int32Array,
		dest: Int32Array,
		channelCount: number,
	): void {
		this.nextWeight += 1;
		this.nextCoefficient += 1;
		rest[channel] = (rest[channel] ?? 0) - samples;
		dest[channel] = (dest[channel] ?? 0) + samples * channelCount * WORD_PLACES;
	}

	/** `DecodeLeadBlock_MSS`: the places of the first count of a walk of a picture of two colours. */
	decodeLeadBlockMss(
		weightCode: number,
		coefficient: number,
		revCode: number,
	): void {
		const half = Math.trunc(this.places / 2);
		for (let colour = 0; colour < 2; colour += 1) {
			const at = colour * this.places;
			for (let place = 0; place < half; place += 1) {
				this.buffer1[place * 2] = 0;
				this.buffer1[place * 2 + 1] =
					this.buffer2[this.nextSource + place] ?? 0;
			}
			this.nextSource += half;
			this.iQuantumize(
				this.lastDctBuf,
				at,
				this.buffer1,
				0,
				this.places,
				weightCode,
				coefficient,
			);
		}
		revolve2x2(
			this.lastDctBuf,
			0,
			this.lastDctBuf,
			this.places,
			Math.fround(Math.sin((revCode * Math.PI) / 8)),
			Math.fround(Math.cos((revCode * Math.PI) / 8)),
			1,
			this.places,
		);
		for (let colour = 0; colour < 2; colour += 1) {
			const at = colour * this.places;
			oddGivensInverseMatrix(this.lastDctBuf, at, this.revolve, this.degree);
			for (let place = 0; place < this.places; place += 2) {
				this.lastDctBuf[at + place] = this.lastDctBuf[at + place + 1] ?? 0;
			}
			fastIplot(this.lastDctBuf, at, this.degree);
		}
	}

	/** `DecodeInternalBlock_MSS`: the places of a count of the walk of a picture of two colours. */
	decodeInternalBlockMss(
		dst: Uint8Array,
		at: number,
		samples: number,
		weightCode: number,
		coefficient: number,
		revCode: number,
	): void {
		for (let colour = 0; colour < 2; colour += 1) {
			this.iQuantumize(
				this.matrixBuf,
				colour * this.places,
				this.buffer2,
				this.nextSource,
				this.places,
				weightCode,
				coefficient,
			);
			this.nextSource += this.places;
		}
		const first = (revCode >> 2) & 0x03;
		const second = revCode & 0x03;
		revolve2x2(
			this.matrixBuf,
			0,
			this.matrixBuf,
			this.places,
			Math.fround(Math.sin((first * Math.PI) / 8)),
			Math.fround(Math.cos((first * Math.PI) / 8)),
			2,
			Math.trunc(this.places / 2),
		);
		revolve2x2(
			this.matrixBuf,
			1,
			this.matrixBuf,
			this.places + 1,
			Math.fround(Math.sin((second * Math.PI) / 8)),
			Math.fround(Math.cos((second * Math.PI) / 8)),
			2,
			Math.trunc(this.places / 2),
		);
		for (let colour = 0; colour < 2; colour += 1) {
			const from = colour * this.places;
			const lapped = colour * this.places;
			oddGivensInverseMatrix(this.matrixBuf, from, this.revolve, this.degree);
			fastIplot(this.matrixBuf, from, this.degree);
			fastIlot(
				this.workBuf,
				this.lastDctBuf,
				lapped,
				this.matrixBuf,
				from,
				this.degree,
			);
			for (let place = 0; place < this.places; place += 1) {
				this.lastDctBuf[lapped + place] = this.matrixBuf[from + place] ?? 0;
				this.matrixBuf[from + place] = this.workBuf[place] ?? 0;
			}
			fastIdct(
				this.internalBuf,
				0,
				this.matrixBuf,
				from,
				1,
				this.workBuf,
				this.degree,
			);
			if (0 !== samples) {
				roundR32ToWordArray(
					dst,
					at + colour * WORD_PLACES,
					2,
					this.internalBuf,
					samples,
				);
			}
		}
	}

	/** `DecodePostBlock_MSS`: the places of the last count of the walk of a picture of two colours. */
	decodePostBlockMss(
		dst: Uint8Array,
		at: number,
		samples: number,
		weightCode: number,
		coefficient: number,
		revCode: number,
	): void {
		const half = Math.trunc(this.places / 2);
		for (let colour = 0; colour < 2; colour += 1) {
			for (let place = 0; place < half; place += 1) {
				this.buffer1[place * 2] = 0;
				this.buffer1[place * 2 + 1] =
					this.buffer2[this.nextSource + place] ?? 0;
			}
			this.nextSource += half;
			this.iQuantumize(
				this.matrixBuf,
				colour * this.places,
				this.buffer1,
				0,
				this.places,
				weightCode,
				coefficient,
			);
		}
		revolve2x2(
			this.matrixBuf,
			0,
			this.matrixBuf,
			this.places,
			Math.fround(Math.sin((revCode * Math.PI) / 8)),
			Math.fround(Math.cos((revCode * Math.PI) / 8)),
			1,
			this.places,
		);
		for (let colour = 0; colour < 2; colour += 1) {
			const from = colour * this.places;
			const lapped = colour * this.places;
			oddGivensInverseMatrix(this.matrixBuf, from, this.revolve, this.degree);
			for (let place = 0; place < this.places; place += 2) {
				this.matrixBuf[from + place] = -(this.matrixBuf[from + place + 1] ?? 0);
			}
			fastIplot(this.matrixBuf, from, this.degree);
			fastIlot(
				this.workBuf,
				this.lastDctBuf,
				lapped,
				this.matrixBuf,
				from,
				this.degree,
			);
			for (let place = 0; place < this.places; place += 1) {
				this.matrixBuf[from + place] = this.workBuf[place] ?? 0;
			}
			fastIdct(
				this.internalBuf,
				0,
				this.matrixBuf,
				from,
				1,
				this.workBuf,
				this.degree,
			);
			if (0 !== samples) {
				roundR32ToWordArray(
					dst,
					at + colour * WORD_PLACES,
					2,
					this.internalBuf,
					samples,
				);
			}
		}
	}

	/** `DecodeSoundDCT_MSS`: the places of a sound of the engine of two counts of a colour. */
	decodeSoundDctMss(chunk: MioChunk, places: Buffer): Uint8Array {
		const info = this.info;
		const degreeWidth = 1 << info.subbandDegree;
		const subbandCount = Math.trunc(
			(chunk.sampleCount + degreeWidth - 1) / degreeWidth,
		);
		const sampleCount = subbandCount * degreeWidth;
		const channelCount = info.channelCount;
		const allSampleCount = sampleCount * channelCount;
		const blockSize = channelCount * degreeWidth;
		const codeCount = subbandCount * CODE_MARGIN;
		this.matrixBuf = new Float32Array(blockSize);
		this.internalBuf = new Float32Array(blockSize);
		this.workBuf = new Float32Array(degreeWidth);
		this.lastDctBuf = new Float32Array(blockSize * info.lappedDegree);
		this.buffer1 = new Int32Array(blockSize);
		this.buffer2 = new Int32Array(allSampleCount);
		this.weightCodes = new Int32Array(codeCount);
		this.coefficients = new Int32Array(codeCount);
		const revolveCodes = new Uint8Array(codeCount);
		const divisionTable = new Uint8Array(subbandCount);
		if (ARCHITECTURE_RUN_LENGTH_HUFFMAN !== info.architecture) {
			throw unsupportedSound(
				"The places of a sound of the engine stand of the walk of the counts of it of no walk of the engine",
			);
		}
		const context = new ErisaHuffmanDecodeContext(0x10000);
		context.attachInputFile(places);
		context.flushBuffer();
		if (0 !== context.getABit()) {
			throw invalidSound(
				"The walk of the counts of the sound of the engine stands of no count of it",
			);
		}
		let nextDivision = 0;
		let nextRevCode = 0;
		this.nextWeight = 0;
		this.nextCoefficient = 0;
		let lastDivision = -1;
		for (let subband = 0; subband < subbandCount; subband += 1) {
			const division = context.getNBits(DIVISION_BITS);
			divisionTable[nextDivision] = division;
			nextDivision += 1;
			let lead = false;
			if (division !== lastDivision) {
				if (0 !== subband) {
					revolveCodes[nextRevCode] = context.getNBits(DIVISION_BITS);
					nextRevCode += 1;
					this.weightCodes[this.nextWeight] = context.getNBits(32);
					this.nextWeight += 1;
					this.coefficients[this.nextCoefficient] = context.getNBits(16);
					this.nextCoefficient += 1;
				}
				lead = true;
				lastDivision = division;
			}
			const divisionCount = 1 << division;
			for (let place = 0; place < divisionCount; place += 1) {
				if (lead) {
					revolveCodes[nextRevCode] = context.getNBits(DIVISION_BITS);
					lead = false;
				} else {
					// The counts of the walk of the engine of the counts of the walk of a picture of the
					// engine of the count of the walk of the sound of the engine itself stand of the places
					// of the walk of the engine of the count of the walk of the count of the walk of it.
					revolveCodes[nextRevCode] = context.getNBits(REVOLVE_BITS);
				}
				nextRevCode += 1;
				this.weightCodes[this.nextWeight] = context.getNBits(32);
				this.nextWeight += 1;
				this.coefficients[this.nextCoefficient] = context.getNBits(16);
				this.nextCoefficient += 1;
			}
		}
		if (subbandCount > 0) {
			revolveCodes[nextRevCode] = context.getNBits(DIVISION_BITS);
			nextRevCode += 1;
			this.weightCodes[this.nextWeight] = context.getNBits(32);
			this.nextWeight += 1;
			this.coefficients[this.nextCoefficient] = context.getNBits(16);
			this.nextCoefficient += 1;
		}
		if (0 !== context.getABit()) {
			throw invalidSound(
				"The walk of the counts of the sound of the engine stands of no count of it",
			);
		}
		if (0 !== (chunk.flags & MIO_LEAD_BLOCK)) {
			context.prepareToDecodeErinaCode();
		}
		const decoded = new Uint8Array(allSampleCount * WORD_PLACES);
		if (
			context.decodeBytes(decoded, allSampleCount * WORD_PLACES) <
			allSampleCount * WORD_PLACES
		) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		// The places of the walk of the engine stand of the counts of the two counts of a colour of a count
		// of the walk of a picture of the engine, one behind the other.
		let high = 0;
		let low = allSampleCount;
		for (let place = 0; place < degreeWidth * WORD_PLACES; place += 1) {
			let quantumized = place;
			for (let subband = 0; subband < subbandCount; subband += 1) {
				const lowPlace = ((decoded[low] ?? 0) << 24) >> 24;
				const highPlace =
					(((decoded[high] ?? 0) << 24) >> 24) ^ (lowPlace >> 8);
				this.buffer2[quantumized] = (lowPlace & 0xff) | (highPlace << 8);
				quantumized += degreeWidth * WORD_PLACES;
				low += 1;
				high += 1;
			}
		}
		const out = new Uint8Array(chunk.sampleCount * channelCount * WORD_PLACES);
		let rest = chunk.sampleCount;
		let dest = 0;
		nextDivision = 0;
		nextRevCode = 0;
		this.nextWeight = 0;
		this.nextCoefficient = 0;
		this.nextSource = 0;
		lastDivision = -1;
		for (let subband = 0; subband < subbandCount; subband += 1) {
			const division = divisionTable[nextDivision] ?? 0;
			nextDivision += 1;
			const divisionCount = 1 << division;
			this.lastDctAt = 0;
			let lead = false;
			if (lastDivision !== division) {
				if (0 !== subband) {
					const samples = Math.min(rest, this.places);
					this.decodePostBlockMss(
						out,
						dest,
						samples,
						this.weightCodes[this.nextWeight] ?? 0,
						this.coefficients[this.nextCoefficient] ?? 0,
						revolveCodes[nextRevCode] ?? 0,
					);
					nextRevCode += 1;
					this.nextWeight += 1;
					this.nextCoefficient += 1;
					rest -= samples;
					dest += samples * channelCount * WORD_PLACES;
				}
				this.initializeWithDegree(info.subbandDegree - division);
				lastDivision = division;
				lead = true;
			}
			for (let place = 0; place < divisionCount; place += 1) {
				if (lead) {
					this.decodeLeadBlockMss(
						this.weightCodes[this.nextWeight] ?? 0,
						this.coefficients[this.nextCoefficient] ?? 0,
						revolveCodes[nextRevCode] ?? 0,
					);
					nextRevCode += 1;
					this.nextWeight += 1;
					this.nextCoefficient += 1;
					lead = false;
				} else {
					const samples = Math.min(rest, this.places);
					this.decodeInternalBlockMss(
						out,
						dest,
						samples,
						this.weightCodes[this.nextWeight] ?? 0,
						this.coefficients[this.nextCoefficient] ?? 0,
						revolveCodes[nextRevCode] ?? 0,
					);
					nextRevCode += 1;
					this.nextWeight += 1;
					this.nextCoefficient += 1;
					rest -= samples;
					dest += samples * channelCount * WORD_PLACES;
				}
			}
		}
		if (subbandCount > 0) {
			const samples = Math.min(rest, this.places);
			this.decodePostBlockMss(
				out,
				dest,
				samples,
				this.weightCodes[this.nextWeight] ?? 0,
				this.coefficients[this.nextCoefficient] ?? 0,
				revolveCodes[nextRevCode] ?? 0,
			);
			rest -= samples;
		}
		if (0 !== rest) {
			this.initializeWithDegree(0);
		}
		return out;
	}

	/** `DecodeSound`: the places of a sound of the engine, of a count of the walk of it. */
	decodeSound(chunk: MioChunk, places: Buffer): Uint8Array {
		if (TRANSFORMATION_LOSSLESS_ERI === this.info.transformation) {
			return BITS_PER_SAMPLE_8 === this.info.bitsPerSample
				? this.decodeSoundPcm8(chunk, places)
				: this.decodeSoundPcm16(chunk, places);
		}
		if (
			TRANSFORMATION_LOT_ERI === this.info.transformation ||
			CHANNEL_LIMIT !== this.info.channelCount
		) {
			return this.decodeSoundDct(chunk, places);
		}
		return this.decodeSoundDctMss(chunk, places);
	}

	/** `DecodeSoundPCM8`: the places of a sound of eight places of a count of the walk of it. */
	decodeSoundPcm8(chunk: MioChunk, places: Buffer): Uint8Array {
		const channels = this.info.channelCount;
		const samples = chunk.sampleCount;
		const context = new ErisaHuffmanDecodeContext(0x10000);
		context.attachInputFile(places);
		if (0 !== (chunk.flags & MIO_LEAD_BLOCK)) {
			context.prepareToDecodeErinaCode();
		}
		const decoded = new Uint8Array(samples * channels);
		if (context.decodeBytes(decoded, samples * channels) < samples * channels) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		const out = new Uint8Array(samples * channels);
		let from = 0;
		for (let channel = 0; channel < channels; channel += 1) {
			let to = channel;
			let value = 0;
			for (let sample = 0; sample < samples; sample += 1) {
				value = (value + (((decoded[from] ?? 0) << 24) >> 24)) & 0xff;
				out[to] = value;
				from += 1;
				to += channels;
			}
		}
		return out;
	}

	/** `DecodeSoundPCM16`: the places of a sound of sixteen places of a count of the walk of it. */
	decodeSoundPcm16(chunk: MioChunk, places: Buffer): Uint8Array {
		const channels = this.info.channelCount;
		const samples = chunk.sampleCount;
		const count = samples * channels;
		const context = new ErisaHuffmanDecodeContext(0x10000);
		context.attachInputFile(places);
		if (0 !== (chunk.flags & MIO_LEAD_BLOCK)) {
			context.prepareToDecodeErinaCode();
		}
		const decoded = new Uint8Array(count * 2);
		if (context.decodeBytes(decoded, count * 2) < count * 2) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		// The places of the count of the walk of the engine stand of the places of a count of the sound of
		// the engine of the two ways of it: the count of the places of the walk of a count of no sign at all
		// stands of the count of the walk of the count, and the count of the places of the count behind it.
		const folded = new Uint8Array(count * 2);
		for (let channel = 0; channel < channels; channel += 1) {
			const offset = channel * samples * 2;
			for (let sample = 0; sample < samples; sample += 1) {
				const low = ((decoded[offset + samples + sample] ?? 0) << 24) >> 24;
				const high = ((decoded[offset + sample] ?? 0) << 24) >> 24;
				folded[offset + sample * 2] = low & 0xff;
				folded[offset + sample * 2 + 1] = (high ^ (low >> 7)) & 0xff;
			}
		}
		const out = new Uint8Array(count * 2);
		const view = new DataView(folded.buffer, folded.byteOffset, folded.length);
		for (let channel = 0; channel < channels; channel += 1) {
			const offset = channel * samples * 2;
			let to = channel * 2;
			let value = 0;
			let delta = 0;
			for (let sample = 0; sample < samples; sample += 1) {
				delta = (delta + view.getInt16(offset + sample * 2, true)) | 0;
				value = (value + delta) | 0;
				out[to] = value & 0xff;
				out[to + 1] = (value >> 8) & 0xff;
				to += channels * 2;
			}
		}
		return out;
	}
}

/** The places of a sound of the engine, of every count of the walk of it, one behind the other. */
export function decodeMioSound(data: Buffer, layout: MioLayout): Buffer {
	if (ARCHITECTURE_NEMESIS === layout.info.architecture) {
		throw unsupportedSound(
			"The places of a sound of the engine stand of the walk of the Nemesis of it",
		);
	}
	const decoder = new MioDecoder(layout.info);
	const parts: Uint8Array[] = [];
	for (const chunk of layout.chunks) {
		const places = data.subarray(chunk.offset, chunk.offset + chunk.size);
		if (places.length !== chunk.size) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		parts.push(decoder.decodeSound(chunk, places));
	}
	return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const entisMioAudioDescriptor: FormatDescriptor = {
	id: "entis-mio-audio",
	name: "Entis compressed audio",
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
			source: "ArcFormats/Entis/AudioMIO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const entisMioAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: entisMioAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE + SECTION_HEADER_SIZE)) return false;
		try {
			return readMioLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMioLayout(await readStored(source));
		if (!layout) throw invalidSound("Not a sound of the Entis engine");
		const info = layout.info;
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: info.samplesPerSec,
					channels: info.channelCount,
					samples: layout.chunks.reduce(
						(total, chunk) => total + chunk.sampleCount,
						0,
					),
					bitsPerSample: info.bitsPerSample,
					transformation: info.transformation,
					architecture: info.architecture,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression:
					TRANSFORMATION_LOSSLESS_ERI === info.transformation ? "pcm" : "lot",
				sampleRate: info.samplesPerSec,
				channels: info.channelCount,
				bitsPerSample: info.bitsPerSample,
				chunks: layout.chunks.length,
				transformation: info.transformation,
				architecture: info.architecture,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readMioLayout(data);
		if (!layout) throw invalidSound("Not a sound of the Entis engine");
		const pcm = decodeMioSound(data, layout);
		const info = layout.info;
		const blockAlign = (info.channelCount * info.bitsPerSample) / 8;
		return Readable.from([
			writeWave(
				{
					formatTag: 1,
					channels: info.channelCount,
					sampleRate: info.samplesPerSec,
					averageBytesPerSecond: info.samplesPerSec * blockAlign,
					blockAlign,
					bitsPerSample: info.bitsPerSample,
				},
				pcm,
			),
		]);
	},
});
