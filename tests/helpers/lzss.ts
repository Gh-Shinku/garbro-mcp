/**
 * Builds a valid GARbro LZSS stream that encodes every byte as a literal. Literal-only streams
 * exercise the decompressor without depending on a compressor implementation.
 */
export function literalLzssStream(
	data: Uint8Array,
	literalBit: 0 | 1 = 1,
): Buffer {
	const chunks: Uint8Array[] = [];
	for (let offset = 0; offset < data.length; offset += 8) {
		const control = Buffer.from([literalBit === 1 ? 0xff : 0x00]);
		chunks.push(control, data.subarray(offset, offset + 8));
	}
	return Buffer.concat(chunks);
}
