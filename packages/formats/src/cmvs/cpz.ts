// Format reference: GARBro ArcFormats/Cmvs/ArcCPZ.cs, class `CpzOpener` (shared `UnpackLzss`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** The LZSS container keeps its unpacked size behind a 0x30-byte header. */
export const CPZ_LZSS_HEADER_SIZE = 0x30;
const UNPACKED_SIZE_OFFSET = 0x28;
const FRAME_SIZE = 0x800;
const FRAME_MASK = 0x7ff;
const FRAME_INIT = 0x7df;
const MATCH_BASE = 2;

/**
 * GARbro `CpzOpener.UnpackLzss`: a 0x800-byte frame with an initial position of 0x7DF, a control byte
 * holding eight flags, and a declared unpacked size behind a 0x30-byte header. Literals are stored
 * verbatim, matches read a little-endian word whose low five bits are the length minus two and whose
 * remaining bits address the frame. The CPZ1 and CPZ2 openers share this decoder.
 */
export function unpackCpzLzss(data: Buffer): Buffer {
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_OFFSET);
	const output = Buffer.alloc(CPZ_LZSS_HEADER_SIZE + Math.max(0, unpackedSize));
	const headerLength = Math.min(CPZ_LZSS_HEADER_SIZE, data.length);
	data.copy(output, 0, 0, headerLength);
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = FRAME_INIT;
	let source = CPZ_LZSS_HEADER_SIZE;
	let destination = CPZ_LZSS_HEADER_SIZE;
	let control = 1;
	while (destination < output.length && source < data.length) {
		if (control === 1) control = (data[source++] ?? 0) | 0x100;
		if ((control & 1) !== 0) {
			const value = data[source++] ?? 0;
			output[destination++] = value;
			frame[framePosition++] = value;
			framePosition &= FRAME_MASK;
		} else {
			const low = data[source++] ?? 0;
			const high = data[source++] ?? 0;
			const offset = low | ((high & 0xe0) << 3);
			const count = (high & 0x1f) + MATCH_BASE;
			for (
				let index = 0;
				index < count && destination < output.length;
				index += 1
			) {
				const value = frame[(offset + index) & FRAME_MASK] ?? 0;
				output[destination++] = value;
				frame[framePosition++] = value;
				framePosition &= FRAME_MASK;
			}
		}
		control >>= 1;
	}
	return output;
}
