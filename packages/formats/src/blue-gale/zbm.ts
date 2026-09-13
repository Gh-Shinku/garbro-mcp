// Format reference: GARBro ArcFormats/BlueGale/ImageZBM.cs, `ZbmFormat.Unpack` and `Decrypt`, which
// the BlueGale animation archives reuse.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { MsbBitReader } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";

const MATCH_MASK = 0x7f;
const LITERAL_LIMIT = 0x7f;
const OFFSET_BITS = 10;
const COUNT_BITS = 8;
/** Payloads may be obfuscated by inverting their first hundred bytes. */
const ENCRYPT_KEY = 0xff;
const ENCRYPT_LIMIT = 100;
const BMP_MARKER = [0x42, 0x4d];

/**
 * GARbro `ZbmFormat.Unpack`. A most-significant-bit-first stream first discards one bit, then reads an
 * eight-bit token: values above 0x7F introduce a match whose length is the token's low seven bits and
 * whose distance follows in ten bits, a zero token ends the stream, and anything else is a literal run
 * of that many bytes. Matches expand byte by byte, so they may overlap the output position.
 *
 * The reference writes through a caller-supplied buffer and start offset and raises an end-of-stream
 * error when the stream runs out; the port reports that as an invalid archive instead.
 */
export function unpackZbm(
	input: Buffer,
	output: Buffer,
	destination = 0,
): void {
	const bits = new MsbBitReader(input);
	bits.tryReadBits(1);
	let position = destination;
	while (position < output.length) {
		const token = bits.tryReadBits(COUNT_BITS);
		if (token === -1) break;
		if (token > LITERAL_LIMIT) {
			const offset = bits.tryReadBits(OFFSET_BITS);
			if (offset === -1)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated ZBM stream");
			const count = Math.min(token & MATCH_MASK, output.length - position);
			const from = position - offset;
			if (from < 0)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid ZBM back reference");
			for (let index = 0; index < count; index += 1)
				output[position + index] = output[from + index] ?? 0;
			position += count;
		} else {
			if (token === 0) break;
			for (
				let index = 0;
				index < token && position < output.length;
				index += 1
			) {
				const value = bits.tryReadBits(8);
				if (value === -1)
					throw new GarbroError("INVALID_ARCHIVE", "Truncated ZBM stream");
				output[position++] = value & 0xff;
			}
		}
	}
}

/**
 * GARbro `ZbmFormat.Decrypt`. A payload whose first two bytes are the inverted `BM` marker has its
 * first hundred bytes inverted back.
 */
export function decryptZbm(data: Buffer): void {
	if (
		(BMP_MARKER[0] ?? 0) === ((data[0] ?? 0) ^ ENCRYPT_KEY) &&
		(BMP_MARKER[1] ?? 0) === ((data[1] ?? 0) ^ ENCRYPT_KEY)
	) {
		const length = Math.min(ENCRYPT_LIMIT, data.length);
		for (let index = 0; index < length; index += 1)
			data[index] = (data[index] ?? 0) ^ ENCRYPT_KEY;
	}
}
