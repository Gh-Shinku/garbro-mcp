import { BufferByteSource, type ArchiveFormat } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { expect } from "vitest";

/**
 * Where two buffers first differ, or -1 when they hold the same bytes. Comparing large buffers structurally
 * is slow enough to time a test out, so the extracted bytes are compared one by one and the place they part
 * at is reported instead.
 */
function firstDifference(actual: Buffer, expected: Buffer): number {
	const shared = Math.min(actual.length, expected.length);
	for (let at = 0; at < shared; at += 1) {
		if (actual[at] !== expected[at]) return at;
	}
	return actual.length === expected.length ? -1 : shared;
}

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
			const extracted = await consumeBuffer(await archive.openEntry(entry.id));
			expect({
				length: extracted.length,
				firstDifference: firstDifference(extracted, expected.content),
			}).toEqual({ length: expected.content.length, firstDifference: -1 });
		}
	} finally {
		await archive.close();
	}
}
