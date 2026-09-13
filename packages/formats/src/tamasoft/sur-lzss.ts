// Format-local codec for the TamaSoft SUR and BTN images, transcribed from `SurFormat.UnpackLzss` in
// GARbro "ArcFormats/TamaSoft/ImageSUR.cs". GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT.

/**
 * The only difference from the shared LZSS codec is how a match token names its frame offset. GARbro's usual
 * encoding is `((high & 0xF0) << 4) | low`, taking the low address bits from the low byte; this variant is
 * `(low << 4) | (high >> 4)`, taking the **high** address bits from the low byte and the low four from the high
 * nibble of the second byte. The match length is the same in both. That is what `UnpackLzss`'s comment means by
 * "differs from a common LZSS implementation by frame offset encoding", and it is why the shared codec cannot
 * be reused with settings alone.
 *
 * The reference stops as soon as it has produced the byte count the image needs, and so does this, which also
 * clamps a match that would run past the end. A stream that runs out before that throws, because the reference
 * throws `EndOfStreamException` while reading a control byte or the second byte of a token.
 */
export function unpackSurLzss(input: Buffer, outputLength: number): Buffer {
	const output: Buffer = Buffer.alloc(outputLength);
	const frame: Buffer = Buffer.alloc(0x1000, 0x00);
	const frameMask = 0xfff;
	let framePosition = 0xfee;
	let dst = 0;
	let control = 2;
	let source = 0;
	while (dst < outputLength) {
		control >>= 1;
		if (control === 1) {
			if (source >= input.length)
				throw new Error("Unexpected end of TamaSoft LZSS stream");
			control = (input[source++] ?? 0) | 0x100;
		}
		if ((control & 1) === 1) {
			const value = input[source++] ?? 0;
			frame[framePosition++] = value;
			framePosition &= frameMask;
			output[dst++] = value;
			continue;
		}
		if (source + 2 > input.length)
			throw new Error("Unexpected end of TamaSoft LZSS stream");
		const low = input[source++] ?? 0;
		const high = input[source++] ?? 0;
		let offset = ((low << 4) | (high >> 4)) & frameMask;
		let count = Math.min(3 + (high & 0x0f), outputLength - dst);
		while (count > 0) {
			const value = frame[offset++] ?? 0;
			offset &= frameMask;
			frame[framePosition++] = value;
			framePosition &= frameMask;
			output[dst++] = value;
			count -= 1;
		}
	}
	return output;
}
