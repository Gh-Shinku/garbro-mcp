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
}

export interface ArchiveEntry {
	id: string;
	path: string;
	rawPath?: string;
	size: bigint;
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
}

export interface ArchiveFormat {
	readonly descriptor: FormatDescriptor;
	readonly detection?: ArchiveDetectionHints;
	detect(source: ByteSource, sourcePath?: string): Promise<boolean>;
	open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle>;
}
