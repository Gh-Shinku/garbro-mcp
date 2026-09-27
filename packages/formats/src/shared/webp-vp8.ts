// Reader of the places of the file of the picture of the web of the counts of the places of the file of their own
// (VP8, the picture of the colour of the places of the picture). The reference (GARbro
// `Experimental/WebP/ImageWEBP.cs`) hands the stream to libwebp.dll, which this project does not carry, so this
// module walks the counts of the picture itself. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
// The walk follows the counts of the head of the format of the picture of the web of the library of the picture of
// the web (libwebp) and the counts of the head of the format of the picture of the places of the file of their own
// (the counts of the head of the format of the picture of the web of the places of the file, RFC 6386).
//
// Read here: the count of the head of the picture of the format of the picture of the web (the frame tag, of the
// counts of the head of the picture of the format of the places of the file of their own, the counts of the head of
// the picture of the format, the counts of the places of the file of the picture of the colour of the picture and of
// the colour of the picture of the other, and the counts of the places of the file of the count of the head of the
// format of the picture of the colour of the picture) and the counts of the head of the format of the places of the
// file of the picture of the format (the walk of the counts of the head of the format of the picture of the two
// places of the file). The places of the picture of the colour of the places of the picture stand of no walk of this
// project yet, which the record names.

import { GarbroError } from "@garbro-mcp/core";
import {
	COEFFICIENT_UPDATE_PROBABILITIES,
	DEFAULT_COEFFICIENT_PROBABILITIES,
} from "./webp-vp8-tables.js";

/** The counts of the head of the picture of the format of the picture of the places of the file of their own, of the
 * counts of the head of the picture of the places of the file of the format. */
const START_CODE = [0x9d, 0x01, 0x2a];

/** The counts of the head of the format of the picture of the web of the places of the file of the picture of the
 * format: the count of the head of the picture of the format, the counts of the places of the file of the picture of
 * the colour of the picture and of the colour of the picture of the other, and the places of the file of the count
 * of the head of the format. */
export interface Vp8Frame {
	/** Whether the picture of the format stands of the count of the head of the picture of the format itself, which a
	 * picture of the web of the places of the file of their own always does. */
	keyFrame: boolean;
	/** The counts of the head of the format of the picture of the web of the picture of the format itself. */
	version: number;
	/** Whether the picture stands of the counts of the places of the file of the picture. */
	showFrame: boolean;
	/** The counts of the places of the file of the count of the head of the picture of the format. */
	firstPartSize: number;
	/** The counts of the places of the file of the picture of the colour of the picture. */
	width: number;
	/** The counts of the places of the file of the rows of the picture of the colour of the picture. */
	height: number;
	/** The counts of the places of the file of the picture of the head of the format of the picture of the colour of
	 * the picture, of the counts of the head of the format of the places of the file of the picture of the format. */
	scale: number;
	/** The places of the file of the picture of the format, of the count of the head of the picture of the format. */
	partition: Buffer;
	/** The places of the file of the counts of the head of the picture of the format of the picture of the colour of
	 * the picture (the places of the file of the picture of the format of the picture of the format itself and of the
	 * places of the file of the counts of the head of the format of the picture of the places of the file): the counts
	 * of the head of the format of the picture of the places of the file of the picture of the format stand of the
	 * count of the head of the format of the picture of the format itself of those places of the file. */
	payload: Buffer;
}

/** The counts of the head of the picture of the colour of the places of the picture of the web (VP8), of the counts
 * of the places of the file of the picture of the colour of the picture. */
