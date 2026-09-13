// Format reference: GARbro Legacy/Rare/ArcX.cs, method `XOpener.Decompress`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Rare uses a ring buffer variant that indexes the frame with an absolute position taken straight from
// the bit stream instead of a distance from the write cursor, and that fixes the match length at five
// bits plus two.

import { MsbBitReader } from "@garbro-mcp/codecs";

const FRAME_SIZE = 0x400;
const FRAME_MASK = FRAME_SIZE - 1;
const OFFSET_BITS = 10;
const COUNT_BITS = 5;
const MATCH_BASE = 2;
const LITERAL_BITS = 8;
/** The reference starts writing at the second frame slot. */
const FRAME_START = 1;

/**
 * Decompresses a Rare payload into exactly `outputLength` bytes. Missing bits end the stream, and a copy
 * that would overrun the output is truncated instead of raising, since the reference relies on its own
 * array bounds.
 */
export function inflateRareData(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	const frame = Buffer.alloc(FRAME_SIZE);
	const reader = new MsbBitReader(input);
	let framePosition = FRAME_START;
	let written = 0;
	while (written < outputLength) {
		const control = reader.tryReadBits(1);
		if (control < 0) break;
		if (control !== 0) {
			const value = reader.tryReadBits(LITERAL_BITS);
			if (value < 0) break;
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & FRAME_MASK;
			output[written] = value;
			written += 1;
			continue;
		}
		const offset = reader.tryReadBits(OFFSET_BITS);
		if (offset < 0) break;
		const count = reader.tryReadBits(COUNT_BITS);
		if (count < 0) break;
		let source = offset & FRAME_MASK;
		for (let index = 0; index < count + MATCH_BASE; index += 1) {
			if (written >= outputLength) break;
			const value = frame[source] ?? 0;
			source = (source + 1) & FRAME_MASK;
			frame[framePosition] = value;
			framePosition = (framePosition + 1) & FRAME_MASK;
			output[written] = value;
			written += 1;
		}
	}
	return output;
}
