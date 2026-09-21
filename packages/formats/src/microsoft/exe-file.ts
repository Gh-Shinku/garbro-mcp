// Format reference: GARBro "ArcFormats/ExeFile.cs", class `ExeFile` - its managed half, which reads the
// header of a Windows executable and its sections. The reference's own `ResourceAccessor` reaches the
// resources through the Windows loader (`LoadLibraryEx`, `FindResource`, `LoadResource`, `SizeofResource`
// and the enumeration callbacks behind them), so it stands outside this port. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

/** The word every Windows executable opens with. */
const MZ_WORD = "MZ";
/** Where the second header of the file is named, and the words of that header. */
const HEADER_POINTER = 0x3c;
const PE_MARK = "PE\0\0";
const NE_MARK = "NE";
const SECTION_COUNT_FIELD = 6;
const OPTIONAL_HEADER_SIZE_FIELD = 0x14;
const SIZE_OF_HEADERS_FIELD = 0x54;
/** The optional header: its mark, its own size, and the base a picture of it is loaded at. */
const OPTIONAL_MAGIC = 0x010b;
const OPTIONAL_MAGIC_FIELD = 0x18;
const OPTIONAL_OFFSET = 0x1c;
/** One section header, and where its own fields stand. */
const SECTION_HEADER_SIZE = 0x28;
const SECTION_TABLE_OFFSET = 0x18;
const SECTION_NAME_SIZE = 8;
const SECTION_VIRTUAL_SIZE = 0x08;
const SECTION_VIRTUAL_ADDRESS = 0x0c;
const SECTION_RAW_SIZE = 0x10;
const SECTION_RAW_OFFSET = 0x14;
const SECTION_CHARACTERISTICS = 0x24;
/** A sixteen-bit executable keeps its segments in a table of its own. */
const NE_SEGMENT_COUNT = 0x1c;
const NE_SEGMENT_TABLE = 0x22;
const NE_SEGMENT_SHIFT = 0x32;
const NE_SEGMENT_ENTRY_SIZE = 4;
/** The bytes of the file itself. */
const WHOLE_SIZE_LIMIT = 0xffffffff;

export interface ExeSection {
	offset: number;
	size: number;
}

export interface ExeImageSection {
	name: string;
	virtualSize: number;
	virtualAddress: number;
	rawSize: number;
	rawOffset: number;
	characteristics: number;
}

export interface ExeFile {
	/** The bytes of the executable, which every place below is counted from. */
	data: Buffer;
	/** Whether the file keeps a sixteen-bit header rather than a thirty-two-bit one. */
	win16: boolean;
	/** The named sections, and the same sections in the order the file keeps them. */
	sections: Map<string, ExeSection>;
	imageSections: ExeImageSection[];
	/** What stands behind the last section of the file. */
	overlay: ExeSection;
	/** The base the executable's pictures are loaded at. */
	imageBase: number;
}

/** Reads a name of the fixed length the section table keeps, up to its first nothing. */
function readName(data: Buffer, at: number, size: number): string {
	let end = at;
	while (end < at + size && end < data.length && 0 !== data[end]) end += 1;
	return data.toString("latin1", at, end);
}

/**
 * `ExeFile`: the header of a Windows executable. The reference throws for a file that is not one; this port
 * hands back nothing instead, so a caller may walk on to the next file it was given.
 */
export function readExeFile(input: Buffer): ExeFile | undefined {
	if (input.length < 0x40) return undefined;
	if (input.toString("latin1", 0, 2) !== MZ_WORD) return undefined;
	const wholeSize = Math.min(input.length, WHOLE_SIZE_LIMIT);
	const file: ExeFile = {
		data: input,
		win16: false,
		sections: new Map(),
		imageSections: [],
		overlay: { offset: wholeSize, size: 0 },
		imageBase: 0,
	};
	const neOffset = input.readUInt32LE(HEADER_POINTER);
	if (
		neOffset < input.length - 2 &&
		input.toString("latin1", neOffset, neOffset + 2) === NE_MARK
	) {
		file.win16 = true;
		readNeSegments(file, neOffset);
		return file;
	}
	const peOffset = readPeHeader(file);
	if (undefined === peOffset) return undefined;
	readSections(file, peOffset);
	readImageBase(file, peOffset);
	return file;
}

/** `ExeFile.InitImageBase`: the base the executable is loaded at, read from its optional header. */
function readImageBase(file: ExeFile, peOffset: number): void {
	const { data } = file;
	const magicAt = peOffset + OPTIONAL_MAGIC_FIELD;
	if (magicAt + 2 > data.length) return;
	if (OPTIONAL_MAGIC !== data.readUInt16LE(magicAt)) return;
	const baseAt = magicAt + OPTIONAL_OFFSET;
	if (baseAt + 4 <= data.length) file.imageBase = data.readUInt32LE(baseAt);
}

/** `ExeFile.GetHeaderOffset`: the second header of a thirty-two-bit executable, checked as the reference does. */
function readPeHeader(file: ExeFile): number | undefined {
	const { data } = file;
	const peOffset = data.readUInt32LE(HEADER_POINTER);
	if (peOffset >= data.length - 0x58) return undefined;
	if (data.toString("latin1", peOffset, peOffset + 4) !== PE_MARK)
		return undefined;
	return peOffset;
}

