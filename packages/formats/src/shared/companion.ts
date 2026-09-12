// Shared helper for GARbro formats that keep their index in a sibling file.
// GARbro references: VFS.ChangeFileName / Path.ChangeExtension usage in the individual openers.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

/** Replaces the extension of a file name, mirroring `Path.ChangeExtension`. */
export function changeExtension(fileName: string, extension: string): string {
	const separator = Math.max(
		fileName.lastIndexOf("/"),
		fileName.lastIndexOf("\\"),
	);
	const dot = fileName.lastIndexOf(".");
	const base = dot > separator ? fileName.slice(0, dot) : fileName;
	return extension.length === 0 ? base : `${base}.${extension}`;
}

/**
 * Reads a companion file next to the archive. Returns `undefined` when the file does not exist or
 * cannot be read, so structural detection can continue with other formats.
 */
export async function readCompanionFile(
	sourcePath: string,
	fileName: string,
): Promise<Buffer | undefined> {
	try {
		return await readFile(resolve(dirname(sourcePath), fileName));
	} catch {
		return undefined;
	}
}
