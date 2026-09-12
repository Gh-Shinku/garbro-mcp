import { BufferCursor, GarbroError } from "@garbro-mcp/core";

export function decompressMariel(
	input: Uint8Array,
	unpackedSize: number,
): Buffer {
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Mariel output size is invalid");
	}
	const source = new BufferCursor(input);
	const output = Buffer.alloc(unpackedSize);
	let destination = 0;
	let bits = 0;
	while (destination < output.length) {
		let backReference = (bits & 0x80000000) !== 0;
		bits = (bits << 1) >>> 0;
		if (bits === 0) {
			if (source.remaining < 4) break;
			bits = source.readU32LE();
			backReference = (bits & 0x80000000) !== 0;
			bits = ((bits << 1) | 1) >>> 0;
		}
		if (source.remaining < 1) break;
		const token = source.readU8();
		if (!backReference) {
			output[destination++] = token;
			continue;
		}
		let offset = (token & 0x0f) + 1;
		let count = ((token >>> 4) & 0x0f) + 1;
		if (count === 0x0f) {
			if (source.remaining < 1) break;
			count = source.readU8();
		} else if (count > 0x0f) {
			if (source.remaining < 2) break;
			count = source.readU16LE();
		}
		if (offset >= 0x0b) {
			if (source.remaining < 1) break;
			offset = ((offset - 0x0b) << 8) | source.readU8();
		}
		count = Math.min(count, output.length - destination);
		const copySource = destination - offset;
		if (copySource < 0 || copySource >= destination) break;
		for (let index = 0; index < count; index += 1) {
			output[destination] = output[copySource + index] ?? 0;
			destination += 1;
		}
	}
	return output;
}
