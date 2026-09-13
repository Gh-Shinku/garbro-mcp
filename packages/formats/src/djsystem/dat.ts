// Format reference: GARBro ArcFormats/DjSystem/ArcDAT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("FILECMB-DATA-LIST-IN", "ascii");
const INDEX_END = "LIST-END";
const ENTRY_PATTERN = /^(\S+)\t(\d+)\s*\t(\d+)/;
const AUDIO_EXTENSION = "vic";
const SCRIPT_MARKER = Buffer.from("DJCODE NLINE-", "ascii");
const ENCODE_MARKER = Buffer.from("ENCODE\n", "ascii");
const NO_ENCODE_MARKER = Buffer.from("NO-ENCODE\n", "ascii");
const ENCODE_HEADER_SIZE = 20;
const NO_ENCODE_HEADER_SIZE = 23;
const XOR_KEY = 0xff;

export const djDatDescriptor: FormatDescriptor = {
	id: "djsystem-dat",
	name: "DJSYSTEM engine resource archive",
	extensions: [],
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
			source: "ArcFormats/DjSystem/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface DjPayload {
	kind: "raw" | "encode" | "no-encode";
	decoded?: Buffer;
}

/** Applies the `NO-ENCODE` transform: CRLF pairs collapse, everything else is XORed. */
function decodeNoEncode(payload: Buffer): Buffer {
	const output = Buffer.alloc(payload.length);
	let length = 0;
	for (let position = 0; position < payload.length; position += 1) {
		const value = payload[position] ?? 0;
		if (value === 0x0d && (payload[position + 1] ?? 0) === 0x0a) continue;
		output[length] = value ^ XOR_KEY;
		length += 1;
	}
	return output.subarray(0, length);
}

/** Classifies one entry payload the way GARbro's opener does. */
async function inspectPayload(
	source: ByteSource,
	entry: FixedEntry,
): Promise<DjPayload | undefined> {
	const markerLength = NO_ENCODE_HEADER_SIZE;
	if (entry.packedSize < BigInt(markerLength)) return { kind: "raw" };
	const header = await source.readAt(entry.offset, markerLength);
	if (!header.subarray(0, SCRIPT_MARKER.length).equals(SCRIPT_MARKER))
		return { kind: "raw" };
	if (
		header
			.subarray(
				SCRIPT_MARKER.length,
				SCRIPT_MARKER.length + ENCODE_MARKER.length,
			)
			.equals(ENCODE_MARKER)
	)
		return { kind: "encode" };
	if (
		header
			.subarray(
				SCRIPT_MARKER.length,
				SCRIPT_MARKER.length + NO_ENCODE_MARKER.length,
			)
			.equals(NO_ENCODE_MARKER)
	) {
		const stored = await source.readAt(entry.offset, Number(entry.packedSize));
		const decoded = decodeNoEncode(stored.subarray(NO_ENCODE_HEADER_SIZE));
		return { kind: "no-encode", decoded };
	}
	return { kind: "raw" };
}

/**
 * GARBro `DatOpener.TryOpen`. The archive is a text index followed by the data it describes: the
 * first line is a marker, records are tab-separated `name`, start, and end offsets, and `LIST-END`
 * closes the list. Entries therefore lie inside the same file.
 *
 * Payloads that start with `DJCODE NLINE-` are script containers. `ENCODE` payloads are XORed with
 * 0xff behind a 20-byte header, while `NO-ENCODE` payloads collapse CRLF pairs and XOR the remaining
 * bytes behind a 23-byte header. The port unwraps the second variant while listing, because only then
 * is the unpacked size known.
 */
async function readDjIndex(
	source: ByteSource,
): Promise<
	{ entries: FixedEntry[]; decoded: Map<string, Buffer> } | undefined
> {
	const buffer = await source.readAt(0n, Number(source.size));
	if (!buffer.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const text = decodeCp932(buffer);
	const lines = text.split("\n");
	if (lines.length < 2) return undefined;
	const entries: FixedEntry[] = [];
	const decoded = new Map<string, Buffer>();
	for (let line = 1; line < lines.length; line += 1) {
		const current = (lines[line] ?? "").replace(/\r$/, "");
		if (current === INDEX_END) break;
		const match = ENTRY_PATTERN.exec(current);
		if (!match) return undefined;
		const name = match[1] ?? "";
		const start = BigInt(match[2] ?? "0");
		const end = BigInt(match[3] ?? "0");
		const size = end - start;
		if (size < 0n || !checkPlacement(start, size, source.size))
			return undefined;
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset: start,
			size,
			packedSize: size,
			encrypted: true,
		});
		if (sourceExtension(name) === AUDIO_EXTENSION)
			entry.metadata = { audio: true };
		const payload = await inspectPayload(source, entry);
		if (!payload) return undefined;
		if (payload.kind === "encode") {
			entry.size = entry.packedSize - BigInt(ENCODE_HEADER_SIZE);
			entry.compressed = true;
			entry.metadata = { ...entry.metadata, script: "encode" };
		} else if (payload.kind === "no-encode" && payload.decoded) {
			decoded.set(entry.id, payload.decoded);
			entry.size = BigInt(payload.decoded.length);
			entry.compressed = true;
			entry.metadata = { ...entry.metadata, script: "no-encode" };
		}
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return { entries, decoded };
}

class DjArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = djDatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #decoded: ReadonlyMap<string, Buffer>;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: readonly FixedEntry[],
		decoded: ReadonlyMap<string, Buffer>,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.#decoded = decoded;
		this.metadata = {
			entryCount: entries.length,
			decodedEntryCount: decoded.size,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const decoded = this.#decoded.get(entryId);
		if (decoded) return Readable.from([decoded]);
		if (entry.metadata?.script === "encode") {
			const payload = await this.#source.readAt(
				entry.offset + BigInt(ENCODE_HEADER_SIZE),
				Number(entry.size),
			);
			for (let position = 0; position < payload.length; position += 1)
				payload[position] = (payload[position] ?? 0) ^ XOR_KEY;
			return Readable.from([payload]);
		}
		return this.#source.createReadStream(entry.offset, entry.packedSize);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const djDatFormat: ArchiveFormat = {
	descriptor: djDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDjIndex(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readDjIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DJSYSTEM DAT layout");
		return new DjArchiveHandle(
			source,
			sourcePath,
			index.entries,
			index.decoded,
		);
	},
};