export function readVp8FrameHeader(payload: Buffer): Vp8Frame {
	if (payload.length < 10)
		throw invalid(
			"The picture of the web of the colour of the places of the picture stands short of its head",
		);
	const tag =
		(payload[0] ?? 0) | ((payload[1] ?? 0) << 8) | ((payload[2] ?? 0) << 16);
	const keyFrame = 0 === (tag & 1);
	if (!keyFrame)
		throw invalid(
			"The picture of the web of the colour of the places of the picture stands of no count of the head of the picture of the picture of the web",
		);
	if (
		START_CODE[0] !== payload[3] ||
		START_CODE[1] !== payload[4] ||
		START_CODE[2] !== payload[5]
	)
		throw invalid(
			"The picture of the web of the colour of the places of the picture stands of no counts of the head of the format of the picture of the places of the file",
		);
	const width = ((payload[6] ?? 0) | ((payload[7] ?? 0) << 8)) & 0x3fff;
	const height = ((payload[8] ?? 0) | ((payload[9] ?? 0) << 8)) & 0x3fff;
	const scale =
		(((payload[7] ?? 0) >> 6) & 3) | ((((payload[9] ?? 0) >> 6) & 3) << 2);
	if (0 === width || 0 === height)
		throw invalid(
			"The picture of the web of the colour of the places of the picture names no places of the file of the picture",
		);
	// A picture of the web stands of the counts of the places of the file of the picture itself: the counts of the
	// head of the picture of the head of the format of the picture of the colour of the picture stand of no picture
	// of the web (RFC 9649, the counts of the head of the format of the picture of the colour of the picture of the
	// places of the file of the picture of the format itself).
	if (0 !== scale)
		throw unsupported(
			"A picture of the web of the colour of the places of the picture whose counts of the head of the picture of the colour of the picture stand of counts of their own stands of no walk of this project",
		);
	const firstPartSize = tag >> 5;
	if (10 + firstPartSize > payload.length)
		throw invalid(
			"A count of the head of the picture of the format stands beyond the places of the file of the picture",
		);
	return {
		keyFrame,
		version: (tag >> 1) & 7,
		showFrame: 0 !== ((tag >> 4) & 1),
		firstPartSize,
		width,
		height,
		scale,
		partition: payload.subarray(10, 10 + firstPartSize),
		payload: payload.subarray(10),
	};
}

/** The counts of the places of the file of the picture of the format of the picture of the web of the colour of the
 * places of the picture, of the counts of the head of the format of the picture of the places of the file of their own
 * (the walk of the counts of the head of the format of the picture of the two places of the file). The walk of this
 * project stands of the counts of the head of the format itself: the counts of the head of the path of the two places
 * of the file of the format of the picture of the web (RFC 6386, the walk of the counts of the head of the format of
 * the picture of the format). */
export class Vp8BooleanDecoder {
	private range = 255;

	private value = 0;

	private bits = 0;

	private at = 0;

	constructor(private readonly data: Buffer) {
		this.value = (this.data[this.at] ?? 0) << 8;
		this.at += 1;
		this.value |= this.data[this.at] ?? 0;
		this.at += 1;
		this.bits = 8;
	}

	/** The counts of the head of the picture of the colour of the picture of the counts of the head of the format of
	 * the picture of the two places of the file, of the counts of the places of the file of the picture of the colour
	 * of the picture of the count of the head. */
	read(probability: number): number {
		const split = 1 + (((this.range - 1) * probability) >> 8);
		const held = this.value;
		const bit = held < split << 8 ? 0 : 1;
		if (0 === bit) this.range = split;
		else {
			this.range -= split;
			this.value = held - (split << 8);
		}
		while (this.range < 128) {
			this.range <<= 1;
			this.value <<= 1;
			this.bits -= 1;
			if (0 === this.bits) {
				this.value |= this.data[this.at] ?? 0;
				this.at += 1;
				this.bits = 8;
			}
		}
		return bit;
	}

	/** The counts of the places of the file of the picture of the colour of the picture of the count of the head of
	 * the format of the picture of the two places of the file, of the counts of the places of the file of the count of
	 * the head of the picture of the format. */
	readLiteral(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1)
			value = (value << 1) | this.read(128);
		return value;
	}

	/** The counts of the places of the file of the picture of the colour of the picture of the count of the head of
	 * the format of the picture of the two places of the file, of the counts of the places of the file of the picture
	 * of the colour of the picture, of the counts of the head of the format of the picture of the two places of the
	 * file of the picture of the format. */
	readSignedLiteral(count: number): number {
		const value = this.readLiteral(count);
		return 0 === this.read(128) ? value : -value;
	}

	/** The counts of the places of the file of the picture of the format the walk of the counts of the head of the
	 * format of the picture of the two places of the file has walked. */
	get walked(): number {
		return this.at * 8 - this.bits;
	}
}

/** The counts of the head of the format of the picture of the web of the colour of the places of the picture that
 * stand of no counts of the head of the format of the picture of the picture of the web itself. */
function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The counts of the head of the format of the picture of the web of the colour of the places of the picture that
 * stand beyond the counts of the head of the format of the picture of the places of the file of their own the walk of
 * this project reads. */
