import type { Readable } from "node:stream";
import type { ByteSource } from "./source.js";

export interface FormatAttribution {
	project: string;
	source: string;
	license: string;
	commit?: string;
}

export interface FormatDescriptor {
	id: string;
	name: string;
	extensions: readonly string[];
	capabilities: {
		detect: true;
		list: true;
		extract: true;
		create: boolean;
		encryption: boolean;
	};
	attribution: readonly FormatAttribution[];
}

export interface DetectionResult {
	path: string;
	size: bigint;
	format: FormatDescriptor;
	/** Deepest validation completed before this result was returned. */
	validation: "signature" | "structural" | "decoded";
	/** Qualitative confidence based on the evidence used to select the format. */
	confidence: "low" | "medium" | "high";
	warnings: readonly string[];
}

export interface ArchiveEntry {
	id: string;
	path: string;
	rawPath?: string;
	size: bigint;
	/**
	 * Whether `size` is the exact extracted size. Formats that decode an entry on extraction without a
	 * declared output size set this to `false`; extraction then reports the real byte count instead of
	 * failing a length check.
	 */
	sizeKnown?: boolean;
	packedSize: bigint;
	compressed: boolean;
	encrypted: boolean;
	checksum?: {
		algorithm: "adler32";
		value: string;
	};
	metadata?: Record<string, unknown>;
}

export interface ArchiveHandle {
	readonly sourcePath: string;
	readonly format: FormatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly ArchiveEntry[];
	openEntry(entryId: string): Promise<Readable>;
	close(): Promise<void>;
}

export interface ByteSignature {
	readonly bytes: Uint8Array;
	readonly offset?: bigint;
}

export interface ArchiveDetectionHints {
	readonly signatures?: readonly ByteSignature[];
	readonly priority?: number;
	readonly extensionFallback?: boolean;
	/** Do not offer this format when the source extension is absent from its descriptor. */
	readonly extensionOnly?: boolean;
}

export interface ArchiveFormat {
	readonly descriptor: FormatDescriptor;
	readonly detection?: ArchiveDetectionHints;
	detect(source: ByteSource, sourcePath?: string): Promise<boolean>;
	open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle>;
}
