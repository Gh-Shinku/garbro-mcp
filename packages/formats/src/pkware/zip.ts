// Format reference: GARbro ArcFormats/PkWare/ArcZIP.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// GARbro delegates ZIP parsing to SharpZipLib with the default code page 932 for non-UTF-8 names.
// This port implements the central-directory walk directly and streams entries with Node's
// inflate-raw.

import {
	decodeCp932,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import type { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = Buffer.from("PK\x05\x06", "binary");
const CENTRAL_DIRECTORY_ENTRY = Buffer.from("PK\x01\x02", "binary");
const LOCAL_FILE_HEADER = Buffer.from("PK\x03\x04", "binary");
const ZIP64_END_OF_CENTRAL_DIRECTORY = Buffer.from("PK\x06\x06", "binary");
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = Buffer.from(
	"PK\x06\x07",
	"binary",
);
const EOCD_SIZE = 0x16;
const MAXIMUM_TAIL_SIZE = 0x10016;
const ZIP64_EXTRA_FIELD = 0x0001;
const MAXIMUM_ENTRY_COUNT = 0x40000;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;

export const zipDescriptor: FormatDescriptor = {
	id: "zip",
	name: "PKWARE archive format",
	extensions: ["zip", "vndat"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/PkWare/ArcZIP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface ZipEntry extends ArchiveEntry {
	offset: bigint;
	method: number;
	flags: number;
	crc32: number;
	localHeaderOffset: bigint;
}

interface EndOfCentralDirectory {
	entryCount: number;
	directoryOffset: bigint;
	directorySize: bigint;
	eocdOffset: bigint;
}

function findSignatureBackwards(tail: Buffer, signature: Buffer): number {
	for (let position = tail.length - EOCD_SIZE; position >= 0; position -= 1) {
		if (tail.subarray(position, position + signature.length).equals(signature))
			return position;
	}
	return -1;
}

async function readEndOfCentralDirectory(
	source: ByteSource,
): Promise<EndOfCentralDirectory | undefined> {
	const tailSize = Number(
		source.size < BigInt(MAXIMUM_TAIL_SIZE)
			? source.size
			: BigInt(MAXIMUM_TAIL_SIZE),
	);
	if (tailSize < EOCD_SIZE) return undefined;
	const tailOffset = source.size - BigInt(tailSize);
	const tail = await source.readAt(tailOffset, tailSize);
	const position = findSignatureBackwards(tail, END_OF_CENTRAL_DIRECTORY);
	if (position === -1) return undefined;
	const eocd = tail.subarray(position, position + EOCD_SIZE);
	let entryCount = eocd.readUInt16LE(10);
	let directorySize = BigInt(eocd.readUInt32LE(12));
	let directoryOffset = BigInt(eocd.readUInt32LE(16));
	const eocdOffset = tailOffset + BigInt(position);
	if (
		entryCount === 0xffff ||
		directoryOffset === 0xffffffffn ||
		directorySize === 0xffffffffn
	) {
		const zip64 = await readZip64EndOfCentralDirectory(source, tail, position);
		if (!zip64) return undefined;
		entryCount = zip64.entryCount;
		directorySize = zip64.directorySize;
		directoryOffset = zip64.directoryOffset;
	}
	if (entryCount > MAXIMUM_ENTRY_COUNT) return undefined;
	if (directoryOffset + directorySize > source.size) return undefined;
	return { entryCount, directoryOffset, directorySize, eocdOffset };
}

async function readZip64EndOfCentralDirectory(
	source: ByteSource,
	tail: Buffer,
	eocdPosition: number,
): Promise<
	| { entryCount: number; directorySize: bigint; directoryOffset: bigint }
	| undefined
> {
	const locatorPosition = tail.lastIndexOf(
		ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR,
		eocdPosition,
	);
	if (locatorPosition < 0) return undefined;
	const locator = tail.subarray(locatorPosition, locatorPosition + 20);
	const recordOffset = locator.readBigUInt64LE(8);
	if (recordOffset + 56n > source.size) return undefined;
	const record = await source.readAt(recordOffset, 56);
	if (!record.subarray(0, 4).equals(ZIP64_END_OF_CENTRAL_DIRECTORY))
		return undefined;
	const entryCount = Number(record.readBigUInt64LE(32));
	const directorySize = record.readBigUInt64LE(40);
	const directoryOffset = record.readBigUInt64LE(48);
	return { entryCount, directorySize, directoryOffset };
}

interface Zip64Values {
	unpackedSize?: bigint;
	packedSize?: bigint;
	localHeaderOffset?: bigint;
}

function parseZip64Extra(extra: Buffer): Zip64Values {
	const values: Zip64Values = {};
	let position = 0;
	while (position + 4 <= extra.length) {
		const id = extra.readUInt16LE(position);
		const size = extra.readUInt16LE(position + 2);
		position += 4;
		if (position + size > extra.length) break;
		if (id === ZIP64_EXTRA_FIELD) {
			const field = extra.subarray(position, position + size);
			let fieldPosition = 0;
			if (fieldPosition + 8 <= field.length) {
				values.unpackedSize = field.readBigUInt64LE(fieldPosition);
				fieldPosition += 8;
			}
			if (fieldPosition + 8 <= field.length) {
				values.packedSize = field.readBigUInt64LE(fieldPosition);
				fieldPosition += 8;
			}
			if (fieldPosition + 8 <= field.length) {
				values.localHeaderOffset = field.readBigUInt64LE(fieldPosition);
				fieldPosition += 8;
			}
		}
		position += size;
	}
	return values;
}

function decodeName(name: Buffer, flags: number): string {
	if ((flags & FLAG_UTF8) !== 0) return name.toString("utf8");
	return decodeCp932(name);
}

async function readDirectory(
	source: ByteSource,
	eocd: EndOfCentralDirectory,
): Promise<ZipEntry[]> {
	const directory = await source.readAt(
		eocd.directoryOffset,
		Number(eocd.directorySize),
	);
	const entries: ZipEntry[] = [];
	let recordCount = 0;
	let position = 0;
	while (position + 46 <= directory.length && recordCount < eocd.entryCount) {
		if (
			!directory
				.subarray(position, position + 4)
				.equals(CENTRAL_DIRECTORY_ENTRY)
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ZIP central directory entry signature is invalid",
			);
		}
		const flags = directory.readUInt16LE(position + 8);
		const method = directory.readUInt16LE(position + 10);
		const crc32 = directory.readUInt32LE(position + 16);
		let packedSize = BigInt(directory.readUInt32LE(position + 20));
		let unpackedSize = BigInt(directory.readUInt32LE(position + 24));
		const nameLength = directory.readUInt16LE(position + 28);
		const extraLength = directory.readUInt16LE(position + 30);
		const commentLength = directory.readUInt16LE(position + 32);
		let localHeaderOffset = BigInt(directory.readUInt32LE(position + 42));
		const nameStart = position + 46;
		if (
			nameStart + nameLength + extraLength + commentLength >
			directory.length
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ZIP central directory is truncated",
			);
		}
		const name = decodeName(
			directory.subarray(nameStart, nameStart + nameLength),
			flags,
		);
		const extra = directory.subarray(
			nameStart + nameLength,
			nameStart + nameLength + extraLength,
		);
		if (
			packedSize === 0xffffffffn ||
			unpackedSize === 0xffffffffn ||
			localHeaderOffset === 0xffffffffn
		) {
			const zip64 = parseZip64Extra(extra);
			unpackedSize = zip64.unpackedSize ?? unpackedSize;
			packedSize = zip64.packedSize ?? packedSize;
			localHeaderOffset = zip64.localHeaderOffset ?? localHeaderOffset;
		}
		position = nameStart + nameLength + extraLength + commentLength;
		recordCount += 1;
		if (name.endsWith("/")) continue;
		const encrypted = (flags & FLAG_ENCRYPTED) !== 0;
		entries.push({
			id: String(entries.length),
			path: name.replaceAll("\\", "/"),
			size: unpackedSize,
			packedSize,
			compressed: method !== METHOD_STORED,
			encrypted,
			offset: 0n,
			method,
			flags,
			crc32,
			localHeaderOffset,
		});
	}
	if (recordCount !== eocd.entryCount) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"ZIP central directory entry count does not match the end record",
		);
	}
	return entries;
}

