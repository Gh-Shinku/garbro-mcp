// Format reference: GARbro "GameRes/ImagePNG.cs", class `PngFormat`, `ReadMetaData`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** A portable network graphic's first eight bytes. */
export const PNG_SIGNATURE: Buffer = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** Eight bytes of signature, the chunk's own length and type, then the thirteen byte header. */
const PNG_IHDR_OFFSET = 16;
const PNG_MINIMUM_SIZE = PNG_IHDR_OFFSET + 13;

/**
 * Reads the header fields of a portable network graphic the way the reference's own reader does: the signature,
 * an `IHDR` chunk, a bit depth from the small set it allows, and a colour type it recognises. A palette image is
 * reported as twenty four bits, which is what the reference does, and no dimension is checked for being non-zero
 * because the reference does not check it either.
 */
export function readPngHeaderFields(
	png: Buffer,
): { width: number; height: number; bitsPerPixel: number } | undefined {
	if (png.length < PNG_MINIMUM_SIZE) return undefined;
	if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) return undefined;
	if (png.toString("latin1", 12, 16) !== "IHDR") return undefined;
	const width = png.readUInt32BE(PNG_IHDR_OFFSET);
	const height = png.readUInt32BE(PNG_IHDR_OFFSET + 4);
	const depth = png[PNG_IHDR_OFFSET + 8] ?? 0;
	if (
		depth !== 1 &&
		depth !== 2 &&
		depth !== 4 &&
		depth !== 8 &&
		depth !== 16
	) {
		return undefined;
	}
	const colourType = png[PNG_IHDR_OFFSET + 9] ?? 0;
	let bitsPerPixel: number;
	switch (colourType) {
		case 2:
			bitsPerPixel = depth * 3;
			break;
		case 3:
			bitsPerPixel = 24;
			break;
		case 4:
			bitsPerPixel = depth * 2;
			break;
		case 6:
			bitsPerPixel = depth * 4;
			break;
		case 0:
			bitsPerPixel = depth;
			break;
		default:
			return undefined;
	}
	return { width, height, bitsPerPixel };
}
