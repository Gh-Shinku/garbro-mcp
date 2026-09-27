// Reader of the picture of the web (WebP): the reference (GARbro `Experimental/WebP/ImageWEBP.cs`) hands the stream
// to the library of the picture of the web of its platform (libwebp.dll), which this project does not carry, so this
// module walks the counts of the picture itself. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// Read here: the counts of the head of the container of the format (RIFF, of the counts of the head of the format of
// the picture of the web) and the counts of the head of the picture of the two kinds of it, of the places of the
// picture of the counts of the head of the format of the picture of the web and of the counts of the head of the
// picture of the walk of the jpeg of the counts of the head of the format of the web. The places of the picture of
// the two kinds of it stand of no walk of this project yet, each with a message of its own.

import { GarbroError } from "@garbro-mcp/core";

/** The count of the head of the format of the picture of the web. */
const RIFF = 0x46464952;

/** The count of the head of the head of the file of the picture of the web. */
const WEBP = 0x50424557;

/** The count of the head of the format of the picture of the web of the walk of the places of the picture that stand
 * of the counts of the head of the format of the picture of the web of the walk of the two places of the file. */
const VP8X = 0x58385056;

/** The count of the head of the format of the picture of the web of the walk of the counts of the picture of the
 * colours of the places of the picture that stand of the counts of the head of the format of the picture of the web. */
const VP8L = 0x4c385056;

/** The count of the head of the format of the picture of the web of the walk of the counts of the colour of the
 * places of the picture of the counts of the head of the format of the picture of the web of the places of the file. */
const VP8 = 0x20385056;

/** The count of the head of the format of the picture of the web of the counts of the places of the file of the
 * picture of the colour of the picture of the places of the picture of the head of the format of the picture of the
 * web. */
const ALPH = 0x48504c41;

/** The count of the head of the format of the picture of the web of the walk of the places of the picture of the
 * colour of the picture that stand of the counts of the head of the format of the picture of the colours of the
 * picture of the format. */
const ANIM = 0x4d494e41;

/** The count of the head of the format of the picture of the web of the places of the file of the picture of the
 * colour of the picture of the two places of the file behind the other. */
const ANMF = 0x464d4e41;

/** The counts of the head of the format of the picture of the web of the places of the file of the picture that stand
 * of no count of the head of the picture of the web of the picture of the colour of the picture itself. */
const EXIF = 0x46495845;

/** The counts of the head of the format of the picture of the web of the counts of the head of the format of the
 * picture of the colour of the picture of the picture of the head of the format. */
const XMP = 0x20504d58;

/** The counts of the head of the format of the picture of the web of the counts of the head of the picture of the
 * place of the colour of the picture of the picture of the colour of the head of the format. */
const ICCP = 0x50434349;

/** The counts of the head of the format of the picture of the web of the counts of the head of the picture of the
 * places of the picture of the colour of the picture of the places of the picture of the head of the format of the
 * picture of the web. */
export interface WebpHeader {
	/** The counts of the places of the file of the picture of the web of the picture of the places of the file of the
	 * picture of the colour of the pictures of the format of the picture of the web. */
	width: number;
	/** The counts of the places of the file of the picture of the web of the counts of the places of the file of the
	 * rows of the picture of the format. */
	height: number;
	/** Whether the count of the head of the picture of the colour of the picture of the places of the picture of the
	 * picture of the web stands of a place of the file of the colour of the picture of the places of the file. */
	alpha: boolean;
	/** Whether the places of the picture of the picture of the web stand of the counts of the places of the picture of
	 * the colour of the picture of no places of the file of their own. */
	lossless: boolean;
	/** The counts of the places of the file of the picture of the web of the picture of the head of the format of the
	 * picture of the web of the picture of the colour of the picture of the format of the picture of the web, which
	 * every picture of this kind of the picture of the web names. */
	version: number;
}

/** The places of the file of a count of the head of the format of the picture of the web, of the count of the places
 * of the file of the count of the head. */
interface Chunk {
	type: number;
	at: number;
	size: number;
}

/** The counts of the places of the file of the picture of the web of the counts of the head of the format of the
 * picture of the web, of the places of the file of the head of the format of the picture of the web of the picture of
 * the colour of the picture. */
function u32(data: Buffer, at: number): number {
	if (at + 4 > data.length)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"The counts of the head of the format of the picture of the web stand beyond the places of the file of the picture",
		);
	return data.readUInt32LE(at);
}

/** The counts of the head of the format of the picture of the web of the counts of the head of the picture of the
 * colour of the picture, of the counts of the head of the format of the picture of the web of the picture of the
 * colour of the places of the picture of the head of the format of the picture of the web. */
function walkChunks(data: Buffer): Chunk[] {
	if (data.length < 12)
		throw invalid("The picture of the web stands short of its head");
	if (RIFF !== u32(data, 0) || WEBP !== u32(data, 8))
		throw invalid(
			"The picture of the web stands of no head of the format of the picture of the web",
		);
	const length = u32(data, 4) + 8;
	if (length > data.length)
		throw invalid(
			"The picture of the web stands of counts of the places of the file of the head of the format of the picture of the web of its own",
		);
	const chunks: Chunk[] = [];
	let at = 12;
	while (at + 8 <= Math.min(length, data.length)) {
		const type = u32(data, at);
		const size = u32(data, at + 4);
		if (at + 8 + size > data.length)
			throw invalid(
				"The counts of the head of the format of the picture of the web of the picture of the colour of the picture stand beyond the places of the file of the picture",
			);
		chunks.push({ type, at: at + 8, size });
		at += 8 + size + (size & 1);
	}
	return chunks;
}

