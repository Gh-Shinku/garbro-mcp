import {
	createInflate,
	createInflateRaw,
	inflate,
	inflateRaw,
} from "node:zlib";
import type { Readable } from "node:stream";

export function createZlibInflateStream(input: Readable): Readable {
	return input.pipe(createInflate());
}

export async function inflateZlibBuffer(
	input: Uint8Array,
	expectedLength?: number,
): Promise<Buffer> {
	const output = await new Promise<Buffer>((resolve, reject) => {
		const options =
			expectedLength === undefined ? {} : { maxOutputLength: expectedLength };
		inflate(input, options, (error, result) => {
			if (error) reject(error);
			else resolve(result);
		});
	});
	if (expectedLength !== undefined && output.length !== expectedLength) {
		throw new Error(
			`Zlib output size mismatch: expected ${expectedLength} bytes, got ${output.length}`,
		);
	}
	return output;
}
/**
 * Decompresses a zlib stream with an upper bound on the output. Unlike `inflateZlibBuffer`, the bound is a
 * cap rather than an expectation: streams that hold less than `maxOutputLength` are returned as they are,
 * while anything larger fails instead of allocating. The formats that have to decompress during detection
 * and do not know the unpacked size use this.
 */
export async function inflateZlibBufferCapped(
	input: Uint8Array,
	maxOutputLength: number,
): Promise<Buffer> {
	return new Promise<Buffer>((resolve, reject) => {
		inflate(input, { maxOutputLength }, (error, result) => {
			if (error) reject(error);
			else resolve(result);
		});
	});
}

export function createRawInflateStream(input: Readable): Readable {
	return input.pipe(createInflateRaw());
}

export async function inflateRawBuffer(input: Uint8Array): Promise<Buffer> {
	return await new Promise<Buffer>((resolve, reject) => {
		inflateRaw(input, (error, result) => {
			if (error) reject(error);
			else resolve(result);
		});
	});
}
