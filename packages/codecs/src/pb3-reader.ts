// Format reference: GARbro "ArcFormats/Cmvs/ImagePB3.cs", classes `Pb3Format`, `PbReaderBase` and `Pb3Reader`
// — the walk of the places of a picture of the Purple engine that stands as the places of the picture itself.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeJbpPicture } from "./jbp-reader.js";

/** Where the words of the head of a picture of this kind stand. */
const HEADER_SIZE = 0x24;
const INPUT_SIZE_FIELD = 0x04;
const SUB_KIND_FIELD = 0x18;
const KIND_FIELD = 0x1c;
const WIDTH_FIELD = 0x1e;
const HEIGHT_FIELD = 0x20;
const BITS_FIELD = 0x22;
/** Where the places of the walks of the places of a picture stand, and how many places of a picture stand in
 * every place of the walk of its places. */
const WALKS_FIELD = 0x2c;
const SECOND_WALKS_FIELD = 0x30;
const JBP_FIELD = 0x34;
const WALK_PLACES = 0x54;
/** The places of the walk of the places of a picture of this kind stand in a frame of places of their own,
 * the places of the walk standing behind the places of the picture that stand before them. */
const FRAME_SIZE = 0x800;
const FRAME_MASK = 0x7ff;
const FRAME_START = 0x7de;
/** How many places of the picture the places of the walk of the places of a colour stand in. */
const SIDE_PLACES = 16;
const PLACES_PER_ROW = 4;

export interface Pb3Head {
	inputSize: number;
	kind: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	subKind: number;
}

export interface Pb3Picture {
	width: number;
	height: number;
	bitsPerPixel: number;
	stride: number;
	/** The places of the picture, which stand as the places of four colours apiece. */
	pixels: Buffer;
}

/** `Pb3Format.ReadMetaData`: the words of the head of a picture of this kind name how many places of the file
 * the picture stands in, the kind and the underkind of the picture, how wide and how tall it stands, and how
 * many places a place of it stands in. */
export function readPb3Head(
	data: Buffer,
	fileLength = data.length,
): Pb3Head | undefined {
	if (fileLength < HEADER_SIZE || data.length < HEADER_SIZE) return undefined;
	return {
		inputSize: data.readInt32LE(INPUT_SIZE_FIELD),
		subKind: data.readInt32LE(SUB_KIND_FIELD),
		kind: data.readUInt16LE(KIND_FIELD),
		width: data.readUInt16LE(WIDTH_FIELD),
		height: data.readUInt16LE(HEIGHT_FIELD),
		bitsPerPixel: data.readUInt16LE(BITS_FIELD),
	};
}

/** `PbReaderBase.LzssUnpack`: the places of a picture of this kind stand as a walk of their own, every step of
 * it standing as a place of the picture that stands as it stands, or as a place that stands as many places of
 * the picture beside the places that stand behind it. */
export function pb3LzssUnpack(options: {
	input: Buffer;
	bitSrc: number;
	dataSrc: number;
	frame: Uint8Array;
	output: Uint8Array;
	outputSize: number;
}): void {
	const { input, frame, output, outputSize } = options;
	let bitSrc = options.bitSrc;
	let dataSrc = options.dataSrc;
	let dst = 0;
	let bitMask = 0x80;
	let frameOffset = FRAME_START;
	while (dst < outputSize) {
		if (0 === bitMask) {
			bitMask = 0x80;
			bitSrc += 1;
		}
		if (0 !== (bitMask & (input[bitSrc] ?? 0))) {
			const value = input.readUInt16LE(dataSrc);
			dataSrc += 2;
			const count = (value & 0x1f) + 3;
			const offset = value >> 5;
			for (let at = 0; at < count; at += 1) {
				const place = frame[(at + offset) & FRAME_MASK] ?? 0;
				if (dst < output.length) output[dst] = place;
				dst += 1;
				frame[frameOffset] = place;
				frameOffset = (frameOffset + 1) & FRAME_MASK;
			}
		} else {
			const place = input[dataSrc] ?? 0;
			dataSrc += 1;
			if (dst < output.length) output[dst] = place;
			dst += 1;
			frame[frameOffset] = place;
			frameOffset = (frameOffset + 1) & FRAME_MASK;
		}
		bitMask >>= 1;
	}
}