/** The counts of the head of the format of the picture of the web of the places of the picture of the picture of the
 * colour of the picture of the two places of the file behind the other, of the counts of the head of the format of
 * the picture of the web of the picture of the colours of the picture. */
function readLossy(data: Buffer, at: number, size: number): WebpHeader {
	if (size < 10)
		throw invalid(
			"The picture of the web of the colour of the picture stands short of its head",
		);
	const tag = data[at] ?? 0;
	if (0 !== (tag & 1))
		throw invalid(
			"The picture of the web of the colour of the picture stands of no count of the head of the picture of the head of the format of the picture of the web",
		);
	if (0x9d !== data[at + 3] || 0x01 !== data[at + 4] || 0x2a !== data[at + 5])
		throw invalid(
			"The picture of the web of the colour of the picture stands of no counts of the head of the format of the picture of the web",
		);
	return {
		width: ((data[at + 6] ?? 0) | ((data[at + 7] ?? 0) << 8)) & 0x3fff,
		height: ((data[at + 8] ?? 0) | ((data[at + 9] ?? 0) << 8)) & 0x3fff,
		alpha: false,
		lossless: false,
		version: 0,
	};
}

/** The counts of the head of the format of the picture of the web of the places of the picture of the picture of the
 * colour of the picture of the counts of the head of the format of the picture of the web of the picture of the
 * colours of the picture. */
function readLossless(data: Buffer, at: number, size: number): WebpHeader {
	if (size < 5)
		throw invalid(
			"The picture of the web of the counts of the head of the format of the picture of the web stands short of its head",
		);
	if (0x2f !== data[at])
		throw invalid(
			"The picture of the web of the counts of the head of the format of the picture of the web stands of no counts of the head of the format of the picture of the web",
		);
	const bits =
		(data[at + 1] ?? 0) |
		((data[at + 2] ?? 0) << 8) |
		((data[at + 3] ?? 0) << 16) |
		((data[at + 4] ?? 0) << 24);
	const version = (bits >>> 29) & 0x7;
	if (0 !== version)
		throw invalid(
			"The picture of the web of the counts of the head of the format of the picture of the web stands of counts of the head of the format of the picture of the web of its own",
		);
	return {
		width: (bits & 0x3fff) + 1,
		height: ((bits >>> 14) & 0x3fff) + 1,
		alpha: 0 !== ((bits >>> 28) & 1),
		lossless: true,
		version,
	};
}

/** The counts of the head of the format of the picture of the web of the picture of the counts of the head of the
 * format of the picture of the web of the picture of the places of the file of the picture of the colour of the
 * picture. */
export function readWebpHeader(data: Buffer): WebpHeader {
	const chunks = walkChunks(data);
	let extended: WebpHeader | undefined;
	let picture: WebpHeader | undefined;
	let alpha = false;
	for (const chunk of chunks) {
		switch (chunk.type) {
			case VP8X: {
				if (chunk.size < 10)
					throw invalid(
						"The counts of the head of the format of the picture of the web of the picture of the places of the file stands short of its head",
					);
				const flags = data[chunk.at] ?? 0;
				extended = {
					width:
						1 +
						((data[chunk.at + 4] ?? 0) |
							((data[chunk.at + 5] ?? 0) << 8) |
							((data[chunk.at + 6] ?? 0) << 16)),
					height:
						1 +
						((data[chunk.at + 7] ?? 0) |
							((data[chunk.at + 8] ?? 0) << 8) |
							((data[chunk.at + 9] ?? 0) << 16)),
					alpha: 0 !== (flags & 0x10),
					lossless: false,
					version: 0,
				};
				break;
			}
			case VP8L:
				picture = readLossless(data, chunk.at, chunk.size);
				break;
			case VP8:
				picture = readLossy(data, chunk.at, chunk.size);
				break;
			case ALPH:
				alpha = true;
				break;
			case ANIM:
			case ANMF:
				throw new GarbroError(
					"UNSUPPORTED_FEATURE",
					"A picture of the web of the places of the file of the picture of the colour of the picture of the places of the picture of the head of the format of the picture of the web stands of no walk of this project",
				);
			case EXIF:
			case XMP:
			case ICCP:
				break;
			default:
				throw invalid(
					"The picture of the web stands of a count of the head of the format of the picture of the web this walk does not read",
				);
		}
	}
	if (!picture)
		throw invalid(
			"The picture of the web names no places of the file of the picture",
		);
	if (extended) {
		if (extended.width !== picture.width || extended.height !== picture.height)
			throw invalid(
				"The counts of the head of the format of the picture of the web of the picture of the places of the file stand of the places of the picture of the counts of the head of the format of the picture of the web of their own",
			);
		return { ...picture, alpha: picture.alpha || extended.alpha || alpha };
	}
	return { ...picture, alpha: picture.alpha || alpha };
}

/** The counts of the head of the format of the picture of the web of the picture of the colour of the picture that
 * stand of no counts of the head of the format of the picture of the web of the picture of the web itself. */
function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
