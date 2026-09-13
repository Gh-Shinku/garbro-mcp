// Shared plumbing for ScenePlayer formats whose payloads live in a decoded buffer.
// GARbro reference: ArcFormats/ScenePlayer/ArcPMX.cs (`CreatePmxStream`, `PmxArchive`).

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import type { FixedEntry } from "../shared/fixed-archive.js";

/** GARbro wraps both ScenePlayer formats in an XOR-0x21 stream that inflates to the real container. */
export const PMX_STREAM_KEY = 0x21;
/** First byte of a zlib stream, which the container XORs. */
export const ZLIB_FIRST_BYTE = 0x78 ^ PMX_STREAM_KEY;

export async function readPmxStream(
	source: ByteSource,
): Promise<Buffer | undefined> {
	const raw = await source.readAt(0n, Number(source.size));
	for (let position = 0; position < raw.length; position += 1)
		raw[position] = (raw[position] ?? 0) ^ PMX_STREAM_KEY;
	try {
		return await inflateZlibBuffer(raw);
	} catch {
		return undefined;
	}
}

/** An archive handle whose entries are slices of one decoded buffer. */
export class DecodedArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format: FormatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly decodedSize: number;
	readonly #source: ByteSource;
	readonly #decoded: Buffer;

	constructor(
		source: ByteSource,
		sourcePath: string,
		format: FormatDescriptor,
		entries: readonly FixedEntry[],
		decoded: Buffer,
	) {
		this.#source = source;
		this.#decoded = decoded;
		this.sourcePath = sourcePath;
		this.format = format;
		this.size = source.size;
		this.entries = entries;
		this.decodedSize = decoded.length;
		this.metadata = { entryCount: entries.length, decodedSize: decoded.length };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const start = Number(entry.offset);
		return Readable.from([
			Buffer.from(this.#decoded.subarray(start, start + Number(entry.size))),
		]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export interface DecodedArchiveDefinition {
	descriptor: FormatDescriptor;
	detection?: ArchiveFormat["detection"];
	detect(source: ByteSource, sourcePath: string): Promise<boolean>;
	read(decoded: Buffer, sourcePath: string): Promise<FixedEntry[] | undefined>;
}

export function defineDecodedArchive(
	definition: DecodedArchiveDefinition,
): ArchiveFormat {
	const format: ArchiveFormat = {
		descriptor: definition.descriptor,
		async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
			return await definition.detect(source, sourcePath);
		},
		async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
			const decoded = await readPmxStream(source);
			if (!decoded)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"ScenePlayer container could not be decoded",
				);
			const entries = await definition.read(decoded, sourcePath);
			if (!entries)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Invalid ScenePlayer container layout",
				);
			return new DecodedArchiveHandle(
				source,
				sourcePath,
				definition.descriptor,
				entries,
				decoded,
			);
		},
	};
	if (definition.detection !== undefined)
		return { ...format, detection: definition.detection };
	return format;
}
