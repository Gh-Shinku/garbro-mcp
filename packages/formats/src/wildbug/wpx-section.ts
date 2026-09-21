// Format reference: GARBro "ArcFormats/WildBug/ImageWBM.cs", class `WpxSection` and its `Find`, which the
// pictures and the sounds of this engine share. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.

/** The head a file of this engine opens with: a word, a kind, and a directory of sections behind it. */
export const WPX_HEADER_SIZE = 0x10;
export const WPX_SIGNATURE = Buffer.from("WPX\u001a", "latin1");
/** Where the head keeps the directory's record size and the number of records. */
export const WPX_DIRECTORY_SIZE_FIELD = 0x0f;
export const WPX_DIRECTORY_COUNT_FIELD = 0x0e;
export const WPX_VERSION_FIELD = 0x0c;
export const WPX_DIRECTORY_OFFSET = 0x10;
/** One record names a section: a byte of its own, a byte that says how it is stored, and three words. */
export const WPX_RECORD_SIZE = 16;
const RECORD_FORMAT_FIELD = 1;
const RECORD_OFFSET_FIELD = 4;
const RECORD_UNPACKED_SIZE_FIELD = 8;
const RECORD_PACKED_SIZE_FIELD = 12;

export interface WpxSection {
	/** How the section's bytes are stored, which every reader reads its own way. */
	dataFormat: number;
	offset: number;
	unpackedSize: number;
	packedSize: number;
}

/**
 * `WpxSection.Find`: the directory is walked in steps of its record size until a record that opens with the
 * byte the caller asks for is found, and the count bounds the walk. The reference compares the byte before
 * it checks that the walk is still inside the directory, so a directory whose last record is not the one
 * asked for reads one byte past its end; here the bounds are checked first.
 */
export function findWpxSection(
	directory: Buffer,
	id: number,
	count: number,
	directorySize: number,
): WpxSection | undefined {
	for (let record = 0; record < count; record += 1) {
		const at = record * directorySize;
		if (at >= directory.length) return undefined;
		if (directory[at] !== id) continue;
		if (at + WPX_RECORD_SIZE > directory.length) return undefined;
		return {
			dataFormat: directory[at + RECORD_FORMAT_FIELD] ?? 0,
			offset: directory.readInt32LE(at + RECORD_OFFSET_FIELD),
			unpackedSize: directory.readInt32LE(at + RECORD_UNPACKED_SIZE_FIELD),
			packedSize: directory.readInt32LE(at + RECORD_PACKED_SIZE_FIELD),
		};
	}
	return undefined;
}

/** The head of a file of this engine, once its kind has been told apart. */
export interface WpxIndex {
	count: number;
	directorySize: number;
	directory: Buffer;
}

/**
 * The head both kinds of this engine carry: the word, four bytes that name the kind, a byte of version, and
 * the number and size of the records behind it. A record narrower than the fields it holds would read into
 * its neighbour, so it is refused here, where the reference only asks that the size is not zero.
 */
export function readWpxIndex(
	data: Buffer,
	marker: string,
): WpxIndex | undefined {
	if (data.length < WPX_HEADER_SIZE) return undefined;
	if (!data.subarray(0, 4).equals(WPX_SIGNATURE)) return undefined;
	// The marker is three bytes long, and the byte behind it belongs to the version.
	if (data.toString("latin1", 4, 4 + marker.length) !== marker)
		return undefined;
	if (data[WPX_VERSION_FIELD] !== 1) return undefined;
	const count = data[WPX_DIRECTORY_COUNT_FIELD] ?? 0;
	const directorySize = data[WPX_DIRECTORY_SIZE_FIELD] ?? 0;
	if (0 === count || directorySize < WPX_RECORD_SIZE) return undefined;
	const size = count * directorySize;
	if (WPX_DIRECTORY_OFFSET + size > data.length) return undefined;
	return {
		count,
		directorySize,
		directory: data.subarray(WPX_DIRECTORY_OFFSET, WPX_DIRECTORY_OFFSET + size),
	};
}

/** The bytes a section holds, bounded by the file it stands in. */
export function readWpxSectionData(
	data: Buffer,
	section: WpxSection,
	size: number,
): Buffer | undefined {
	if (size < 0 || section.offset < 0 || section.offset + size > data.length) {
		return undefined;
	}
	return data.subarray(section.offset, section.offset + size);
}
