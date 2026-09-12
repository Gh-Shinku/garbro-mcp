// Shared plumbing for GARbro fixed-index archive ports.
// GARbro references: GameRes/ArchiveFormat.cs (IsSaneCount), GameRes/GameRes.cs (Entry.CheckPlacement).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveDetectionHints,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { extname } from "node:path";
import type { Readable } from "node:stream";

/** GARbro `ArchiveFormat.IsSaneCount`: `count > 0 && count < 0x40000`. */
export function isSaneCount(count: number): boolean {
	return count > 0 && count < 0x40000;
}

/** GARbro `Entry.CheckPlacement`. */
export function checkPlacement(
	offset: bigint,
	size: bigint,
	maxOffset: bigint,
): boolean {
	return offset < maxOffset && size <= maxOffset && offset <= maxOffset - size;
}

/** Decodes a fixed-width, null-terminated CP932 field. */
export function decodeCStringField(
	bytes: Buffer,
	offset: number,
	length: number,
): string {
	const field = bytes.subarray(offset, Math.min(offset + length, bytes.length));
	const terminator = field.indexOf(0);
	return decodeCp932(terminator === -1 ? field : field.subarray(0, terminator));
}

/** Lowercase extension without the leading dot, as used for GARbro `HasExtension` checks. */
export function sourceExtension(sourcePath: string): string {
	return extname(sourcePath).slice(1).toLowerCase();
}

export interface FixedEntry extends ArchiveEntry {
	offset: bigint;
}

export function createFixedEntry(input: {
	id: string | number;
	path: string;
	rawPath?: string;
	offset: bigint;
	size: bigint;
	compressed?: boolean;
	encrypted?: boolean;
	metadata?: Record<string, unknown>;
}): FixedEntry {
	const entry: FixedEntry = {
		id: String(input.id),
		path: input.path,
		size: input.size,
		packedSize: input.size,
		compressed: input.compressed ?? false,
		encrypted: input.encrypted ?? false,
		offset: input.offset,
	};
	if (input.rawPath !== undefined) entry.rawPath = input.rawPath;
	if (input.metadata !== undefined) entry.metadata = input.metadata;
	return entry;
}

/** Converts GARbro CP932 entry names to the toolkit's forward-slash paths. */
export function normalizeEntryPath(rawPath: string): {
	path: string;
	rawPath?: string;
} {
	const path = rawPath.replaceAll("\\", "/");
	return path === rawPath ? { path } : { path, rawPath };
}

export interface FixedEntryOpener {
	(
		source: ByteSource,
		entry: FixedEntry,
		sourcePath: string,
	): Promise<Readable>;
}

/** Opens an entry as a raw read stream. Mirrors the default GARbro entry behavior. */
export const rawEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.size);

export class FixedIndexArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format: FormatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #opener: FixedEntryOpener;

	constructor(
		source: ByteSource,
		sourcePath: string,
		format: FormatDescriptor,
		entries: readonly FixedEntry[],
		metadata: Record<string, unknown>,
		opener: FixedEntryOpener = rawEntryOpener,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.format = format;
		this.size = source.size;
		this.entries = entries;
		this.metadata = metadata;
		this.#opener = opener;
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		return this.#opener(this.#source, entry, this.sourcePath);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export interface FixedArchiveDefinition {
	descriptor: FormatDescriptor;
	detection?: ArchiveDetectionHints;
	detect(source: ByteSource, sourcePath: string): Promise<boolean>;
	read(
		source: ByteSource,
		sourcePath: string,
	): Promise<{
		entries: FixedEntry[];
		metadata?: Record<string, unknown>;
	}>;
	/** Optional custom entry decoder, for example when entries are LZSS-compressed. */
	openEntry?: FixedEntryOpener;
}

export function defineFixedArchive(
	definition: FixedArchiveDefinition,
): ArchiveFormat {
	const format: ArchiveFormat = {
		descriptor: definition.descriptor,
		detect: definition.detect,
		async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
			const { entries, metadata } = await definition.read(source, sourcePath);
			return new FixedIndexArchiveHandle(
				source,
				sourcePath,
				definition.descriptor,
				entries,
				metadata ?? {},
				definition.openEntry,
			);
		},
	};
	if (definition.detection !== undefined)
		return { ...format, detection: definition.detection };
	return format;
}
