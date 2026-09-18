// Format reference: GARbro "ArcFormats/CatSystem/ImageHG3.cs", class `HgReader` (the reader the CatSystem
// engine's pictures share: two zlib streams, a walk of alternating runs and literals, and a step applied to
// every byte). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import { inflateZlibBuffer, inflateZlibBufferCapped } from "@garbro-mcp/codecs";

/** A picture this project is willing to hold, past which the reference would run out of memory. */
export const HG_LIMIT = 256 * 1024 * 1024;
/** How deep a run's own length may nest before the reference gives up. */
const COUNT_BIT_LIMIT = 0x20;
/** The smallest stream the control bits may stand in, so that a short one still inflates. */
const MINIMUM_CONTROL_BYTES = 0x1000;

export interface HgGeometry {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The bytes of a pixel, which is the depth over eight. */
	pixelSize: number;
	/** The bytes of a row, which is the width times the pixel. */
	stride: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BitStream`'s least significant bit first reader: the first bit of a byte is its lowest, and a stream that
 * ends is reported as a bit of nothing (`-1`), which is what the reference's own reader answers with.
 */
export class HgBitReader {
	readonly #data: Buffer;
	#position = 0;
	#bits = 0;
	#count = 0;

	constructor(data: Buffer) {
		this.#data = data;
	}

	getBit(): number {
		if (0 === this.#count) {
			if (this.#position >= this.#data.length) return -1;
			this.#bits = this.#data[this.#position] ?? 0;
			this.#position += 1;
			this.#count = 8;
		}
		const value = this.#bits & 1;
		this.#bits >>= 1;
		this.#count -= 1;
		return value;
	}
}

/**
 * `HgReader.GetBitCount`: a run of clear bits says how many bits follow, and a single one says nothing; the
 * value then stands as a leading one with those bits behind it. A run that nests past thirty two bits is
 * refused, as the reference refuses it, and so is a stream that ends inside a run.
 */
export function readHgBitCount(bits: HgBitReader): number {
	let zeros = 0;
	for (;;) {
		const bit = bits.getBit();
		if (bit < 0)
			throw invalidPicture(
				"CatSystem picture is cut short of its control bits",
			);
		if (bit !== 0) break;
		zeros += 1;
		if (zeros >= COUNT_BIT_LIMIT) {
			throw invalidPicture("CatSystem picture nests its runs too deep");
		}
	}
	let value = 1;
	while (zeros > 0) {
		const bit = bits.getBit();
		if (bit < 0)
			throw invalidPicture(
				"CatSystem picture is cut short of its control bits",
			);
		value = (value << 1) | bit;
		zeros -= 1;
	}
	return value;
}

/** `HgReader.ApplyDelta`: the four planes of two bit fields spread into four bytes apiece. */
function buildHgTable(): Uint32Array[] {
	const tables = [
		new Uint32Array(0x100),
		new Uint32Array(0x100),
		new Uint32Array(0x100),
		new Uint32Array(0x100),
	];
	for (let index = 0; index < 0x100; index += 1) {
		let value = index & 0xc0;
		value = ((value << 6) | (index & 0x30)) >>> 0;
		value = ((value << 6) | (index & 0x0c)) >>> 0;
		value = ((value << 6) | (index & 0x03)) >>> 0;
		const table0 = tables[0];
		const table1 = tables[1];
		const table2 = tables[2];
		const table3 = tables[3];
		if (!table0 || !table1 || !table2 || !table3) break;
		table0[index] = (value << 6) >>> 0;
		table1[index] = (value << 4) >>> 0;
		table2[index] = (value << 2) >>> 0;
		table3[index] = value;
	}
	return tables;
}

/** `HgReader.ConvertValue`: the lowest bit says whether the seven above it are the value or its inverse. */
function convertHgValue(value: number): number {
	const carry = 0 !== (value & 1);
	const shifted = value >> 1;
	return (carry ? shifted ^ 0xff : shifted) & 0xff;
}

/**
 * `HgReader.ApplyDelta`: every four bytes of the picture stand as four planes of two bit fields, which are
 * spread over four bytes again by a table; a step is then added to every byte from the one a pixel behind,
 * and another from the byte a row above, so the picture is built from differences.
 */
export function applyHgDelta(pixels: Buffer, geometry: HgGeometry): Buffer {
	if (pixels.length % 4 !== 0) {
		throw invalidPicture(
			"CatSystem picture is not a whole number of four byte planes",
		);
	}
	if (pixels.length !== geometry.stride * geometry.height) {
		throw invalidPicture(
			"CatSystem picture does not match its own measurements",
		);
	}
	const tables = buildHgTable();
	const planeSize = pixels.length >> 2;
	let plane0 = 0;
	let plane1 = plane0 + planeSize;
	let plane2 = plane1 + planeSize;
	let plane3 = plane2 + planeSize;
	const output: Buffer = Buffer.alloc(pixels.length, 0x00);
	let dst = 0;
	while (dst < output.length) {
		const value =
			((tables[0]?.[pixels[plane0] ?? 0] ?? 0) |
				(tables[1]?.[pixels[plane1] ?? 0] ?? 0) |
				(tables[2]?.[pixels[plane2] ?? 0] ?? 0) |
				(tables[3]?.[pixels[plane3] ?? 0] ?? 0)) >>>
			0;
		plane0 += 1;
		plane1 += 1;
		plane2 += 1;
		plane3 += 1;
		output[dst] = convertHgValue(value & 0xff);
		output[dst + 1] = convertHgValue((value >>> 8) & 0xff);
		output[dst + 2] = convertHgValue((value >>> 16) & 0xff);
		output[dst + 3] = convertHgValue((value >>> 24) & 0xff);
		dst += 4;
	}
	for (let x = geometry.pixelSize; x < geometry.stride; x += 1) {
		output[x] =
			((output[x] ?? 0) + (output[x - geometry.pixelSize] ?? 0)) & 0xff;
	}
	let previous = 0;
	for (let y = 1; y < geometry.height; y += 1) {
		const line = previous + geometry.stride;
		for (let x = 0; x < geometry.stride; x += 1) {
			output[line + x] =
				((output[line + x] ?? 0) + (output[previous + x] ?? 0)) & 0xff;
		}
		previous = line;
	}
	return output;
}

/**
 * `HgReader.UnpackStream`: the data stands as a zlib stream of exactly the declared size, and the control
 * bits as another behind it. The first bit says whether the picture begins with a run taken from the data or
 * with one left as it stands, and every run from then on takes the other; a run says its own length with
 * `GetBitCount`, and a run of the data is copied from where the last one ended.
 */
export async function unpackHgStream(
	stored: Buffer,
	dataOffset: number,
	dataPacked: number,
	dataUnpacked: number,
	controlPacked: number,
	geometry: HgGeometry,
): Promise<Buffer> {
	if (
		dataOffset < 0 ||
		dataPacked < 0 ||
		dataUnpacked < 0 ||
		controlPacked < 0 ||
		dataUnpacked > HG_LIMIT
	) {
		throw invalidPicture(
			"CatSystem picture declares a stream of an impossible size",
		);
	}
	const controlOffset = dataOffset + dataPacked;
	if (
		controlOffset + controlPacked > stored.length ||
		dataOffset + dataPacked > stored.length ||
		dataUnpacked !== geometry.stride * geometry.height
	) {
		throw invalidPicture("CatSystem picture is cut short of its streams");
	}
	const data = await inflateZlibBuffer(
		stored.subarray(dataOffset, dataOffset + dataPacked),
		dataUnpacked,
	);
	const control = await inflateZlibBufferCapped(
		stored.subarray(controlOffset, controlOffset + controlPacked),
		Math.max(MINIMUM_CONTROL_BYTES, dataUnpacked + 0x100),
	);
	const bits = new HgBitReader(control);
	let copy = bits.getBit() !== 0;
	const outputSize = readHgBitCount(bits);
	if (outputSize !== dataUnpacked) {
		throw invalidPicture(
			"CatSystem picture does not match its own measurements",
		);
	}
	const output: Buffer = Buffer.alloc(outputSize, 0x00);
	let source = 0;
	let dst = 0;
	while (dst < outputSize) {
		const count = readHgBitCount(bits);
		if (copy) {
			if (source + count > data.length || dst + count > outputSize) {
				throw invalidPicture("CatSystem picture reaches past its own streams");
			}
			data.copy(output, dst, source, source + count);
			source += count;
		}
		dst += count;
		copy = !copy;
	}
	return applyHgDelta(output, geometry);
}

/** The geometry of a picture from its measurements and its depth. */
export function hgGeometry(
	width: number,
	height: number,
	bitsPerPixel: number,
): HgGeometry | undefined {
	if (width === 0 || height === 0) return undefined;
	if (bitsPerPixel !== 24 && bitsPerPixel !== 32) return undefined;
	const pixelSize = bitsPerPixel >> 3;
	const stride = width * pixelSize;
	if (!Number.isSafeInteger(stride) || stride * height > HG_LIMIT) {
		return undefined;
	}
	return { width, height, bitsPerPixel, pixelSize, stride };
}