/** `ExeFile.InitSectionTable` for a thirty-two-bit executable. */
function readSections(file: ExeFile, peOffset: number): void {
	const { data } = file;
	if (peOffset + SECTION_TABLE_OFFSET > data.length) return;
	const optionalSize = data.readUInt16LE(peOffset + OPTIONAL_HEADER_SIZE_FIELD);
	const count = data.readUInt16LE(peOffset + SECTION_COUNT_FIELD);
	const tableAt = peOffset + optionalSize + SECTION_TABLE_OFFSET;
	let offset = data.readUInt32LE(peOffset + SIZE_OF_HEADERS_FIELD);
	const end = Math.min(data.length, WHOLE_SIZE_LIMIT);
	if (tableAt + SECTION_HEADER_SIZE * count < end) {
		let at = tableAt;
		for (let index = 0; index < count; index += 1) {
			const name = readName(data, at, SECTION_NAME_SIZE);
			const image: ExeImageSection = {
				name,
				virtualSize: data.readUInt32LE(at + SECTION_VIRTUAL_SIZE),
				virtualAddress: data.readUInt32LE(at + SECTION_VIRTUAL_ADDRESS),
				rawSize: data.readUInt32LE(at + SECTION_RAW_SIZE),
				rawOffset: data.readUInt32LE(at + SECTION_RAW_OFFSET),
				characteristics: data.readUInt32LE(at + SECTION_CHARACTERISTICS),
			};
			const section: ExeSection = {
				offset: image.rawOffset,
				size: image.rawSize,
			};
			file.imageSections.push(image);
			if (!file.sections.has(name)) file.sections.set(name, section);
			if (0 !== section.size) {
				offset = Math.max(section.offset + section.size, offset);
			}
			at += SECTION_HEADER_SIZE;
		}
	}
	offset = Math.min((offset + 0xf) & ~0xf, end);
	file.overlay = { offset, size: end - offset };
}

/** `ExeFile.InitNe`: the segments of a sixteen-bit executable, which carry no names of their own. */
function readNeSegments(file: ExeFile, neOffset: number): void {
	const { data } = file;
	if (neOffset + NE_SEGMENT_SHIFT + 2 > data.length) return;
	const count = data.readUInt16LE(neOffset + NE_SEGMENT_COUNT);
	const shift = data.readUInt16LE(neOffset + NE_SEGMENT_SHIFT);
	const tableAt = data.readUInt16LE(neOffset + NE_SEGMENT_TABLE) + neOffset;
	let lastEnd = 0;
	for (let index = 0; index < count; index += 1) {
		const at = tableAt + index * NE_SEGMENT_ENTRY_SIZE;
		if (at + NE_SEGMENT_ENTRY_SIZE > data.length) break;
		const offset = data.readUInt16LE(at) << shift;
		const size = data.readUInt16LE(at + 2);
		if (offset + size > lastEnd) lastEnd = offset + size;
	}
	const end = Math.min(data.length, WHOLE_SIZE_LIMIT);
	file.overlay = { offset: lastEnd, size: end - lastEnd };
}

/**
 * `ExeFile.GetAddressSection`: the section a virtual address stands in. The base is read the way the
 * reference reads it, and a file whose optional header is not the one of a thirty-two-bit executable has no
 * base at all.
 */
function addressSection(
	file: ExeFile,
	address: number,
): ExeImageSection | undefined {
	const peOffset = readPeHeader(file);
	if (undefined === peOffset) return undefined;
	if (address < file.imageBase) return undefined;
	const rva = address - file.imageBase;
	for (const section of file.imageSections) {
		if (
			rva >= section.virtualAddress &&
			rva < section.virtualAddress + section.rawSize
		) {
			return section;
		}
	}
	return undefined;
}

/** `ExeFile.GetAddressOffset`: where a virtual address stands in the file itself. */
export function exeAddressOffset(
	file: ExeFile,
	address: number,
): number | undefined {
	const section = addressSection(file, address);
	if (!section) return undefined;
	const rva = address - file.imageBase;
	return section.rawOffset + (rva - section.virtualAddress);
}

/** `ExeFile.FindString`: the first place inside a section where a run of bytes stands, stepping as told. */
export function findExeString(
	file: ExeFile,
	section: ExeSection,
	sequence: Buffer,
	step = 1,
): number {
	if (step <= 0) return -1;
	const { data } = file;
	const length = sequence.length;
	if (0 === length || section.size < length) return -1;
	const start = Math.max(0, section.offset);
	const end = Math.min(data.length, start + section.size);
	for (let at = start; at + length <= end; at += step) {
		if (data.compare(sequence, 0, length, at, at + length) === 0) return at;
	}
	return -1;
}

/**
 * `ExeFile.GetCString`: the name a virtual address names, read up to its first nothing. The reference reads
 * it as the Japanese code page the engine's own names are kept in.
 */
export function exeCString(file: ExeFile, address: number): string | undefined {
	const section = addressSection(file, address);
	if (!section) return undefined;
	const rva = address - file.imageBase;
	const offset = section.rawOffset + (rva - section.virtualAddress);
	const size = section.rawOffset + section.rawSize - offset;
	const end = findExeString(file, { offset, size }, Buffer.from([0x00]));
	if (end < 0) return undefined;
	return file.data.toString("latin1", offset, end);
}
