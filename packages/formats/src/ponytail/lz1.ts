// Codec reference: GARbro Legacy/Ponytail/ArcBND.cs, `BndOpener.Lz1Unpack`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";

const MIN_MATCH = 3;
const MATCH_BITS = 0x1f;
const OFFSET_SHIFT = 5;

/**
 * GARbro `BndOpener.Lz1Unpack`. A control byte is read whenever the eight-bit mask runs out; a set bit
 * means one literal byte, a clear bit means a match whose distance and length share two bytes — the
 * distance is the high eleven bits plus one, the length is the low five bits plus three. Matches expand
 * byte by byte, so they may overlap the output position.
 *
 * The reference returns a partially filled buffer when the stored stream ends early, so a missing
 * control byte ends decoding without error; a literal or match that runs past the stored bytes is
 * truncated instead.
 */
export function unpackLz1(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let position = 0;
	let mask = 0;
	let control = 0;
	let written = 0;
	while (written < output.length) {
		mask = (mask << 1) & 0xff;
		if (mask === 0) {
			if (position >= input.length) break;
			control = input[position++] ?? 0;
			mask = 1;
		}
		if ((control & mask) !== 0) {
			if (position >= input.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated LZ1 literal");
			output[written++] = input[position++] ?? 0;
		} else {
			if (position + 2 > input.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated LZ1 match");
			const code = (input[position] ?? 0) | ((input[position + 1] ?? 0) << 8);
			position += 2;
			const offset = (code >> OFFSET_SHIFT) + 1;
			const count = Math.min(
				MIN_MATCH + (code & MATCH_BITS),
				output.length - written,
			);
			const from = written - offset;
			if (from < 0)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid LZ1 back reference");
			for (let index = 0; index < count; index += 1)
				output[written + index] = output[from + index] ?? 0;
			written += count;
		}
	}
	return output;
}