/** `PbReaderBase.LzssResetFrame`: the places of the walk of the places of a colour stand as nothing before
 * every walk of the places of a colour of its own. */
export function pb3LzssResetFrame(frame: Uint8Array): void {
	for (let at = 0; at < FRAME_START; at += 1) frame[at] = 0;
}

/** `PbReaderBase.UnpackJbp`: the places of a picture of this kind stand as the places of a picture of the
 * Purple engine that stands within them, whose places stand as the places of the picture itself. */
export function pb3UnpackJbp(
	input: Buffer,
	head: Pb3Head,
	jbpPos: number,
	alphaPos: number,
): Pb3Picture {
	const jbp = decodeJbpPicture(input, jbpPos);
	const stride = PLACES_PER_ROW * head.width;
	const pixels = Buffer.from(jbp.pixels);
	if (stride !== jbp.stride) {
		// The places of the walk of the places of the picture stand as the places of the picture that stand
		// beside the places of the walk of its places, so the places of the picture stand as the places of the
		// walk of its places that stand for them.
		for (let y = 1; y < head.height; y += 1) {
			const from = y * jbp.stride;
			const to = y * stride;
			if (to + stride > pixels.length) break;
			pixels.copy(pixels, to, from, from + Math.min(stride, jbp.stride));
		}
	}
	if (32 === head.bitsPerPixel && alphaPos > 0) {
		let dst = 3;
		let at = alphaPos;
		const end = stride * head.height;
		while (dst < end && at < input.length) {
			const alpha = input[at] ?? 0;
			at += 1;
			if (0 !== alpha && 0xff !== alpha) {
				pixels[dst] = alpha;
				dst += PLACES_PER_ROW;
			} else {
				let count = input[at] ?? 0;
				at += 1;
				while (count > 0) {
					pixels[dst] = alpha;
					dst += PLACES_PER_ROW;
					count -= 1;
				}
			}
		}
	}
	return {
		width: head.width,
		height: head.height,
		bitsPerPixel: head.bitsPerPixel,
		stride,
		pixels,
	};
}

/** `Pb3Reader.UnpackV1`: the places of a colour of a picture of this kind stand as a walk of their own, and
 * the places of the picture stand as the places of the walk that stand for them, every place of the walk of
 * the places of the picture standing as the places of the picture of a place of the walk of its places. */
