// Format reference: GARBro ArcFormats/Seraphim/ArcSCN.cs, `ScnOpener.LzDecompress`, which several
// ArchAngel engine formats share.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";

/** The reference allocates the declared size outright, so an implausible value is refused instead. */
const MAX_UNPACKED_SIZE = 0x4000000;
const DISTANCE_BITS = 0x3ff;
const MATCH_FLAG = 0x80;

/**
 * GARbro `ScnOpener.LzDecompress`. The stream opens with a 32-bit unpacked size, then control bytes
 * select between a literal run and a back reference: a clear top bit copies `control + 1` literal
 * bytes, while a set top bit pairs with the next byte so that ten bits form the distance minus one and
 * five bits form the length minus one. Copies may overlap the output position.
 *
 * The reference signals a truncated stream, an over-long run and a distance that reaches before the
 * output with exceptions, which its callers turn into an error or a raw fallback; the port reports the
 * same conditions as `GarbroError` for that reason.
 */
export function decompressArchAngelLz(input: Buffer): Buffer {
	if (input.length < 4)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated ArchAngel stream");
	const unpackedSize = input.readInt32LE(0);
	if (unpackedSize <= 0 || unpackedSize > MAX_UNPACKED_SIZE)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Implausible ArchAngel unpacked size",
		);
	const output = Buffer.alloc(unpackedSize);
	let source = 4;
	let destination = 0;
	while (destination < unpackedSize) {
		if (source >= input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated ArchAngel stream");
		const control = input[source++] ?? 0;
		if ((control & MATCH_FLAG) !== 0) {
			if (source >= input.length)
				throw new GarbroError("INVALID_ARCHIVE", "Truncated ArchAngel stream");
			const low = input[source++] ?? 0;
			const offset = (((control << 3) | (low >> 5)) & DISTANCE_BITS) + 1;
			const count = (low & 0x1f) + 1;
			if (destination - offset < 0)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Invalid ArchAngel back reference",
				);
			// GARbro's overlapped copy reads bytes it may have just written.
			for (let index = 0; index < count; index += 1) {
				if (destination >= output.length)
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"ArchAngel match runs past the output",
					);
				output[destination] = output[destination - offset] ?? 0;
				destination += 1;
			}
		} else {
			const count = control + 1;
			if (source + count > input.length || destination + count > output.length)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Truncated ArchAngel literal run",
				);
			input.copy(output, destination, source, source + count);
			source += count;
			destination += count;
		}
	}
	return output;
}
