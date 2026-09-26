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
/** The optional header announces a 32-bit image with this magic. */
const OPTIONAL_HEADER_OFFSET = 0x18;
const OPTIONAL_HEADER_MAGIC = 0x010b;
const OPTIONAL_HEADER_IMAGE_BASE = OPTIONAL_HEADER_OFFSET + 0x1c;
const SECTION_VIRTUAL_ADDRESS = 0xc;

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

/**
 * Translates a virtual address inside a 32-bit PE image into a file offset, mirroring
 * `ExeFile.GetAddressOffset` and `ExeFile.GetAddressSection`. Returns `undefined` when the file is not
 * a 32-bit PE image, when the address lies below the image base, or when no section covers it.
 *
 * Note that the reference matches sections by their raw size rather than their virtual size, which this
 * function reproduces.
 */
export async function findExecutableAddressOffset(
	source: ByteSource,
	address: number,
): Promise<bigint | undefined> {
	if (source.size < BigInt(DOS_HEADER_SIZE)) return undefined;
	const dos = await source.readAt(0n, DOS_HEADER_SIZE);
	if (!dos.subarray(0, MZ_SIGNATURE.length).equals(MZ_SIGNATURE))
		return undefined;
	const headerOffset = BigInt(dos.readUInt32LE(HEADER_POINTER_OFFSET));
	if (headerOffset + BigInt(PE_HEADER_MARGIN) >= source.size) return undefined;
	const pe = await source.readAt(headerOffset, PE_HEADER_MARGIN);
	if (!pe.subarray(0, PE_SIGNATURE.length).equals(PE_SIGNATURE))
		return undefined;
	if (pe.readUInt16LE(OPTIONAL_HEADER_OFFSET) !== OPTIONAL_HEADER_MAGIC)
		return undefined;
	const imageBase = pe.readUInt32LE(OPTIONAL_HEADER_IMAGE_BASE);
	if (address < imageBase) return undefined;
	const rva = BigInt(address - imageBase);
	const sectionCount = pe.readUInt16LE(COFF_SECTION_COUNT);
	const optionalSize = pe.readUInt16LE(COFF_OPTIONAL_SIZE);
	const sectionTable = headerOffset + BigInt(optionalSize + PE_OPTIONS_OFFSET);
	if (
		sectionTable + BigInt(SECTION_TABLE_ENTRY_SIZE * sectionCount) >=
		source.size
	)
		return undefined;
	const table = await source.readAt(
		sectionTable,
		SECTION_TABLE_ENTRY_SIZE * sectionCount,
	);
	for (let index = 0; index < sectionCount; index += 1) {
		const entry = index * SECTION_TABLE_ENTRY_SIZE;
		const virtualAddress = BigInt(
			table.readUInt32LE(entry + SECTION_VIRTUAL_ADDRESS),
		);
		const rawSize = BigInt(table.readUInt32LE(entry + SECTION_RAW_SIZE));
		if (rva < virtualAddress || rva >= virtualAddress + rawSize) continue;
		const pointer = BigInt(table.readUInt32LE(entry + SECTION_RAW_POINTER));
		return pointer + (rva - virtualAddress);
	}
	return undefined;
}

// The resource tree of a Windows executable, read from the layout of the file rather than from the platform:
// GARbro's `ExeFile.ResourceAccessor` asks Windows for a resource (`LoadLibraryEx`, `FindResource`,
// `LoadResource`), so the reader below is written from the format of a portable executable rather than ported
// from the reference. A resource stands three levels down: its kind, its name and its language, and the leaf
// of that walk names the bytes of the resource and where they lie.

/** One resource of an executable: its kind, its name, its language and its bytes. */
export interface ExecutableResource {
	/** The kind of the resource: a name, or the number of a numbered kind such as `RCDATA`. */
	type: string | number;
	/** The name of the resource: a name, or a number. */
	name: string | number;
	language: number;
	data: Buffer;
}

