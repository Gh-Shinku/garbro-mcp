import { decodeJbpPicture } from "./jbp-reader.js";

const HEADER_SIZE = 0x24;
const INPUT_SIZE_FIELD = 0x04;
const SUB_KIND_FIELD = 0x18;
const KIND_FIELD = 0x1c;
const WIDTH_FIELD = 0x1e;
const HEIGHT_FIELD = 0x20;
const BITS_FIELD = 0x22;
const WALKS_FIELD = 0x2c;
const SECOND_WALKS_FIELD = 0x30;
const JBP_FIELD = 0x34;
const WALK_PLACES = 0x54;
const FRAME_SIZE = 0x800;
const FRAME_MASK = 0x7ff;
const FRAME_START = 0x7de;
const SIDE_PLACES = 16;
const PLACES_PER_ROW = 4;

const NAME_KEY_V6 = [
	0xa6, 0x75, 0xf3, 0x9c, 0xc5, 0x69, 0x78, 0xa3, 0x3e, 0xa5, 0x4f, 0x79, 0x59,
	0xfe, 0x3a, 0xc7,
];
const NAME_FIELD = 0x34;
const NAME_SIZE = 0x20;
const OVERLAY_BITS_FIELD = 0x0c;
const OVERLAY_SIZE_FIELD = 0x18;
const OVERLAY_DATA_FIELD = 0x2c;
const OVERLAY_HEAD_SIZE = 8;
const SIDE_OF_OVERLAY = 8;
const PLACES_PER_OVERLAY_ROW = 4;

export function readPb3V6Name(
	input: Buffer,
	fileLength = input.length,
): string | undefined {
	if (fileLength < NAME_FIELD + NAME_SIZE) return undefined;
	const name: number[] = [];
	for (let at = 0; at < NAME_SIZE; at += 1) {
		const place = (input[NAME_FIELD + at] ?? 0) ^ (NAME_KEY_V6[at & 0xf] ?? 0);
		if (0 === place) break;
		name.push(place);
	}
	return Buffer.from(name).toString("latin1");
}

export interface Pb3BasePicture {
	stride: number;
	pixels: Buffer;
}

export function pb3UnpackV6(
	input: Buffer,
	head: Pb3Head,
	loadBase: (name: string) => Pb3BasePicture | undefined,
): Pb3Picture {
	const name = readPb3V6Name(input, input.length);
	if (undefined === name) {
		throw new RangeError("Purple picture names no picture of its own");
	}
	const base = loadBase(`${name}.pb3`);
	if (!base) {
		throw new RangeError(
			"Purple picture stands without the places of the picture its words name",
		);
	}
	const pixels = Buffer.from(base.pixels);
	const stride = PLACES_PER_ROW * head.width;
	const bitsAt = 0x20 + input.readInt32LE(OVERLAY_BITS_FIELD);
	const dataAt = bitsAt + input.readInt32LE(OVERLAY_DATA_FIELD);
	const overlaySize = input.readInt32LE(OVERLAY_SIZE_FIELD);
	if (overlaySize < 0) {
		throw new RangeError("Purple picture names no places of its own");
	}
	const overlay = new Uint8Array(overlaySize);
	const frame = new Uint8Array(FRAME_SIZE);
	pb3LzssResetFrame(frame);
	pb3LzssUnpack({
		input,
		bitSrc: bitsAt,
		dataSrc: dataAt,
		frame,
		output: overlay,
		outputSize: overlaySize,
	});
	let bitSrc = OVERLAY_HEAD_SIZE;
	let dataSrc = OVERLAY_HEAD_SIZE + (overlay[0] ?? 0);
	let bitMask = 0x80;
	const xBlocks = Math.ceil(head.width / SIDE_OF_OVERLAY);
	const yBlocks = Math.ceil(head.height / SIDE_OF_OVERLAY);
	if (0 === xBlocks) {
		return {
			width: head.width,
			height: head.height,
			bitsPerPixel: head.bitsPerPixel,
			stride,
			pixels,
		};
	}
	let rowDone = 0;
	let origin = 0;
	let rowsLeft = yBlocks;
	while (rowsLeft > 0) {
		let columnDone = 0;
		for (let x = 0; x < xBlocks; x += 1) {
			if (0 === bitMask) {
				bitSrc += 1;
				bitMask = 0x80;
			}
			if (0 === (bitMask & (overlay[bitSrc] ?? 0))) {
				let dst = SIDE_OF_OVERLAY * (origin + PLACES_PER_OVERLAY_ROW * x);
				const xCount = Math.min(SIDE_OF_OVERLAY, head.width - columnDone);
				const yCount = Math.min(SIDE_OF_OVERLAY, head.height - rowDone);
				for (let at = yCount; at > 0; at -= 1) {
					const count = PLACES_PER_OVERLAY_ROW * xCount;
					if (dst + count <= pixels.length) {
						Buffer.from(
							overlay.buffer,
							overlay.byteOffset + dataSrc,
							count,
						).copy(pixels, dst);
					}
					dataSrc += count;
					dst += stride;
				}
			}
			bitMask >>= 1;
			columnDone += SIDE_OF_OVERLAY;
		}
		origin += stride;
		rowDone += SIDE_OF_OVERLAY;
		rowsLeft -= 1;
	}
	return {
		width: head.width,
		height: head.height,
		bitsPerPixel: head.bitsPerPixel,
		stride,
		pixels,
	};
}

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
	pixels: Buffer;
}

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

export function pb3LzssResetFrame(frame: Uint8Array): void {
	for (let at = 0; at < FRAME_START; at += 1) frame[at] = 0;
}

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
