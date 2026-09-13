// Format reference: GARbro "ArcFormats/Kaguya/ArcKaguya.cs", class `LzReader` (the KaGuYa LZ codec).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";

/** The sliding window, and the mask that wraps every index into it. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const MAX_UNPACKED_SIZE = 0x4000000;

/**
 * `LzReader.Unpack`, most significant bit first. A set bit is a literal byte; a clear bit is a match whose
 * twelve bit offset and four bit count are read after it, with the count biased by two.
 *
 * Three of the reference's details are unusual enough to keep exactly:
 *
 * * the frame position starts at **one**, so the frame's first byte is not written until the position wraps
 *   round, and a match that reads it before then gets a zero that was never stored;
 * * an offset of **zero** ends the stream, as does running out of input at the bit level;
 * * the output is written without a bounds check, so a match that would run past the end throws — which the
 *   port has to do by hand, since writing past a JavaScript buffer is silently ignored.
 *
 * A truncated literal is **not** treated as the end: the reference casts the missing byte rather than stopping,
 * so the rest of the buffer fills with 0xFF, and a truncated count nibble is cast the same way, which makes the
 * count come out as one rather than three.
 */
export function unpackKaguyaLz(input: Buffer, unpackedSize: number): Buffer {
	if (unpackedSize < 0 || unpackedSize > MAX_UNPACKED_SIZE)
		throw new GarbroError("INVALID_ARCHIVE", "Unusable KaGuYa LZ output size");
	const bits = new MsbBitReader(input);
	const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	let dst = 0;
	let framePos = 1;
	while (dst < unpackedSize) {
		const bit = bits.tryReadBits(1);
		if (bit === -1) break;
		if (bit !== 0) {
			const value = bits.tryReadBits(8);
			const data = value === -1 ? 0xff : value;
			output[dst++] = data;
			frame[framePos++] = data;
			framePos &= FRAME_MASK;
		} else {
			const winOffset = bits.tryReadBits(12);
			if (winOffset === -1 || winOffset === 0) break;
			// A missing nibble is cast to 0xFF, so the count is one rather than three.
			const count = bits.tryReadBits(4) + 2;
			for (let index = 0; index < count; index += 1) {
				const data = frame[(winOffset + index) & FRAME_MASK] ?? 0;
				if (dst >= unpackedSize)
					throw new GarbroError("INVALID_ARCHIVE", "KaGuYa LZ output overrun");
				output[dst++] = data;
				frame[framePos++] = data;
				framePos &= FRAME_MASK;
			}
		}
	}
	return output;
}