/** The magic of the optional header stands at its own start: the field that says which kind of image it is. */
const PE_OPTIONAL_MAGIC_32 = 0x010b;
const PE_OPTIONAL_MAGIC_64 = 0x020b;
/** Where the data directories start inside the optional header, for a 32 bit and a 64 bit image. */
const PE_DIRECTORIES_32 = 0x60;
const PE_DIRECTORIES_64 = 0x70;
/** The resource table is the third entry of the data directories. */
const PE_RESOURCE_DIRECTORY = 2;
const PE_DIRECTORY_ENTRY_SIZE = 8;
const COFF_SECTION_COUNT_OFFSET = 6;
const COFF_OPTIONAL_SIZE_OFFSET = 0x14;
const PE_OPTIONAL_OFFSET = 0x18;
const RESOURCE_HEADER_SIZE = 0x10;
const RESOURCE_ENTRY_SIZE = 8;
const RESOURCE_DATA_SIZE = 0x10;
const RESOURCE_STRING_LENGTH = 2;
const RESOURCE_NAMED_AT = 0x0c;
const RESOURCE_ID_AT = 0x0e;
const RESOURCE_HIGH_BIT = 0x80000000;
const RESOURCE_OFFSET_MASK = 0x7fffffff;
const RESOURCE_LEVELS = 2;
/** The most resources one executable may carry here, and the most bytes one of them may hold. */
const RESOURCE_COUNT_LIMIT = 0x1000;
const RESOURCE_SIZE_LIMIT = 0x1000000;

/** Whether the two bytes of a stream are the start of a Windows executable. */
function isExecutable(data: Buffer): boolean {
	return (
		data.length >= DOS_HEADER_SIZE &&
		data.subarray(0, MZ_SIGNATURE.length).equals(MZ_SIGNATURE)
	);
}

/** The place of the section table of a 32 or 64 bit image, or undefined when the head is not one. */
function readSectionTable(data: Buffer):
	| {
			tableAt: number;
			count: number;
			directoriesAt: number;
	  }
	| undefined {
	if (!isExecutable(data)) return undefined;
	const peAt = data.readUInt32LE(HEADER_POINTER_OFFSET);
	if (peAt + PE_OPTIONAL_OFFSET + 2 > data.length) return undefined;
	if (!data.subarray(peAt, peAt + PE_SIGNATURE.length).equals(PE_SIGNATURE)) {
		return undefined;
	}
	const count = data.readUInt16LE(peAt + COFF_SECTION_COUNT_OFFSET);
	const optionalSize = data.readUInt16LE(peAt + COFF_OPTIONAL_SIZE_OFFSET);
	const optionalAt = peAt + PE_OPTIONAL_OFFSET;
	const magic = data.readUInt16LE(optionalAt);
	const directoriesAt =
		PE_OPTIONAL_MAGIC_32 === magic
			? optionalAt + PE_DIRECTORIES_32
			: PE_OPTIONAL_MAGIC_64 === magic
				? optionalAt + PE_DIRECTORIES_64
				: 0;
	if (0 === directoriesAt) return undefined;
	return { tableAt: optionalAt + optionalSize, count, directoriesAt };
}

/** The place, in the file, of the bytes a place in the image names. */
function imageToFile(
	data: Buffer,
	tableAt: number,
	count: number,
	rva: number,
): number | undefined {
	for (let index = 0; index < count; index += 1) {
		const at = tableAt + index * SECTION_TABLE_ENTRY_SIZE;
		if (at + SECTION_TABLE_ENTRY_SIZE > data.length) return undefined;
		const virtualAddress = data.readUInt32LE(at + SECTION_VIRTUAL_ADDRESS);
		const virtualSize = data.readUInt32LE(at + 8);
		const rawSize = data.readUInt32LE(at + SECTION_RAW_SIZE);
		const span = Math.max(virtualSize, rawSize);
		if (rva < virtualAddress || rva >= virtualAddress + span) continue;
		const pointer = data.readUInt32LE(at + SECTION_RAW_POINTER);
		return pointer + (rva - virtualAddress);
	}
	return undefined;
}

/** One label of the resource tree: a name, or the number of a named entry. */
function readResourceLabel(
	data: Buffer,
	base: number,
	field: number,
): string | number {
	if (0 === (field & RESOURCE_HIGH_BIT)) return field;
	const at = base + (field & RESOURCE_OFFSET_MASK);
	if (at + RESOURCE_STRING_LENGTH > data.length) return "";
	const length = data.readUInt16LE(at);
	if (at + RESOURCE_STRING_LENGTH + length * 2 > data.length) return "";
	return data
		.subarray(
			at + RESOURCE_STRING_LENGTH,
			at + RESOURCE_STRING_LENGTH + length * 2,
		)
		.toString("utf16le");
}

