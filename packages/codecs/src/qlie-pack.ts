// Format reference: GARBro ArcFormats/Qlie/ArcQLIE.cs, `PackOpener.Decompress`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** Compressed blocks begin with the bytes `1PC\xFF`, which read as a word give this value. */
const PACK_MARKER = 0xff_43_50_31;
const MARKER_OFFSET = 0;
/** The word behind the marker carries flags in its low bit. */
const FLAG_OFFSET = 4;
/** Sixteen-bit token counts are selected by the flag's low bit. */
const FLAG_SIXTEEN_BIT = 1;
const OUTPUT_LENGTH_OFFSET = 8;
/** The first block's data begins behind the marker, the flags and the output length. */
const DATA_OFFSET = 12;
/** The alphabet table has one slot per byte value. */
const SLOT_COUNT = 0x100;
/** A table byte above this value skips slots instead of filling them. */
const SKIP_THRESHOLD = 127;
/** A skip byte's step is its value minus this constant. */
const SKIP_BIAS = 127;
const WORD_SIZE = 4;
const HALF_WORD_SIZE = 2;

/**
 * GARBro `PackOpener.Decompress`. A stream that does not begin with the `1PC\xFF` marker yields nothing, and the
 * low bit of the word at 4 selects whether block token counts are sixteen or thirty-two bits wide; the output
 * length sits at 8 and every block follows at 12.
 *
 * Each block first rebuilds a 256-slot alphabet table. A table byte counts the slots it fills, and a value above
 * 127 is a skip instead: its step is the byte minus 127 slots, which is how runs of unchanged slots are encoded.
 * A slot whose stored value differs from its own index is an internal node and takes one more byte, holding its
 * second child; the first child is the stored value itself. The block then reads a token count and that many
 * tokens.
 *
 * Decoding a token walks the table: a slot that still holds its own index emits it literally, while any other
 * slot pushes its two children onto a stack, the stored value first so it is visited first. The stack is reset
 * per block but its buffer is not, exactly as in the reference.
 *
 * The reference writes output without checking its length and simply fails if the result does not fill it
 * exactly. The port stops at that length instead of overrunning and reports the same failure through a throw.
 */
export function decompressQliePack(input: Uint8Array): Buffer {
	const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	if (data.length < DATA_OFFSET) {
		throw new RangeError("QLIE stream is truncated");
	}
	if (data.readUInt32LE(MARKER_OFFSET) !== PACK_MARKER) {
		throw new RangeError("QLIE stream has no marker");
	}
	const sixteenBit = (data[FLAG_OFFSET] ?? 0) & FLAG_SIXTEEN_BIT;
	const outputLength = data.readInt32LE(OUTPUT_LENGTH_OFFSET);
	if (outputLength < 0) throw new RangeError("QLIE output length is invalid");
	const output = Buffer.alloc(outputLength);

	const firstChild = Buffer.alloc(SLOT_COUNT);
	const secondChild = Buffer.alloc(SLOT_COUNT);
	const stack = Buffer.alloc(SLOT_COUNT);

	let source = DATA_OFFSET;
	let destination = 0;
	while (source < data.length) {
		for (let slot = 0; slot < SLOT_COUNT; slot += 1) firstChild[slot] = slot;
		let slot = 0;
		while (slot < SLOT_COUNT) {
			if (source >= data.length) break;
			let count = data[source++] ?? 0;
			if (count > SKIP_THRESHOLD) {
				slot += count - SKIP_BIAS;
				count = 0;
			}
			if (slot > SLOT_COUNT - 1) break;
			count += 1;
			for (let index = 0; index < count && slot < SLOT_COUNT; index += 1) {
				if (source >= data.length) break;
				const value = data[source++] ?? 0;
				firstChild[slot] = value;
				if (value !== slot) {
					if (source >= data.length) break;
					secondChild[slot] = data[source++] ?? 0;
				}
				slot += 1;
			}
		}

		let tokens: number;
		if (sixteenBit !== 0) {
			if (source + HALF_WORD_SIZE > data.length) break;
			tokens = data.readUInt16LE(source);
			source += HALF_WORD_SIZE;
		} else {
			if (source + WORD_SIZE > data.length) break;
			tokens = data.readInt32LE(source);
			source += WORD_SIZE;
		}

		let depth = 0;
		for (;;) {
			let index: number;
			if (depth > 0) {
				depth -= 1;
				index = stack[depth] ?? 0;
			} else {
				if (tokens === 0) break;
				tokens -= 1;
				if (source >= data.length) {
					destination = -1;
					break;
				}
				index = data[source++] ?? 0;
			}
			if (firstChild[index] === index) {
				if (destination >= output.length) {
					destination = -1;
					break;
				}
				output[destination] = index;
				destination += 1;
			} else {
				if (depth + 2 > stack.length) {
					destination = -1;
					break;
				}
				stack[depth++] = secondChild[index] ?? 0;
				stack[depth++] = firstChild[index] ?? 0;
			}
		}
		if (destination < 0) break;
	}
	if (destination !== output.length) {
		throw new RangeError("QLIE stream does not fill its declared output");
	}
	return output;
}
