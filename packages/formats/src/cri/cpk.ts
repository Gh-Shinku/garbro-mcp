// Format reference: GARbro ArcFormats/Cri/ArcCPK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { decompressCrilayla } from "./crilayla.js";
import {
	decryptUtfChunk,
	parseUtfTable,
	type UtfRow,
	type UtfValue,
} from "./utf.js";

const CPK_SIGNATURE = Buffer.from("CPK ");
const CRILAYLA_SIGNATURE = Buffer.from("CRILAYLA");

interface CpkEntry extends ArchiveEntry {
	offset: bigint;
	numericId: number;
}

interface CpkDirectory {
	entries: CpkEntry[];
	contentOffset: bigint;
	hasNames: boolean;
}

export const cpkDescriptor: FormatDescriptor = {
	id: "cpk",
	name: "CRI Middleware CPK archive",
	extensions: ["cpk"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Cri/ArcCPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function field(row: UtfRow, name: string): UtfValue {
	const value = row[name];
	if (value === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", `CPK field is missing: ${name}`);
	}
	return value;
}

function integer(row: UtfRow, name: string): bigint {
	const value = field(row, name);
	if (typeof value !== "number" && typeof value !== "bigint") {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`CPK field is not numeric: ${name}`,
		);
	}
	const result = BigInt(value);
	if (result < 0n) {
		throw new GarbroError("INVALID_ARCHIVE", `CPK field is negative: ${name}`);
	}
	return result;
}

function optionalInteger(row: UtfRow, name: string): bigint | undefined {
	return row[name] === undefined ? undefined : integer(row, name);
}

function safeId(row: UtfRow): number {
	const value = integer(row, "ID");
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new GarbroError("INVALID_ARCHIVE", "CPK entry ID is too large");
	}
	return Number(value);
}

function stringField(row: UtfRow, name: string): string {
	const value = field(row, name);
	if (typeof value !== "string") {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`CPK field is not a string: ${name}`,
		);
	}
	return value;
}

function dataField(row: UtfRow, name: string): Buffer {
	const value = field(row, name);
	if (!Buffer.isBuffer(value)) {
		throw new GarbroError("INVALID_ARCHIVE", `CPK field is not data: ${name}`);
	}
	return value;
}

function makeEntry(
	id: number,
	path: string,
	offset: bigint,
	packedSize: bigint,
	size: bigint,
): CpkEntry {
	return {
		id: String(id),
		path: path.replaceAll("\\", "/"),
		...(path.includes("\\") ? { rawPath: path } : {}),
		size,
		packedSize,
		compressed: size !== packedSize,
		encrypted: false,
		offset,
		numericId: id,
	};
}

async function readUtfChunk(
	source: ByteSource,
	markerOffset: bigint,
): Promise<Buffer> {
	if (markerOffset > source.size || source.size - markerOffset < 12n) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"CPK UTF chunk header is truncated",
		);
	}
	const header = await source.readAt(markerOffset, 12);
	const length = header.readBigInt64LE(4);
	const dataOffset = markerOffset + 12n;
	if (
		length < 0n ||
		dataOffset > source.size ||
		length > source.size - dataOffset
	) {
		throw new GarbroError("INVALID_ARCHIVE", "CPK UTF chunk size is invalid");
	}
	const chunk = await source.readAt(
		dataOffset,
		bigintToBufferLength(length, "CPK UTF chunk"),
	);
	if (!chunk.subarray(0, 4).equals(Buffer.from("@UTF"))) decryptUtfChunk(chunk);
	return chunk;
}

function validatePlacement(
	source: ByteSource,
	offset: bigint,
	packedSize: bigint,
	path: string,
): void {
	if (offset > source.size || packedSize > source.size - offset) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`CPK entry points outside the archive: ${path}`,
		);
	}
}

async function readToc(
	source: ByteSource,
	tocOffset: bigint,
	contentOffset: bigint,
	entries: Map<number, CpkEntry>,
): Promise<void> {
	const marker = await source.readAt(tocOffset, 4);
	if (!marker.equals(Buffer.from("TOC "))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid CPK TOC marker");
	}
	const baseOffset = contentOffset < tocOffset ? contentOffset : tocOffset;
	for (const row of parseUtfTable(await readUtfChunk(source, tocOffset + 4n))) {
		const id = safeId(row);
		const filename = stringField(row, "FileName");
		const directory =
			typeof row.DirName === "string" && row.DirName ? row.DirName : undefined;
		const path = directory ? `${directory}/${filename}` : filename;
		const packedSize = integer(row, "FileSize");
		const size = optionalInteger(row, "ExtractSize") ?? packedSize;
		const offset = integer(row, "FileOffset") + baseOffset;
		validatePlacement(source, offset, packedSize, path);
		entries.set(id, makeEntry(id, path, offset, packedSize, size));
	}
}

