// Format reference: GARBro GameRes/GameRes.cs (`AutoEntry.DetectFileType`) and the signature tables of
// the formats it looks up.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

export interface DetectedType {
	type: string;
	extension: string;
}

/** GARbro `AutoEntry.DetectFileType`, limited to the two special cases. */
const DETECTED_TYPES: readonly {
	signature: number;
	type: string;
	extension: string;
}[] = [
	{ signature: 0x5367674f, type: "audio", extension: "ogg" },
	{ signature: 0x46464952, type: "audio", extension: "wav" },
];
const BMP_SIGNATURE = 0x4d42;

/**
 * GARbro `AutoEntry.DetectFileType`, restricted to the Ogg, RIFF and bitmap special cases; the
 * catalog-wide signature lookup is not reproduced, so an unknown signature leaves the entry alone.
 */
export function detectFileType(signature: number): DetectedType | undefined {
	if (signature === 0) return undefined;
	const match = DETECTED_TYPES.find(
		(candidate) => candidate.signature === signature,
	);
	if (match) return { type: match.type, extension: match.extension };
	if ((signature & 0xffff) === BMP_SIGNATURE)
		return { type: "image", extension: "bmp" };
	return undefined;
}
