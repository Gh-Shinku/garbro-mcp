// Format reference: GARbro ArcFormats/Maika/ArcMK2.cs, class `BprDecompressor`.

const DEFAULT_OUTPUT_LIMIT = 0x40000000;

/** Expands the RLE/literal layer used after MAIKA's BPR01 and BPR02 headers. */
export function inflateMaikaBpr(
	input: Uint8Array,
	rleCode: 1 | 3,
	maxOutputLength = DEFAULT_OUTPUT_LIMIT,
): Buffer {
	if (!Number.isSafeInteger(maxOutputLength) || maxOutputLength < 0)
		throw new RangeError("BPR output limit must be a non-negative integer");
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const chunks: Buffer[] = [];
	let position = 0;
	let outputLength = 0;
	const append = (chunk: Buffer): void => {
		if (chunk.length > maxOutputLength - outputLength)
			throw new RangeError("BPR output exceeds the configured limit");
		chunks.push(chunk);
		outputLength += chunk.length;
	};
	while (position < source.length) {
		const control = source[position++] ?? 0;
		if (control === 0xff) break;
		if (position + 4 > source.length) break;
		const count = source.readInt32LE(position);
		position += 4;
		if (control === rleCode) {
			if (position >= source.length) break;
			const value = source[position++] ?? 0;
			if (count > maxOutputLength - outputLength)
				throw new RangeError("BPR output exceeds the configured limit");
			if (count > 0) append(Buffer.alloc(count, value));
			continue;
		}
		if (count <= 0) continue;
		const available = Math.min(count, source.length - position);
		if (available === 0) break;
		append(source.subarray(position, position + available));
		position += available;
		if (available !== count) break;
	}
	return Buffer.concat(chunks, outputLength);
}
