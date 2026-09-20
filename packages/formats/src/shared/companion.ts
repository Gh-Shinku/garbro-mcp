// Shared helper for GARbro formats that keep their index in a sibling file.
// GARbro references: VFS.ChangeFileName / Path.ChangeExtension usage in the individual openers.

import { readFile, readdir } from "node:fs/promises";
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

/**
 * The companions a format looks for by pattern rather than by name: GARbro asks its own file system for
 * `<name without extension>.*` beside the name it carries, so every file that shares a stem is a candidate.
 * The file the pattern was asked from is left out, the same way the reference skips its own name, and the rest
 * are returned sorted so the order is deterministic where a file system's own is not. A name that holds a
 * directory — the references carry those — is resolved against the directory of `sourcePath`.
 */
export async function listCompanionFiles(
	sourcePath: string,
	nameWithPath: string,
): Promise<string[]> {
	const separator = Math.max(
		nameWithPath.lastIndexOf("/"),
		nameWithPath.lastIndexOf("\\"),
	);
	const directory = separator >= 0 ? nameWithPath.slice(0, separator) : "";
	const base = changeExtension(nameWithPath.slice(separator + 1), "");
	if (base.length === 0) return [];
	try {
		const directoryPath = resolve(dirname(sourcePath), directory);
		const self = sourcePath.replace(/^.*[/\\]/, "");
		const names = await readdir(directoryPath);
		return names
			.filter((name) => name !== self && name.startsWith(`${base}.`))
			.sort()
			.map((name) => resolve(directoryPath, name));
	} catch {
		return [];
	}
}

/**
 * The companions a format looks for by extension rather than by name: GARbro asks its own file system for
 * `*.ext` beside the archive, and where it finds none, for the same pattern in the directory above it. The
 * names are returned sorted so the order is deterministic where a file system's own is not.
 */
export async function findCompanionFilesByExtension(
	sourcePath: string,
	extension: string,
): Promise<string[]> {
	const suffix = `.${extension.toLowerCase()}`;
	const directories = [dirname(sourcePath), dirname(dirname(sourcePath))];
	for (const directory of directories) {
		try {
			const names = (await readdir(directory))
				.filter((name) => name.toLowerCase().endsWith(suffix))
				.sort();
			if (names.length > 0)
				return names.map((name) => resolve(directory, name));
		} catch {}
	}
	return [];
}
