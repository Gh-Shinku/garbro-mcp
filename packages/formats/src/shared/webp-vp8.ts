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
