// Format reference: GARbro ArcFormats/Triangle/ImageTRI.cs, class `TriFormat`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** Match distances are encoded one below their real value. */
const DISTANCE_BIAS = 1;
const DISTANCE_MASK = 0xfff;
/** Copy lengths of fifteen or more are stored in a following byte. */
const LONG_COUNT_BASE = 15;
/** A long-form length byte equal to this value ends the stream. */
const END_OF_STREAM = 0;

/**
 * GARbro `TriFormat.Unpack`. A 32-bit control word is consumed from its high bit: a clear bit reads a
 * literal byte that is exclusive-ored into a running key, and a set bit reads a little-endian word
 * whose low twelve bits are a match distance and whose high four bits plus two are the copy length —
 * a zero high nibble switches to a long form whose length comes from the next byte, biased by the
 * previous key. A long-form length byte that cancels the previous key ends decoding. Copies overlap
 * and always run forward, so this port walks them one byte at a time.
 *
 * The declared output size is allocated up front; when the input ends early, the port keeps the bytes
 * decoded so far and the remaining bytes stay zero, mirroring how other ports of this codec family
 * treat truncated streams.
 */
export function inflateTriLz(input: Uint8Array, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	let sourcePosition = 0;
	let destination = 0;
	let key = 0x7f;
	let previousKey = 0;
	let control = 0;

	const readByte = (): number | undefined => {
		if (sourcePosition >= source.length) return undefined;
		return source[sourcePosition++] ?? 0;
	};

	while (destination < output.length) {
		let bit = control & 0x80000000;
		control = (control << 1) >>> 0;
		if (control === 0) {
			if (sourcePosition + 4 > source.length) break;
			control = source.readUInt32LE(sourcePosition);
			sourcePosition += 4;
			bit = control & 0x80000000;
			control = (control << 1) >>> 0;
		}
		if (bit === 0) {
			const value = readByte();
			if (value === undefined) break;
			previousKey = key;
			key = (key ^ value) & 0xff;
			output[destination++] = key;
			continue;
		}
		if (sourcePosition + 2 > source.length) break;
		let offset = source.readUInt16LE(sourcePosition) + (control >>> 0);
		sourcePosition += 2;
		let count = (offset >> 12) & 0x0f;
		if (count === 0) {
			const value = readByte();
			if (value === undefined) break;
			const lengthByte = (previousKey + value) & 0xff;
			if (lengthByte === END_OF_STREAM) break;
			count = lengthByte + LONG_COUNT_BASE;
		}
		count = Math.min(count + 2, output.length - destination);
		const from = destination - ((offset & DISTANCE_MASK) + DISTANCE_BIAS);
		for (let index = 0; index < count; index += 1) {
			output[destination++] =
				from + index < 0 ? 0 : (output[from + index] ?? 0);
		}
	}
	return output;
}
