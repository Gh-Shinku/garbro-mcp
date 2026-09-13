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
