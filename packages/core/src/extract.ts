import { createHash, randomBytes } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
	access,
	lstat,
	link,
	mkdir,
	rename,
	rm,
	unlink,
} from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
	win32,
} from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { GarbroError } from "./errors.js";
import type { ArchiveEntry, ArchiveHandle } from "./types.js";

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export interface ExtractOptions {
	outputDirectory: string;
	overwrite?: boolean;
}

export interface ExtractedEntry {
	entry: ArchiveEntry;
	outputPath: string;
	bytesWritten: bigint;
	sha256: string;
}

export interface ExtractArchiveResult {
	outputDirectory: string;
	files: ExtractedEntry[];
	bytesWritten: bigint;
}

export function normalizeArchivePath(value: string): string {
	if (value.includes("\0") || isAbsolute(value) || win32.isAbsolute(value)) {
		throw new GarbroError("UNSAFE_PATH", `Unsafe archive path: ${value}`);
	}
	const segments = value.replaceAll("\\", "/").split("/");
	if (
		segments.length === 0 ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		throw new GarbroError("UNSAFE_PATH", `Unsafe archive path: ${value}`);
	}
	for (const segment of segments) {
		if (segment.includes(":")) {
			throw new GarbroError(
				"UNSAFE_PATH",
				`Archive path contains a Windows stream or drive marker: ${value}`,
			);
		}
		if (
			segment.endsWith(".") ||
			segment.endsWith(" ") ||
			WINDOWS_RESERVED_NAME.test(segment)
		) {
			throw new GarbroError(
				"UNSAFE_PATH",
				`Archive path is unsafe on Windows: ${value}`,
			);
		}
	}
	return segments.join("/");
}

export function resolveEntryOutputPath(
	outputDirectory: string,
	entryPath: string,
): string {
	const root = resolve(outputDirectory);
	const normalized = normalizeArchivePath(entryPath);
	const outputPath = resolve(root, ...normalized.split("/"));
	const relation = relative(root, outputPath);
	if (
		relation === "" ||
		relation === ".." ||
		relation.startsWith(`..${sep}`) ||
		isAbsolute(relation)
	) {
		throw new GarbroError(
			"UNSAFE_PATH",
			`Archive path escapes the output directory: ${entryPath}`,
		);
	}
	return outputPath;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function ensureDirectoryWithoutSymlinks(
	root: string,
	targetDirectory: string,
): Promise<void> {
	const absoluteRoot = resolve(root);
	await mkdir(absoluteRoot, { recursive: true });
	const rootStats = await lstat(absoluteRoot);
	if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
		throw new GarbroError(
			"UNSAFE_PATH",
			`Output root is not a real directory: ${absoluteRoot}`,
		);
	}
	const relation = relative(absoluteRoot, targetDirectory);
	let current = absoluteRoot;
	for (const segment of relation.split(sep).filter(Boolean)) {
		current = join(current, segment);
		try {
			const stats = await lstat(current);
			if (stats.isSymbolicLink() || !stats.isDirectory()) {
				throw new GarbroError(
					"UNSAFE_PATH",
					`Output path traverses a non-directory: ${current}`,
				);
			}
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			const code =
				error instanceof Error && "code" in error ? error.code : undefined;
			if (code !== "ENOENT") throw error;
			await mkdir(current);
		}
	}
}

async function installTemporaryFile(
	tempPath: string,
	outputPath: string,
	overwrite: boolean,
): Promise<void> {
	if (!overwrite) {
		try {
			await link(tempPath, outputPath);
			await unlink(tempPath);
			return;
		} catch (error) {
			const code =
				error instanceof Error && "code" in error ? error.code : undefined;
			if (code === "EEXIST") {
				throw new GarbroError(
					"OUTPUT_EXISTS",
					`Output already exists: ${outputPath}`,
				);
			}
			throw error;
		}
	}

	if (await pathExists(outputPath)) {
		const stats = await lstat(outputPath);
		if (stats.isSymbolicLink() || !stats.isFile()) {
			throw new GarbroError(
				"UNSAFE_PATH",
				`Refusing to overwrite a non-regular file: ${outputPath}`,
			);
		}
		await rm(outputPath);
	}
	await rename(tempPath, outputPath);
}

export async function extractEntry(
	archive: ArchiveHandle,
	entryId: string,
	options: ExtractOptions,
): Promise<ExtractedEntry> {
	const entry = archive.entries.find((candidate) => candidate.id === entryId);
	if (!entry)
		throw new GarbroError(
			"ENTRY_NOT_FOUND",
			`Archive entry not found: ${entryId}`,
		);

	const outputDirectory = resolve(options.outputDirectory);
	const outputPath = resolveEntryOutputPath(outputDirectory, entry.path);
	await ensureDirectoryWithoutSymlinks(outputDirectory, dirname(outputPath));
	if (!options.overwrite && (await pathExists(outputPath))) {
		throw new GarbroError(
			"OUTPUT_EXISTS",
			`Output already exists: ${outputPath}`,
		);
	}

	const tempPath = join(
		dirname(outputPath),
		`.${basename(outputPath)}.garbro-${process.pid}-${randomBytes(6).toString("hex")}.tmp`,
	);
	const hash = createHash("sha256");
	let bytesWritten = 0n;
	const meter = new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			hash.update(chunk);
			bytesWritten += BigInt(chunk.length);
			callback(null, chunk);
		},
	});

	try {
		const input = await archive.openEntry(entry.id);
		await pipeline(input, meter, createWriteStream(tempPath, { flags: "wx" }));
		// Entries whose output size is not declared report the bytes the decoder produced.
		if (entry.sizeKnown !== false && bytesWritten !== entry.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Extracted size mismatch for ${entry.path}`,
				{
					details: {
						expected: entry.size.toString(),
						actual: bytesWritten.toString(),
					},
				},
			);
		}
		await installTemporaryFile(
			tempPath,
			outputPath,
			options.overwrite ?? false,
		);
		return { entry, outputPath, bytesWritten, sha256: hash.digest("hex") };
	} catch (error) {
		await rm(tempPath, { force: true });
		throw error;
	}
}

export async function extractArchive(
	archive: ArchiveHandle,
	options: ExtractOptions,
): Promise<ExtractArchiveResult> {
	const outputDirectory = resolve(options.outputDirectory);
	const seen = new Set<string>();
	for (const entry of archive.entries) {
		const outputPath = resolveEntryOutputPath(outputDirectory, entry.path);
		const key =
			process.platform === "win32" ? outputPath.toLowerCase() : outputPath;
		if (seen.has(key)) {
			throw new GarbroError(
				"UNSAFE_PATH",
				`Multiple entries resolve to the same output path: ${entry.path}`,
			);
		}
		seen.add(key);
		if (!options.overwrite && (await pathExists(outputPath))) {
			throw new GarbroError(
				"OUTPUT_EXISTS",
				`Output already exists: ${outputPath}`,
			);
		}
	}

	const files: ExtractedEntry[] = [];
	let bytesWritten = 0n;
	for (const entry of archive.entries) {
		const extracted = await extractEntry(archive, entry.id, options);
		files.push(extracted);
		bytesWritten += extracted.bytesWritten;
	}
	return { outputDirectory, files, bytesWritten };
}
