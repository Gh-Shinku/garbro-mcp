import { BufferByteSource, type ArchiveFormat } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { expect } from "vitest";

export interface ExpectedEntry {
	path: string;
	size: number;
	content?: Buffer | undefined;
}

/**
 * Asserts detection, listing, and (when content is supplied) extraction for a synthetic archive.
 * Keeps the per-format tests focused on index layout details instead of handle plumbing.
 */
export async function expectArchive(options: {
	format: ArchiveFormat;
	archive: Buffer;
	sourcePath?: string;
	detected?: boolean;
	entries: readonly ExpectedEntry[];
	metadata?: Record<string, unknown>;
}): Promise<void> {
	const sourcePath = options.sourcePath ?? "sample.bin";
	const source = new BufferByteSource(options.archive);
	expect(await options.format.detect(source, sourcePath)).toBe(
		options.detected ?? true,
	);
	if (options.detected === false) return;

	const archive = await options.format.open(source, sourcePath);
	try {
		expect(
			archive.entries.map((entry) => ({
				path: entry.path,
				size: entry.size,
			})),
		).toEqual(
			options.entries.map((entry) => ({
				path: entry.path,
				size: BigInt(entry.size),
			})),
		);
		if (options.metadata !== undefined)
			expect(archive.metadata).toMatchObject(options.metadata);
		for (const [index, expected] of options.entries.entries()) {
			if (expected.content === undefined) continue;
			const entry = archive.entries[index];
			if (!entry) throw new Error(`Missing entry at index ${index}`);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				expected.content,
			);
		}
	} finally {
		await archive.close();
	}
}
