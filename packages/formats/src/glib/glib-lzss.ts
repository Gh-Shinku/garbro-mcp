// Format reference: GARBro "ArcFormats/GLib/ArcG.cs", the `GOpener.LzssUnpack` the Glib engine's own
// archives and the Glib2 engine's pictures both stand on. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** The frame every run reads back from, and the place its cursor starts. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
const FRAME_START = 0xfee;
/** A control word of one byte, whose low bit is the first decision the run makes. */
const CONTROL_MARK = 0x100;

/**
 * `GOpener.LzssUnpack`: a control word of one byte read from its **low** bit upward - a set bit standing for
 * a byte that stands as it is, a clear one for a pair of bytes that name a place in the frame and a run. The
 * place is the low byte and the **top** half of the high byte, and the run is the bottom half of that byte,
 * counted from one: `(~hi & 0xF) + 3`.
 *
 * The walk reads from the input in one run, so its own end is handed back and a caller may read on behind it.
 */
export function unpackGlibLzss(
	input: Buffer,
	from: number,
	output: Uint8Array,
	outputSize: number,
): number {
	const frame = new Uint8Array(FRAME_SIZE);
	let at = from;
	let dst = 0;
	let framePos = FRAME_START;
	let control = 2;
	while (dst < outputSize) {
		control >>= 1;
		if (1 === control) {
			if (at >= input.length) break;
			control = (input[at] ?? 0) | CONTROL_MARK;
			at += 1;
		}
		if (0 !== (control & 1)) {
			if (at >= input.length) break;
			const value = input[at] ?? 0;
			at += 1;
			frame[framePos & FRAME_MASK] = value;
			framePos += 1;
			output[dst] = value;
			dst += 1;
			continue;
		}
		if (at + 2 > input.length) break;
		const low = input[at] ?? 0;
		const high = input[at + 1] ?? 0;
		at += 2;
		let offset = ((high & 0xf0) << 4) | low;
		let count = Math.min((~high & 0x0f) + 3, outputSize - dst);
		while (count > 0) {
			const value = frame[offset & FRAME_MASK] ?? 0;
			offset += 1;
			frame[framePos & FRAME_MASK] = value;
			framePos += 1;
			output[dst] = value;
			dst += 1;
			count -= 1;
		}
	}
	return at;
}
