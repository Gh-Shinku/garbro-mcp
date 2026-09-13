// Format reference: GARbro ArcFormats/Tmr-Hiro/ArcPAC.cs, class `PacOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_FIELD = 0;
const NAME_LENGTH_FIELD = 2;
const DATA_OFFSET_FIELD = 3;
const INDEX_START = 7;
/** Version 1 records hold a 32-bit offset; version 2 records a 64-bit one. */
const V1_RECORD_TAIL = 8;
const V2_RECORD_TAIL = 12;
/** The probe window the reference reads while guessing an entry's type. */
const PROBE_SIZE = 10;

const OGG_SIGNATURE = 0x5367674f;
const WAVE_FIRST_BYTE = 0x44;
const WAVE_SIZE_FIELD = 5;
const WAVE_SIZE_BIAS = 9;
const SCRIPT_MARKER = 6;
const SCRIPT_MAGIC = 0x140050;
/** Script chunks are nibble-swapped behind a six-byte record header. */
const SCRIPT_RECORD_HEADER = 6;
const CHUNK_SIZE_BIAS = 4;

interface TmrHiroMetadata extends Record<string, unknown> {
	type?: string;
	version: number;
}

function tmrHiroMetadata(entry: FixedEntry): TmrHiroMetadata {
	const metadata = entry.metadata ?? {};
	return {
		...(metadata.type === undefined ? {} : { type: String(metadata.type) }),
		version: Number(metadata.version ?? 0),
	};
}

/** GARbro `Binary.RotByteR` with a count of four, which is a nibble swap. */
function swapNibbles(value: number): number {
	return ((value >>> 4) | (value << 4)) & 0xff;
}

/**
 * GARbro `PacOpener.TryOpen`. A 16-bit count, a name length and the payload offset open the file, and the
 * offset decides the version: it points either straight behind the index or behind an extra 32-bit offset
 * per record for version 2. Both versions share the fixed-width name field.
 *
 * Every entry's payload is then probed for a type, which can also rename it: an Ogg signature or a wave
 * header in a `grd` archive marks audio or an image, and a script header marks a script, which a `srp`
 * archive also names accordingly.
 */
async function readTmrHiroIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	const count = header.readInt16LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const nameLength = header[NAME_LENGTH_FIELD] ?? 0;
	if (nameLength === 0) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_FIELD));
	if (dataOffset >= source.size) return undefined;
	const baseIndexSize = BigInt(
		INDEX_START + (nameLength + V1_RECORD_TAIL) * count,
	);
	let version: 1 | 2;
	if (dataOffset === baseIndexSize) version = 1;
	else if (dataOffset === baseIndexSize + BigInt(4 * count)) version = 2;
	else return undefined;

	const entries: FixedEntry[] = [];
	let cursor = BigInt(INDEX_START);
	for (let id = 0; id < count; id += 1) {
		if (cursor + BigInt(nameLength) > source.size) return undefined;
		const name = decodeCStringField(
			Buffer.from(await source.readAt(cursor, nameLength)),
			0,
			nameLength,
		);
		cursor += BigInt(nameLength);
		const tail = version === 1 ? V1_RECORD_TAIL : V2_RECORD_TAIL;
		if (cursor + BigInt(tail) > source.size) return undefined;
		const record = await source.readAt(cursor, tail);
		const offset =
			dataOffset +
			(version === 1
				? BigInt(record.readUInt32LE(0))
				: record.readBigInt64LE(0));
		const storedSize = BigInt(record.readUInt32LE(version === 1 ? 4 : 8));
		cursor += BigInt(tail);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				path: name,
				offset,
				size: storedSize,
				packedSize: storedSize,
				metadata: { version } satisfies TmrHiroMetadata,
			}),
		);
	}

	const archiveName = basename(sourcePath)
		.replace(/\.[^.]*$/, "")
		.toLowerCase();
	for (const entry of entries) {
		// The probe needs the same ten bytes the reference reads; a payload too close to the end of the
		// archive keeps its name and type instead of throwing like the reference would.
		if (entry.offset + BigInt(PROBE_SIZE) > source.size) continue;
		const probe = await source.readAt(entry.offset, PROBE_SIZE);
		const signature = probe.readUInt32LE(0);
		const metadata = tmrHiroMetadata(entry);
		if (signature === OGG_SIGNATURE) {
			entry.path = changeExtension(entry.path, "ogg");
			entry.metadata = { ...metadata, type: "audio" };
		} else if (
			((signature & 0xff) === 1 || (signature & 0xff) === 2) &&
			archiveName.includes("grd")
		) {
			entry.path = changeExtension(entry.path, "grd");
			entry.metadata = { ...metadata, type: "image" };
		} else if (
			(signature & 0xff) === WAVE_FIRST_BYTE &&
			entry.size - BigInt(WAVE_SIZE_BIAS) ===
				BigInt(probe.readUInt32LE(WAVE_SIZE_FIELD))
		) {
			entry.metadata = { ...metadata, type: "audio" };
		} else if (
			probe.readInt16LE(4) === SCRIPT_MARKER &&
			probe.readUInt32LE(6) === SCRIPT_MAGIC
		) {
			entry.metadata = { ...metadata, type: "script" };
			if (archiveName === "srp")
				entry.path = changeExtension(entry.path, "srp");
		}
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARbro `PacOpener.OpenEntry`. Only scripts are transformed: a 32-bit record count opens the payload and
 * every record is a 16-bit chunk size with a six-byte header, whose bytes are nibble-swapped. A chunk that
 * would reach past the payload makes the reference fall back to the stored bytes, and so does this port.
 */
function decodeScript(data: Buffer): Buffer | undefined {
	// The reference allocates a separate output buffer and abandons it when a chunk reaches past the
	// payload, so a partially decoded payload is never returned.
	const output = Buffer.from(data);
	const recordCount = output.readInt32LE(0);
	let position = 4;
	for (
		let index = 0;
		index < recordCount && position + 2 <= output.length;
		index += 1
	) {
		const chunkSize = output.readUInt16LE(position) - CHUNK_SIZE_BIAS;
		position += SCRIPT_RECORD_HEADER;
		if (position + chunkSize > output.length) return undefined;
		for (let offset = 0; offset < chunkSize; offset += 1) {
			output[position] = swapNibbles(output[position] ?? 0);
			position += 1;
		}
	}
	return output;
}

class TmrHiroArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = tmrHiroPacDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: FixedEntry[]) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.metadata = {
			entryCount: entries.length,
			version: tmrHiroMetadata(entries[0] ?? ({ metadata: {} } as FixedEntry))
				.version,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const data = Buffer.from(
			await this.#source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (tmrHiroMetadata(entry).type !== "script") return Readable.from([data]);
		if (
			data.length < PROBE_SIZE ||
			data.readInt16LE(4) !== SCRIPT_MARKER ||
			data.readUInt32LE(6) !== SCRIPT_MAGIC
		)
			return Readable.from([data]);
		return Readable.from([decodeScript(data) ?? data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const tmrHiroPacDescriptor: FormatDescriptor = {
	id: "tmr-hiro-pac",
	name: "Tmr-Hiro ADV System resource archive",
	extensions: ["pac"],
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
			source: "ArcFormats/Tmr-Hiro/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tmrHiroPacFormat: ArchiveFormat = {
	descriptor: tmrHiroPacDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readTmrHiroIndex(source, sourcePath)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const entries = await readTmrHiroIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tmr-Hiro PAC layout");
		return new TmrHiroArchiveHandle(source, sourcePath, entries);
	},
};
