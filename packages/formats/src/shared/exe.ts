// Shared helper for GARbro formats that read an archive from the overlay of a Windows executable.
// GARbro reference: ArcFormats/ExeFile.cs, `ExeFile.InitSectionTable` and `ExeFile.InitNe`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import type { ByteSource } from "@garbro-mcp/core";

/** Offset and size of the data appended behind an executable's last section. */
export interface ExecutableOverlay {
	offset: bigint;
	size: bigint;
}

const MZ_SIGNATURE = Buffer.from("MZ", "ascii");
const NE_SIGNATURE = Buffer.from("NE", "ascii");
const PE_SIGNATURE = Buffer.from("PE\0\0", "binary");
const DOS_HEADER_SIZE = 0x40;
const HEADER_POINTER_OFFSET = 0x3c;
/** The PE header has to fit comfortably before the end of the file. */
const PE_HEADER_MARGIN = 0x58;
const COFF_SECTION_COUNT = 6;
const COFF_OPTIONAL_SIZE = 0x14;
const PE_OPTIONS_OFFSET = 0x18;
const SECTION_TABLE_ENTRY_SIZE = 0x28;
const SECTION_RAW_SIZE = 0x10;
const SECTION_RAW_POINTER = 0x14;
/** 32-bit PE files keep `SizeOfHeaders` at this offset inside the optional header. */
const OPTIONAL_SIZE_OF_HEADERS = 0x3c;
const OVERLAY_ALIGNMENT = 0xf;
/** 16-bit NE files describe their segments with eight-byte entries. */
const NE_SEGMENT_COUNT = 0x1c;
const NE_SEGMENT_TABLE = 0x22;
const NE_ALIGNMENT_SHIFT = 0x32;
const NE_SEGMENT_ENTRY_SIZE = 8;

/**
 * Locates the overlay of a Windows executable, which is where several GARbro formats keep their
 * archives. A 16-bit NE image reports the end of its last segment, while a 32-bit PE image starts from
 * `SizeOfHeaders` and takes the end of the last section that actually occupies file space, rounded up
 * to a paragraph boundary and clamped to the file length.
 *
 * Returns `undefined` when the file is not a Windows executable or its headers cannot be parsed, which
 * mirrors the invalid-format exception the reference raises from `GetHeaderOffset`.
 */
export async function findExecutableOverlay(
	source: ByteSource,
): Promise<ExecutableOverlay | undefined> {
	if (source.size < BigInt(DOS_HEADER_SIZE)) return undefined;
	const dos = await source.readAt(0n, DOS_HEADER_SIZE);
	if (!dos.subarray(0, MZ_SIGNATURE.length).equals(MZ_SIGNATURE))
		return undefined;
	const headerOffset = BigInt(dos.readUInt32LE(HEADER_POINTER_OFFSET));

	// A 16-bit image announces itself with an NE header at the same pointer the PE header uses.
	if (headerOffset + BigInt(NE_SIGNATURE.length) <= source.size) {
		const neMagic = await source.readAt(headerOffset, NE_SIGNATURE.length);
		if (neMagic.equals(NE_SIGNATURE))
			return readNeOverlay(source, headerOffset);
	}

	if (headerOffset + BigInt(PE_HEADER_MARGIN) >= source.size) return undefined;
	const pe = await source.readAt(headerOffset, PE_HEADER_MARGIN);
	if (!pe.subarray(0, PE_SIGNATURE.length).equals(PE_SIGNATURE))
		return undefined;

	const sectionCount = pe.readUInt16LE(COFF_SECTION_COUNT);
	const optionalSize = pe.readUInt16LE(COFF_OPTIONAL_SIZE);
	const sectionTable = headerOffset + BigInt(optionalSize + PE_OPTIONS_OFFSET);
	let offset = BigInt(pe.readUInt32LE(OPTIONAL_SIZE_OF_HEADERS));
	if (
		sectionTable + BigInt(SECTION_TABLE_ENTRY_SIZE * sectionCount) <
		source.size
	) {
		const table = await source.readAt(
			sectionTable,
			SECTION_TABLE_ENTRY_SIZE * sectionCount,
		);
		for (let index = 0; index < sectionCount; index += 1) {
			const entry = index * SECTION_TABLE_ENTRY_SIZE;
			const rawSize = BigInt(table.readUInt32LE(entry + SECTION_RAW_SIZE));
			const rawPointer = BigInt(
				table.readUInt32LE(entry + SECTION_RAW_POINTER),
			);
			if (rawSize !== 0n)
				offset = rawPointer + rawSize > offset ? rawPointer + rawSize : offset;
		}
	}
	offset = (offset + BigInt(OVERLAY_ALIGNMENT)) & ~BigInt(OVERLAY_ALIGNMENT);
	if (offset > source.size) offset = source.size;
	return { offset, size: source.size - offset };
}

/** GARbro `ExeFile.InitNe`: the overlay begins where the last 16-bit segment ends. */
async function readNeOverlay(
	source: ByteSource,
	headerOffset: bigint,
): Promise<ExecutableOverlay | undefined> {
	const headerSize = NE_ALIGNMENT_SHIFT + 2;
	if (headerOffset + BigInt(headerSize) > source.size) return undefined;
	const header = await source.readAt(headerOffset, headerSize);
	const segmentCount = header.readUInt16LE(NE_SEGMENT_COUNT);
	const segmentTable =
		headerOffset + BigInt(header.readUInt16LE(NE_SEGMENT_TABLE));
	const shift = BigInt(header.readUInt16LE(NE_ALIGNMENT_SHIFT));
	const tableLength = segmentCount * NE_SEGMENT_ENTRY_SIZE;
	if (segmentTable + BigInt(tableLength) > source.size) return undefined;
	const table = await source.readAt(segmentTable, tableLength);
	let lastEnd = 0n;
	for (let index = 0; index < segmentCount; index += 1) {
		const entry = index * NE_SEGMENT_ENTRY_SIZE;
		const start = BigInt(table.readUInt16LE(entry)) << shift;
		const end = start + BigInt(table.readUInt16LE(entry + 2));
		if (end > lastEnd) lastEnd = end;
	}
	if (lastEnd > source.size) return undefined;
	return { offset: lastEnd, size: source.size - lastEnd };
}