function unsupported(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** The counts of the head of the format of the picture of the places of the file of the picture of the format
 * itself. */
export const SEGMENT_COUNT = 4;
const REFERENCE_DELTA_COUNT = 4;
const MODE_DELTA_COUNT = 4;
const SEGMENT_TREE_PROBABILITY_COUNT = 3;
const COEFFICIENT_TYPES = 4;
const COEFFICIENT_BAND_COUNT = 8;
const COEFFICIENT_CONTEXT_COUNT = 3;
const COEFFICIENT_PROBABILITY_COUNT = 11;

/** The counts of the head of the format of the picture of the places of the file of the colour of the picture of a
 * count of the head of the format of the picture of the format of four places of the file square. */
export interface Vp8Segmentation {
	/** Whether the picture of the format itself stands of the counts of the head of the format of the places of the
	 * file of the colour of the picture. */
	readonly use: boolean;
	/** Whether every place of the file of the picture of the format of four places of the file square carries a count
	 * of the head of the format of the picture of the places of the file. */
	readonly updateMap: boolean;
	/** Whether the counts of the head of the format of the picture of the places of the file stand of their own in
	 * place of standing of no count of the head of the format of the picture of the format itself. */
	readonly absolute: boolean;
	/** The counts of the head of the format of the picture of the counts of the head of the picture of the format of
	 * the places of the file, one a count of the head of the format of the picture of the places of the file. */
	readonly quantisers: readonly number[];
	/** The counts of the head of the format of the picture of the walk of the places of the file of the picture of
	 * the format, one a count of the head of the format of the picture of the places of the file. */
	readonly filterStrengths: readonly number[];
	/** The counts of the head of the format of the picture of the two places of the file of the walk of the count of
	 * the head of the format of the picture of the places of the file. */
	readonly treeProbabilities: readonly number[];
}

/** The counts of the head of the format of the picture of the walk of the picture of the format itself. */
export interface Vp8FilterHeader {
	/** Whether the simple walk of the places of the file stands of the count of the head of the format itself. */
	readonly simple: boolean;
	readonly level: number;
	readonly sharpness: number;
	readonly referenceDeltas: readonly number[];
	readonly modeDeltas: readonly number[];
}

/** The counts of the head of the format of the picture of the colours of the picture of the format of the picture of
 * the places of the file of the picture of the format. */
export interface Vp8Quantiser {
	readonly base: number;
	readonly y1dc: number;
	readonly y2dc: number;
	readonly y2ac: number;
	readonly uvdc: number;
	readonly uvac: number;
}

/** The counts of the head of the format of the picture of the places of the file of the first partition of the
 * picture of the format of the web of the colour of the places of the picture. */
export interface Vp8PartitionHeader {
	readonly colourSpace: number;
	readonly clampType: number;
	readonly segmentation: Vp8Segmentation;
	readonly filter: Vp8FilterHeader;
	/** The count of the counts of the head of the format of the picture of the colours of the picture: 1, 2, 4 or 8. */
	readonly tokenPartitions: number;
	readonly quantiser: Vp8Quantiser;
	readonly refreshEntropy: boolean;
	/** The counts of the head of the format of the picture of the two places of the file of the walk of the counts of
	 * the head of the format of the picture of the places of the file, of a count of the head of the format: the kind
	 * of the counts of the head of the format, the count of the head of the format, the count of the head of the
	 * picture of the format and the count of the head of the format of the two places of the file. */
	readonly probabilities: Uint8Array;
	readonly useSkipProbability: boolean;
	readonly skipProbability: number;
	/** The count of the counts of the head of the format of the picture of the places of the file of the first
	 * partition which the walk of this project walked. */
	readonly walked: number;
}

/** Reads the counts of the head of the format of the picture of the places of the file of the first partition of a
 * picture of the format of the web of the colour of the places of the picture. The walk stands of the walk of the
 * library of the picture of the web (`src/dec/vp8_dec.c`, `src/dec/quant_dec.c`, `src/dec/tree_dec.c`: the counts of
 * the head of the format of the picture of the places of the file of the two places of the file of the picture of the
 * format itself, of the counts of the head of the format of the picture of the places of the file of the colour of
 * the picture, of the walk of the places of the file of the picture of the format and of the counts of the head of
 * the picture of the format of the places of the file of the picture).
 *
 * A picture of the format whose places of the file stand of the counts of the head of the format of the picture of
 * the two places of the file beyond the count of the head of the format itself stands of no walk of this project
 * (the counts of the head of the format of the picture of the places of the file of the picture of the format stand
 * of the count of the head of the format of the picture of the format of four places of the file square alone). */
export function readVp8PartitionHeader(partition: Buffer): Vp8PartitionHeader {
	const decoder = new Vp8BooleanDecoder(partition);
	const colourSpace = decoder.read(128);
	const clampType = decoder.read(128);

	const useSegmentation = 1 === decoder.read(128);
	let updateMap = false;
	let absolute = true;
	let quantisers: number[] = [0, 0, 0, 0];
	let filterStrengths: number[] = [0, 0, 0, 0];
	let treeProbabilities: number[] = [255, 255, 255];
	if (useSegmentation) {
		updateMap = 1 === decoder.read(128);
		if (1 === decoder.read(128)) {
			absolute = 1 === decoder.read(128);
			quantisers = [];
			for (let segment = 0; segment < SEGMENT_COUNT; segment += 1)
				quantisers.push(
					1 === decoder.read(128) ? decoder.readSignedLiteral(7) : 0,
				);
			filterStrengths = [];
			for (let segment = 0; segment < SEGMENT_COUNT; segment += 1)
				filterStrengths.push(
					1 === decoder.read(128) ? decoder.readSignedLiteral(6) : 0,
				);
		}
		if (updateMap) {
			treeProbabilities = [];
			for (
				let probability = 0;
				probability < SEGMENT_TREE_PROBABILITY_COUNT;
				probability += 1
			)
				treeProbabilities.push(
					1 === decoder.read(128) ? decoder.readLiteral(8) : 255,
				);
		}
	}

	const simple = 1 === decoder.read(128);
	const level = decoder.readLiteral(6);
	const sharpness = decoder.readLiteral(3);
	const referenceDeltas = [0, 0, 0, 0];
	const modeDeltas = [0, 0, 0, 0];
	if (1 === decoder.read(128)) {
		if (1 === decoder.read(128)) {
			for (let i = 0; i < REFERENCE_DELTA_COUNT; i += 1)
				if (1 === decoder.read(128))
					referenceDeltas[i] = decoder.readSignedLiteral(6);
			for (let i = 0; i < MODE_DELTA_COUNT; i += 1)
				if (1 === decoder.read(128))
					modeDeltas[i] = decoder.readSignedLiteral(6);
		}
	}

	const tokenPartitions = 1 << decoder.readLiteral(2);

	const base = decoder.readLiteral(7);
	const quantiser: Vp8Quantiser = {
		base,
		y1dc: 1 === decoder.read(128) ? decoder.readSignedLiteral(4) : 0,
		y2dc: 1 === decoder.read(128) ? decoder.readSignedLiteral(4) : 0,
		y2ac: 1 === decoder.read(128) ? decoder.readSignedLiteral(4) : 0,
		uvdc: 1 === decoder.read(128) ? decoder.readSignedLiteral(4) : 0,
		uvac: 1 === decoder.read(128) ? decoder.readSignedLiteral(4) : 0,
	};

	const refreshEntropy = 1 === decoder.read(128);

	const probabilities = new Uint8Array(
		COEFFICIENT_TYPES *
			COEFFICIENT_BAND_COUNT *
			COEFFICIENT_CONTEXT_COUNT *
			COEFFICIENT_PROBABILITY_COUNT,
	);
	let at = 0;
	for (let type = 0; type < COEFFICIENT_TYPES; type += 1)
		for (let band = 0; band < COEFFICIENT_BAND_COUNT; band += 1)
			for (let context = 0; context < COEFFICIENT_CONTEXT_COUNT; context += 1)
				for (
					let probability = 0;
					probability < COEFFICIENT_PROBABILITY_COUNT;
					probability += 1
				) {
					const index = at;
					at += 1;
					probabilities[index] =
						1 === decoder.read(COEFFICIENT_UPDATE_PROBABILITIES[index] ?? 255)
							? decoder.readLiteral(8)
							: (DEFAULT_COEFFICIENT_PROBABILITIES[index] ?? 128);
				}

	const useSkipProbability = 1 === decoder.read(128);
	const skipProbability = useSkipProbability ? decoder.readLiteral(8) : 128;

	const walked = decoder.walked;
	if (walked > partition.length * 8)
		throw invalid(
			"The places of the file of the picture of the format of the web of the colour of the places of the picture stand of counts of their own",
		);
	return {
		colourSpace,
		clampType,
		segmentation: {
			use: useSegmentation,
			updateMap,
			absolute,
			quantisers,
			filterStrengths,
			treeProbabilities,
		},
		filter: { simple, level, sharpness, referenceDeltas, modeDeltas },
		tokenPartitions,
		quantiser,
		refreshEntropy,
		probabilities,
		useSkipProbability,
		skipProbability,
		walked,
	};
}