async function openZipEntry(
	source: ByteSource,
	entry: ZipEntry,
): Promise<Readable> {
	if (entry.encrypted) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`ZIP entry is encrypted: ${entry.path}`,
		);
	}
	if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`ZIP compression method ${entry.method} is not supported: ${entry.path}`,
		);
	}
	if (entry.localHeaderOffset + 30n > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "ZIP local header is truncated");
	}
	const localHeader = await source.readAt(entry.localHeaderOffset, 30);
	if (!localHeader.subarray(0, 4).equals(LOCAL_FILE_HEADER)) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`ZIP local header signature is invalid: ${entry.path}`,
		);
	}
	const nameLength = localHeader.readUInt16LE(26);
	const extraLength = localHeader.readUInt16LE(28);
	const dataOffset =
		entry.localHeaderOffset + 30n + BigInt(nameLength + extraLength);
	if (dataOffset + entry.packedSize > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`ZIP entry data points outside the archive: ${entry.path}`,
		);
	}
	if (entry.method === METHOD_STORED) {
		return source.createReadStream(dataOffset, entry.packedSize);
	}
	const compressed = source.createReadStream(dataOffset, entry.packedSize);
	return compressed.pipe(createInflateRaw());
}

class ZipArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = zipDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly ZipEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: ZipEntry[]) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.metadata = { entryCount: entries.length };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		return openZipEntry(this.#source, entry);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class ZipFormat implements ArchiveFormat {
	readonly descriptor = zipDescriptor;
	readonly detection = { extensionFallback: true };

	async detect(source: ByteSource): Promise<boolean> {
		const eocd = await readEndOfCentralDirectory(source);
		return eocd !== undefined;
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const eocd = await readEndOfCentralDirectory(source);
		if (!eocd) {
			throw new GarbroError("INVALID_ARCHIVE", "ZIP end record was not found");
		}
		const entries = await readDirectory(source, eocd);
		return new ZipArchiveHandle(source, sourcePath, entries);
	}
}

export const zipFormat: ArchiveFormat = new ZipFormat();
