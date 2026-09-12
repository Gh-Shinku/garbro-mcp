import { FileByteSource, type ArchiveFormat } from "@garbro-mcp/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { expect } from "vitest";

/** Writes a set of companion files into a temporary directory and runs the callback. */
export async function withCompanionFiles(
	mainName: string,
	files: Record<string, Buffer | string>,
	run: (mainPath: string) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-companion-"));
	try {
		for (const [name, content] of Object.entries(files)) {
			await writeFile(resolve(directory, name), content);
		}
		await run(resolve(directory, mainName));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export interface CompanionEntry {
	path: string;
	size: number;
	content?: Buffer;
}

/** Asserts detection, listing, and extraction for an archive whose index lives in a sibling file. */
export async function expectCompanionArchive(options: {
	format: ArchiveFormat;
	mainPath: string;
	entries: readonly CompanionEntry[];
	metadata?: Record<string, unknown>;
}): Promise<void> {
	const source = await FileByteSource.open(options.mainPath);
	expect(await options.format.detect(source, options.mainPath)).toBe(true);
	const archive = await options.format.open(source, options.mainPath);
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
		if (options.metadata !== undefined) {
			expect(archive.metadata).toMatchObject(options.metadata);
		}
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