function align(value: bigint, alignment: bigint): bigint {
	if (alignment === 0n) return value;
	const remainder = value % alignment;
	return remainder === 0n ? value : value + alignment - remainder;
}

async function readItoc(
	source: ByteSource,
	itocOffset: bigint,
	contentOffset: bigint,
	alignment: bigint,
	entries: Map<number, CpkEntry>,
): Promise<void> {
	const marker = await source.readAt(itocOffset, 4);
	if (!marker.equals(Buffer.from("ITOC"))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid CPK ITOC marker");
	}
	const table = parseUtfTable(await readUtfChunk(source, itocOffset + 4n));
	const header = table[0];
	if (!header) throw new GarbroError("INVALID_ARCHIVE", "CPK ITOC is empty");
	const rows = [
		...parseUtfTable(dataField(header, "DataL")),
		...parseUtfTable(dataField(header, "DataH")),
	];
	for (const row of rows) {
		const id = safeId(row);
		const packedSize = integer(row, "FileSize");
		const size = optionalInteger(row, "ExtractSize") ?? packedSize;
		const existing = entries.get(id);
		entries.set(
			id,
			makeEntry(
				id,
				existing?.path ?? id.toString().padStart(5, "0"),
				0n,
				packedSize,
				size,
			),
		);
	}

	let offset = contentOffset;
	for (const entry of [...entries.values()].sort(
		(left, right) => left.numericId - right.numericId,
	)) {
		entry.offset = offset;
		validatePlacement(source, entry.offset, entry.packedSize, entry.path);
		offset = align(offset + entry.packedSize, alignment);
	}
}

async function readDirectory(source: ByteSource): Promise<CpkDirectory> {
	if (
		source.size < 16n ||
		!(await source.readAt(0n, 4)).equals(CPK_SIGNATURE)
	) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid CPK signature");
	}
	const headerRows = parseUtfTable(await readUtfChunk(source, 4n));
	const header = headerRows[0];
	if (!header)
		throw new GarbroError("INVALID_ARCHIVE", "CPK header table is empty");
	const contentOffset = integer(header, "ContentOffset");
	const entries = new Map<number, CpkEntry>();
	const tocOffset = optionalInteger(header, "TocOffset");
	if (tocOffset !== undefined && tocOffset !== 0n) {
		await readToc(source, tocOffset, contentOffset, entries);
	}
	const itocOffset = optionalInteger(header, "ItocOffset");
	if (itocOffset !== undefined && itocOffset !== 0n) {
		await readItoc(
			source,
			itocOffset,
			contentOffset,
			optionalInteger(header, "Align") ?? 0n,
			entries,
		);
	}
	if (entries.size === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "CPK archive contains no entries");
	}
	return {
		entries: [...entries.values()].sort(
			(left, right) => left.numericId - right.numericId,
		),
		contentOffset,
		hasNames: tocOffset !== undefined && tocOffset !== 0n,
	};
}

class CpkArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = cpkDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly CpkEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, directory: CpkDirectory) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = {
			contentOffset: directory.contentOffset.toString(),
			hasNames: directory.hasNames,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		if (entry.packedSize >= 16n) {
			const signature = await this.#source.readAt(entry.offset, 8);
			if (signature.equals(CRILAYLA_SIGNATURE)) {
				const packed = await this.#source.readAt(
					entry.offset,
					bigintToBufferLength(entry.packedSize, "CRILAYLA entry"),
				);
				const output = decompressCrilayla(packed);
				if (BigInt(output.length) !== entry.size) {
					throw new GarbroError(
						"INVALID_ARCHIVE",
						`CRILAYLA output size mismatch for ${entry.path}`,
					);
				}
				return Readable.from([output]);
			}
		}
		if (entry.compressed) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Unknown CPK compression for ${entry.path}`,
			);
		}
		return this.#source.createReadStream(entry.offset, entry.packedSize);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class CpkFormat implements ArchiveFormat {
	readonly descriptor = cpkDescriptor;
	readonly detection = { signatures: [{ bytes: CPK_SIGNATURE }] };

	async detect(source: ByteSource): Promise<boolean> {
		return (
			source.size >= 16n && (await source.readAt(0n, 4)).equals(CPK_SIGNATURE)
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new CpkArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source),
		);
	}
}
