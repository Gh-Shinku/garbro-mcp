// Format reference: GARbro "GameRes/ImageJPEG.cs", class `JpegFormat`, `ReadMetaData`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/**
 * Reads the header fields of a JPEG the way the reference's own reader does: the start of image marker, then a
 * walk of the marker segments, taking the depth as the frame's bit count times its component count. A frame
 * marker is any `0xC0..0xCF` apart from `0xC4`, which is the reference's own test — the Huffman table marker sits
 * in that range but is not a frame, while `0xC8` and `0xCC` are taken as frames because the reference does not
 * exclude them.
 *
 * The reference reads through a stream and throws at its end, so a file that stops inside a marker fails there;
 * the port reports the same case as an undefined layout. Segment lengths may walk past the end of the file, which
 * the reference's seek allows and which ends the walk here too.
 */
export function readJpegHeaderFields(
	jpeg: Buffer,
): { width: number; height: number; bitsPerPixel: number } | undefined {
	if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return undefined;
	let position = 2;
	while (position < jpeg.length) {
		if (position + 2 > jpeg.length) break;
		const marker = jpeg.readUInt16BE(position);
		position += 2;
		if ((marker & 0xff00) !== 0xff00) break;
		if (position + 2 > jpeg.length) break;
		const length = jpeg.readUInt16BE(position);
		position += 2;
		if ((marker & 0x00f0) === 0xc0 && marker !== 0xffc4) {
			if (length < 8) break;
			// Bits a sample, the height, the width and the component count, which the reference reads without
			// looking at the segment's own length.
			if (position + 6 > jpeg.length) break;
			const bits = jpeg[position] ?? 0;
			const height = jpeg.readUInt16BE(position + 1);
			const width = jpeg.readUInt16BE(position + 3);
			const components = jpeg[position + 5] ?? 0;
			return { width, height, bitsPerPixel: bits * components };
		}
		// The two bytes of the length are behind us, so the segment's own body is what is left of it.
		position += length - 2;
	}
	return undefined;
}