export function pb3UnpackV1(input: Buffer, head: Pb3Head): Pb3Picture {
	const width = head.width;
	const height = head.height;
	const stride = PLACES_PER_ROW * width;
	const channels = head.bitsPerPixel >> 3;
	const pixels = Buffer.alloc(stride * height, 0x00);
	const xBlocks = Math.ceil(width / SIDE_PLACES);
	const yBlocks = Math.ceil(height / SIDE_PLACES);
	const plane = new Uint8Array(width * height);
	const data1 = input.readInt32LE(WALKS_FIELD);
	const data2 = input.readInt32LE(SECOND_WALKS_FIELD);
	const frame = new Uint8Array(FRAME_SIZE);
	for (let channel = 0; channel < channels; channel += 1) {
		let offset = PLACES_PER_ROW * channels;
		for (let at = 0; at < channel; at += 1) {
			offset += input.readInt32LE(data1 + at * PLACES_PER_ROW);
		}
		const walksAt = data1 + offset;
		let bitSrc =
			walksAt +
			12 +
			input.readInt32LE(walksAt) +
			input.readInt32LE(walksAt + PLACES_PER_ROW);
		const channelSize = input.readInt32LE(walksAt + 8);
		offset = PLACES_PER_ROW * channels;
		for (let at = 0; at < channel; at += 1) {
			offset += input.readInt32LE(data2 + at * PLACES_PER_ROW);
		}
		const dataSrc = data2 + offset;
		pb3LzssResetFrame(frame);
		pb3LzssUnpack({
			input,
			bitSrc,
			dataSrc,
			frame,
			output: plane,
			outputSize: channelSize,
		});
		if (0 === yBlocks || 0 === xBlocks) continue;
		let planeSrc = 0;
		bitSrc = walksAt + 12;
		let bitMask = 0x80;
		let placeSrc = bitSrc + input.readInt32LE(walksAt);
		let rowsDone = SIDE_PLACES;
		for (let y = 0; y < yBlocks; y += 1) {
			const row = SIDE_PLACES * y;
			let columnsDone = SIDE_PLACES;
			let origin = stride * row + channel;
			for (let x = 0; x < xBlocks; x += 1) {
				let dst = origin;
				const blockWidth =
					columnsDone > width ? width - SIDE_PLACES * x : SIDE_PLACES;
				const blockHeight = rowsDone > height ? height - row : SIDE_PLACES;
				if (0 === bitMask) {
					bitSrc += 1;
					bitMask = 0x80;
				}
				if (0 !== (bitMask & (input[bitSrc] ?? 0))) {
					const place = input[placeSrc] ?? 0;
					placeSrc += 1;
					for (let j = 0; j < blockHeight; j += 1) {
						let at = dst;
						for (let i = 0; i < blockWidth; i += 1) {
							if (at < pixels.length) pixels[at] = place;
							at += PLACES_PER_ROW;
						}
						dst += stride;
					}
				} else {
					for (let j = 0; j < blockHeight; j += 1) {
						let at = dst;
						for (let i = 0; i < blockWidth; i += 1) {
							if (at < pixels.length) pixels[at] = plane[planeSrc] ?? 0;
							planeSrc += 1;
							at += PLACES_PER_ROW;
						}
						dst += stride;
					}
				}
				bitMask >>= 1;
				columnsDone += SIDE_PLACES;
				origin += SIDE_PLACES * PLACES_PER_ROW;
			}
			rowsDone += SIDE_PLACES;
		}
	}
	return {
		width,
		height,
		bitsPerPixel: head.bitsPerPixel,
		stride,
		pixels,
	};
}

/** `Pb3Reader.UnpackV5`: the places of every colour of a picture of this kind stand as a walk of their own,
 * every place of the walk standing for the place of the picture that stands beside the place before it. */
export function pb3UnpackV5(input: Buffer, head: Pb3Head): Pb3Picture {
	const stride = PLACES_PER_ROW * head.width;
	const pixels = Buffer.alloc(stride * head.height, 0x00);
	const frame = new Uint8Array(FRAME_SIZE);
	for (let channel = 0; channel < 4; channel += 1) {
		let bitSrc = WALK_PLACES + input.readInt32LE(8 * channel + JBP_FIELD);
		let dataSrc = WALK_PLACES + input.readInt32LE(8 * channel + JBP_FIELD + 4);
		pb3LzssResetFrame(frame);
		let frameOffset = FRAME_START;
		let accumulated = 0;
		let bitMask = 0x80;
		let dst = channel;
		while (dst < pixels.length) {
			if (0 === bitMask) {
				bitSrc += 1;
				bitMask = 0x80;
			}
			if (0 !== (bitMask & (input[bitSrc] ?? 0))) {
				const value = input.readUInt16LE(dataSrc);
				dataSrc += 2;
				const count = (value & 0x1f) + 3;
				const offset = value >> 5;
				for (let at = 0; at < count; at += 1) {
					const place = frame[(at + offset) & FRAME_MASK] ?? 0;
					frame[frameOffset] = place;
					frameOffset = (frameOffset + 1) & FRAME_MASK;
					accumulated = (accumulated + place) & 0xff;
					if (dst < pixels.length) pixels[dst] = accumulated;
					dst += PLACES_PER_ROW;
				}
			} else {
				const place = input[dataSrc] ?? 0;
				dataSrc += 1;
				frame[frameOffset] = place;
				frameOffset = (frameOffset + 1) & FRAME_MASK;
				accumulated = (accumulated + place) & 0xff;
				if (dst < pixels.length) pixels[dst] = accumulated;
				dst += PLACES_PER_ROW;
			}
			bitMask >>= 1;
		}
	}
	return {
		width: head.width,
		height: head.height,
		bitsPerPixel: head.bitsPerPixel,
		stride,
		pixels,
	};
}