/**
 * Reads the resource tree of a Windows executable, or undefined when the stream is not one or carries no
 * resource table. A walk deeper than the three levels a resource has is left alone, and a table with more
 * entries than the limit, or a resource longer than it, ends the read.
 */
export function readExecutableResources(
	data: Buffer,
): ExecutableResource[] | undefined {
	const head = readSectionTable(data);
	if (!head) return undefined;
	const directoryAt =
		head.directoriesAt + PE_RESOURCE_DIRECTORY * PE_DIRECTORY_ENTRY_SIZE;
	if (directoryAt + PE_DIRECTORY_ENTRY_SIZE > data.length) return undefined;
	const rva = data.readUInt32LE(directoryAt);
	if (0 === rva) return undefined;
	const base = imageToFile(data, head.tableAt, head.count, rva);
	if (undefined === base) return undefined;
	const resources: ExecutableResource[] = [];
	const walk = (at: number, depth: number, path: (string | number)[]): void => {
		if (at + RESOURCE_HEADER_SIZE > data.length) return;
		const named = data.readUInt16LE(at + RESOURCE_NAMED_AT);
		const numbered = data.readUInt16LE(at + RESOURCE_ID_AT);
		const entries = named + numbered;
		if (entries > RESOURCE_COUNT_LIMIT) return;
		for (let index = 0; index < entries; index += 1) {
			const entryAt = at + RESOURCE_HEADER_SIZE + index * RESOURCE_ENTRY_SIZE;
			if (entryAt + RESOURCE_ENTRY_SIZE > data.length) return;
			const label = readResourceLabel(data, base, data.readUInt32LE(entryAt));
			const field = data.readUInt32LE(entryAt + 4);
			const next = base + (field & RESOURCE_OFFSET_MASK);
			if (0 !== (field & RESOURCE_HIGH_BIT)) {
				if (depth < RESOURCE_LEVELS) {
					walk(next, depth + 1, [...path, label]);
				}
				continue;
			}
			if (
				RESOURCE_LEVELS !== depth ||
				next + RESOURCE_DATA_SIZE > data.length
			) {
				continue;
			}
			const dataRva = data.readUInt32LE(next);
			const size = data.readUInt32LE(next + 4);
			if (size > RESOURCE_SIZE_LIMIT) continue;
			const dataAt = imageToFile(data, head.tableAt, head.count, dataRva);
			if (undefined === dataAt || dataAt + size > data.length) continue;
			resources.push({
				type: path[0] ?? 0,
				name: path[1] ?? 0,
				language: "number" === typeof label ? label : 0,
				data: data.subarray(dataAt, dataAt + size),
			});
		}
	};
	walk(base, 0, []);
	return resources;
}

/**
 * The label of a resource, as the reference writes one: its own `ResourceNameToString` writes a numbered
 * entry as `#` and the number, so a caller that reads its own listing back names the number that way. A name
 * that stands for itself is taken as it is.
 */
export function parseResourceLabel(label: string | number): string | number {
	if ("number" === typeof label) return label;
	if (!label.startsWith("#")) return label;
	const value = Number.parseInt(label.slice(1), 10);
	return Number.isNaN(value) ? label : value;
}

/** Whether two resource labels name the same entry; names stand against each other without their case. */
function sameResourceLabel(
	left: string | number,
	right: string | number,
): boolean {
	if ("number" === typeof left || "number" === typeof right)
		return left === right;
	return left.toLowerCase() === right.toLowerCase();
}

/**
 * The bytes of one resource of an executable. `name` and `type` may each be a name or a number, and a number
 * written as `#10` stands for the number, which is how the reference writes one. A kind given as nothing
 * stands for any kind, and the first match wins, which is the language Windows would pick last.
 */
export function findExecutableResource(
	data: Buffer,
	query: { name?: string | number; type?: string | number },
): Buffer | undefined {
	const resources = readExecutableResources(data);
	if (!resources) return undefined;
	const name =
		undefined === query.name ? undefined : parseResourceLabel(query.name);
	const type =
		undefined === query.type ? undefined : parseResourceLabel(query.type);
	for (const resource of resources) {
		if (undefined !== type && !sameResourceLabel(resource.type, type)) continue;
		if (undefined !== name && !sameResourceLabel(resource.name, name)) continue;
		return resource.data;
	}
	return undefined;
}
