import { lstat, readdir } from "node:fs/promises";
import { matchesGlob, relative, resolve, sep } from "node:path";
import { decodeCp932 } from "./encoding.js";
import { asGarbroError, GarbroError } from "./errors.js";
import { extractEntry, resolveEntryOutputPath } from "./extract.js";
import type { FormatRegistry } from "./registry.js";
import type {
	ArchiveEntry,
	ArchiveHandle,
	DetectionResult,
	FormatDescriptor,
} from "./types.js";
import {
	type InputReference,
	normalizeWorkspaceRelativePath,
	type WorkspacePolicy,
} from "./workspace.js";

export interface AutomationLimits {
	previewDefaultBytes: number;
	previewMaxBytes: number;
	scanPageMax: number;
	entryPageMax: number;
	maxBatchEntries: number;
	scanConcurrency: number;
}

export const DEFAULT_AUTOMATION_LIMITS: AutomationLimits = {
	previewDefaultBytes: 2 * 1024,
	previewMaxBytes: 64 * 1024,
	scanPageMax: 500,
	entryPageMax: 1000,
	maxBatchEntries: 10_000,
	scanConcurrency: 4,
};

export interface AutomationControl {
	signal?: AbortSignal;
	onProgress?: (progress: {
		progress: number;
		total?: number;
		message?: string;
	}) => void | Promise<void>;
}

export interface EntryFilter {
	includeGlobs?: readonly string[];
	excludeGlobs?: readonly string[];
	caseSensitive?: boolean;
	compressed?: boolean;
	encrypted?: boolean;
}

export interface ArchiveSummary {
	entryCount: number;
	compressedEntries: number;
	encryptedEntries: number;
	unknownSizeEntries: number;
}

export interface ArchiveInspection {
	recognized: true;
	source: InputReference;
	absolutePath: string;
	size: bigint;
	format: FormatDescriptor;
	validation: DetectionResult["validation"];
	confidence: DetectionResult["confidence"];
	warnings: readonly string[];
	metadata: Record<string, unknown>;
	summary: ArchiveSummary;
}

export interface ScanArchiveResult {
	source: InputReference;
	size: bigint;
	format: FormatDescriptor;
	validation: DetectionResult["validation"];
	confidence: DetectionResult["confidence"];
	warnings: readonly string[];
}

export interface ScanFailure {
	source: InputReference;
	error: GarbroError;
}

export interface ScanResult {
	scanned: number;
	archives: ScanArchiveResult[];
	unrecognized: InputReference[];
	unrecognizedCount: number;
	failures: ScanFailure[];
	nextCursor: string | null;
	complete: boolean;
}

export type EntryPreview =
	| {
			kind: "text";
			text: string;
			encoding: "utf8" | "utf16le" | "cp932";
			bytesRead: number;
			truncated: boolean;
	  }
	| {
			kind: "hex";
			hex: string;
			bytesRead: number;
			truncated: boolean;
	  };

export type ExtractionSelection =
	| { mode: "all"; excludeGlobs?: readonly string[] }
	| { mode: "ids"; entryIds: readonly string[] }
	| {
			mode: "glob";
			includeGlobs: readonly string[];
			excludeGlobs?: readonly string[];
			caseSensitive?: boolean;
	  };

export type ConflictPolicy = "fail" | "skip" | "overwrite";

export interface ExtractedArtifact {
	relativePath: string;
	absolutePath: string;
	bytesWritten: bigint;
	sha256: string;
}

export type BatchExtractionItem =
	| {
			entryId: string;
			entryPath: string;
			status: "extracted";
			artifact: ExtractedArtifact;
	  }
	| {
			entryId: string;
			entryPath?: string;
			status: "skipped";
			reason: string;
	  }
	| {
			entryId: string;
			entryPath?: string;
			status: "failed";
			error: GarbroError;
	  };

export interface BatchExtractionResult {
	status: "completed" | "partial" | "failed";
	outputDirectory: string;
	selected: number;
	extracted: number;
	skipped: number;
	failed: number;
	bytesWritten: bigint;
	items: BatchExtractionItem[];
}

export interface ArchiveAutomationOptions {
	limits?: Partial<AutomationLimits>;
}

function validatePositiveLimit(name: string, value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`${name} must be a positive integer`,
		);
}

function resolveLimits(overrides: Partial<AutomationLimits>): AutomationLimits {
	const limits = { ...DEFAULT_AUTOMATION_LIMITS, ...overrides };
	for (const [name, value] of Object.entries(limits))
		validatePositiveLimit(name, value);
	if (limits.previewDefaultBytes > limits.previewMaxBytes)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"previewDefaultBytes must not exceed previewMaxBytes",
		);
	return limits;
}

function throwIfCancelled(signal?: AbortSignal): void {
	if (signal?.aborted)
		throw new GarbroError("CANCELLED", "Operation was cancelled", {
			cause: signal.reason,
		});
}

function validateGlobs(globs: readonly string[]): void {
	if (globs.length > 32)
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			"At most 32 glob patterns are allowed",
		);
	for (const glob of globs) {
		if (
			glob.length === 0 ||
			glob.includes("\0") ||
			glob.startsWith("/") ||
			/^[a-z]:/i.test(glob) ||
			glob.replaceAll("\\", "/").split("/").includes("..")
		)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Invalid glob pattern: ${glob}`,
			);
	}
}

function pathMatches(
	path: string,
	globs: readonly string[],
	caseSensitive: boolean,
): boolean {
	const candidate = caseSensitive ? path : path.toLowerCase();
	return globs.some((glob) =>
		matchesGlob(
			candidate,
			(caseSensitive ? glob : glob.toLowerCase()).replaceAll("\\", "/"),
		),
	);
}

export function filterArchiveEntries(
	entries: readonly ArchiveEntry[],
	filter: EntryFilter = {},
): ArchiveEntry[] {
	const include = filter.includeGlobs ?? ["**/*"];
	const exclude = filter.excludeGlobs ?? [];
	validateGlobs(include);
	validateGlobs(exclude);
	const caseSensitive = filter.caseSensitive ?? false;
	return entries.filter(
		(entry) =>
			pathMatches(entry.path, include, caseSensitive) &&
			!pathMatches(entry.path, exclude, caseSensitive) &&
			(filter.compressed === undefined ||
				entry.compressed === filter.compressed) &&
			(filter.encrypted === undefined || entry.encrypted === filter.encrypted),
	);
}

function encodeCursor(path: string): string {
	return Buffer.from(path, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
	try {
		if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("invalid base64url");
		const bytes = Buffer.from(cursor, "base64url");
		const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		if (encodeCursor(decoded) !== cursor.replace(/=+$/, ""))
			throw new Error("non-canonical base64url");
		return normalizeWorkspaceRelativePath(decoded);
	} catch (error) {
		throw new GarbroError("INVALID_ARGUMENT", "Invalid scan cursor", {
			cause: error,
		});
	}
}

async function pathInfo(
	path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		const code =
			error instanceof Error && "code" in error ? error.code : undefined;
		if (code === "ENOENT") return undefined;
		throw error;
	}
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

async function consumePrefix(
	archive: ArchiveHandle,
	entryId: string,
	maxBytes: number,
	signal?: AbortSignal,
): Promise<{ bytes: Buffer; truncated: boolean }> {
	const stream = await archive.openEntry(entryId);
	const chunks: Buffer[] = [];
	let length = 0;
	try {
		for await (const value of stream) {
			throwIfCancelled(signal);
			const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
			const wanted = Math.min(chunk.length, maxBytes + 1 - length);
			if (wanted > 0) {
				chunks.push(chunk.subarray(0, wanted));
				length += wanted;
			}
			if (length > maxBytes) break;
		}
	} finally {
		stream.destroy();
	}
	const bytes = Buffer.concat(chunks, length);
	return {
		bytes: bytes.subarray(0, maxBytes),
		truncated: bytes.length > maxBytes,
	};
}

function looksBinary(bytes: Buffer): boolean {
	if (bytes.includes(0)) return true;
	let controls = 0;
	for (const byte of bytes) {
		if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)
			controls += 1;
	}
	return bytes.length > 0 && controls / bytes.length > 0.1;
}

function hasTextBom(bytes: Buffer): boolean {
	return (
		bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ||
		bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
	);
}

function decodeText(
	bytes: Buffer,
	encoding: "auto" | "utf8" | "utf16le" | "cp932",
	truncated: boolean,
): { text: string; encoding: "utf8" | "utf16le" | "cp932" } {
	if (encoding === "utf16le")
		return {
			text: bytes
				.subarray(
					bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])) ? 2 : 0,
				)
				.toString("utf16le"),
			encoding,
		};
	if (encoding === "cp932") return { text: decodeCp932(bytes), encoding };
	const utf8Bytes = bytes.subarray(
		bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? 3 : 0,
	);
	if (encoding === "utf8")
		return { text: utf8Bytes.toString("utf8"), encoding };
	if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe])))
		return {
			text: bytes.subarray(2).toString("utf16le"),
			encoding: "utf16le",
		};
	try {
		return {
			text: new TextDecoder("utf-8", { fatal: true }).decode(utf8Bytes, {
				stream: truncated,
			}),
			encoding: "utf8",
		};
	} catch {
		return { text: decodeCp932(bytes), encoding: "cp932" };
	}
}

async function mapConcurrent<T, R>(
	values: readonly T[],
	concurrency: number,
	map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(values.length);
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, values.length) }, async () => {
			for (;;) {
				const index = next++;
				if (index >= values.length) return;
				const value = values[index];
				if (value !== undefined) results[index] = await map(value, index);
			}
		}),
	);
	return results;
}

export class ArchiveAutomationService {
	readonly registry: FormatRegistry;
	readonly workspace: WorkspacePolicy;
	readonly limits: AutomationLimits;

	constructor(
		registry: FormatRegistry,
		workspace: WorkspacePolicy,
		options: ArchiveAutomationOptions = {},
	) {
		this.registry = registry;
		this.workspace = workspace;
		this.limits = resolveLimits(options.limits ?? {});
	}

	async inspectArchive(
		source: InputReference,
	): Promise<
		ArchiveInspection | { recognized: false; source: InputReference }
	> {
		const resolved = await this.workspace.resolveInput(source, "file");
		const normalizedSource = {
			rootId: source.rootId,
			path: resolved.relativePath,
		};
		const detection = await this.registry.detectArchive(resolved.absolutePath);
		if (!detection) return { recognized: false, source: normalizedSource };
		return await this.#withArchive(resolved.absolutePath, async (archive) => ({
			recognized: true,
			source: normalizedSource,
			absolutePath: resolved.absolutePath,
			size: archive.size,
			format: archive.format,
			validation: detection.validation,
			confidence: detection.confidence,
			warnings: detection.warnings,
			metadata: archive.metadata,
			summary: {
				entryCount: archive.entries.length,
				compressedEntries: archive.entries.filter((entry) => entry.compressed)
					.length,
				encryptedEntries: archive.entries.filter((entry) => entry.encrypted)
					.length,
				unknownSizeEntries: archive.entries.filter(
					(entry) => entry.sizeKnown === false,
				).length,
			},
		}));
	}

	async listEntries(
		source: InputReference,
		options: EntryFilter & { offset?: number; limit?: number } = {},
	): Promise<{
		archiveTotal: number;
		matchedTotal: number;
		offset: number;
		limit: number;
		nextOffset: number | null;
		entries: ArchiveEntry[];
	}> {
		const offset = options.offset ?? 0;
		const limit = options.limit ?? 100;
		if (!Number.isSafeInteger(offset) || offset < 0)
			throw new GarbroError("INVALID_ARGUMENT", "offset must be non-negative");
		if (
			!Number.isSafeInteger(limit) ||
			limit <= 0 ||
			limit > this.limits.entryPageMax
		)
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`limit must be between 1 and ${this.limits.entryPageMax}`,
			);
		const resolved = await this.workspace.resolveInput(source, "file");
		return await this.#withArchive(resolved.absolutePath, async (archive) => {
			const matched = filterArchiveEntries(archive.entries, options);
			const entries = matched.slice(offset, offset + limit);
			return {
				archiveTotal: archive.entries.length,
				matchedTotal: matched.length,
				offset,
				limit,
				nextOffset:
					offset + entries.length < matched.length
						? offset + entries.length
						: null,
				entries,
			};
		});
	}

	async previewEntry(
		source: InputReference,
		entryId: string,
		options: {
			mode?: "auto" | "text" | "hex";
			encoding?: "auto" | "utf8" | "utf16le" | "cp932";
			maxBytes?: number;
			signal?: AbortSignal;
		} = {},
	): Promise<{ entry: ArchiveEntry; preview: EntryPreview }> {
		const maxBytes = options.maxBytes ?? this.limits.previewDefaultBytes;
		if (
			!Number.isSafeInteger(maxBytes) ||
			maxBytes <= 0 ||
			maxBytes > this.limits.previewMaxBytes
		)
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`maxBytes must be between 1 and ${this.limits.previewMaxBytes}`,
			);
		const resolved = await this.workspace.resolveInput(source, "file");
		return await this.#withArchive(resolved.absolutePath, async (archive) => {
			const entry = archive.entries.find(
				(candidate) => candidate.id === entryId,
			);
			if (!entry)
				throw new GarbroError(
					"ENTRY_NOT_FOUND",
					`Archive entry not found: ${entryId}`,
				);
			const { bytes, truncated } = await consumePrefix(
				archive,
				entry.id,
				maxBytes,
				options.signal,
			);
			const mode = options.mode ?? "auto";
			if (
				mode === "hex" ||
				(mode === "auto" && !hasTextBom(bytes) && looksBinary(bytes))
			)
				return {
					entry,
					preview: {
						kind: "hex",
						hex: bytes.toString("hex"),
						bytesRead: bytes.length,
						truncated,
					},
				};
			const decoded = decodeText(bytes, options.encoding ?? "auto", truncated);
			return {
				entry,
				preview: {
					kind: "text",
					...decoded,
					bytesRead: bytes.length,
					truncated,
				},
			};
		});
	}

	async scanArchives(
		rootId: string,
		options: {
			path?: string;
			recursive?: boolean;
			includeGlobs?: readonly string[];
			excludeGlobs?: readonly string[];
			maxDepth?: number;
			cursor?: string;
			limit?: number;
			includeUnrecognized?: boolean;
		} = {},
		control: AutomationControl = {},
	): Promise<ScanResult> {
		const relativeBase = options.path ?? ".";
		const resolved = await this.workspace.resolveInput(
			{ rootId, path: relativeBase },
			"directory",
		);
		const include = options.includeGlobs ?? ["**/*"];
		const exclude = options.excludeGlobs ?? [];
		validateGlobs(include);
		validateGlobs(exclude);
		const limit = options.limit ?? 200;
		if (
			!Number.isSafeInteger(limit) ||
			limit <= 0 ||
			limit > this.limits.scanPageMax
		)
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`limit must be between 1 and ${this.limits.scanPageMax}`,
			);
		const maxDepth = options.maxDepth ?? 8;
		if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 64)
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				"maxDepth must be between 0 and 64",
			);
		const files: Array<{
			absolutePath: string;
			rootRelative: string;
			scanRelative: string;
		}> = [];
		const walk = async (
			directory: string,
			relativeDirectory: string,
			depth: number,
		): Promise<void> => {
			throwIfCancelled(control.signal);
			const children = await readdir(directory, { withFileTypes: true });
			children.sort((left, right) => left.name.localeCompare(right.name));
			for (const child of children) {
				if (child.isSymbolicLink()) continue;
				const absolutePath = resolve(directory, child.name);
				if (this.workspace.isOutputPath(absolutePath)) continue;
				const scanRelative = relativeDirectory
					? `${relativeDirectory}/${child.name}`
					: child.name;
				if (child.isDirectory()) {
					if ((options.recursive ?? true) && depth < maxDepth)
						await walk(absolutePath, scanRelative, depth + 1);
					continue;
				}
				if (!child.isFile()) continue;
				if (
					!pathMatches(scanRelative, include, false) ||
					pathMatches(scanRelative, exclude, false)
				)
					continue;
				const rootRelative =
					resolved.relativePath === "."
						? scanRelative
						: `${resolved.relativePath}/${scanRelative}`;
				files.push({ absolutePath, rootRelative, scanRelative });
			}
		};
		await walk(resolved.absolutePath, "", 0);
		files.sort((left, right) =>
			left.rootRelative < right.rootRelative
				? -1
				: left.rootRelative > right.rootRelative
					? 1
					: 0,
		);
		const cursorPath = options.cursor
			? decodeCursor(options.cursor)
			: undefined;
		const start = cursorPath
			? files.findIndex((file) => file.rootRelative > cursorPath)
			: 0;
		const normalizedStart = start === -1 ? files.length : start;
		const page = files.slice(normalizedStart, normalizedStart + limit);
		let completed = 0;
		const inspected = await mapConcurrent(
			page,
			this.limits.scanConcurrency,
			async (file): Promise<DetectionResult | GarbroError | undefined> => {
				throwIfCancelled(control.signal);
				try {
					return await this.registry.detectArchive(file.absolutePath);
				} catch (error) {
					return asGarbroError(error);
				} finally {
					completed += 1;
					await control.onProgress?.({
						progress: completed,
						total: page.length,
						message: file.rootRelative,
					});
				}
			},
		);
		const archives: ScanArchiveResult[] = [];
		const failures: ScanFailure[] = [];
		const unrecognized: InputReference[] = [];
		let unrecognizedCount = 0;
		for (const [index, result] of inspected.entries()) {
			const file = page[index];
			if (!file) continue;
			const source = { rootId, path: file.rootRelative };
			if (result instanceof GarbroError)
				failures.push({ source, error: result });
			else if (!result) {
				unrecognizedCount += 1;
				if (options.includeUnrecognized) unrecognized.push(source);
			} else
				archives.push({
					source,
					size: result.size,
					format: result.format,
					validation: result.validation,
					confidence: result.confidence,
					warnings: result.warnings,
				});
		}
		const complete = normalizedStart + page.length >= files.length;
		return {
			scanned: page.length,
			archives,
			unrecognized,
			unrecognizedCount,
			failures,
			nextCursor:
				complete || page.length === 0
					? null
					: encodeCursor(page.at(-1)?.rootRelative ?? ""),
			complete,
		};
	}

	async extractEntries(
		source: InputReference,
		options: {
			selection?: ExtractionSelection;
			outputSubdirectory?: string;
			conflictPolicy?: ConflictPolicy;
		},
		control: AutomationControl = {},
	): Promise<BatchExtractionResult> {
		const resolved = await this.workspace.resolveInput(source, "file");
		const defaultOutput = `${source.rootId}/${resolved.relativePath}.extracted`;
		const outputRelative = options.outputSubdirectory ?? defaultOutput;
		const outputDirectory =
			await this.workspace.resolveOutputDirectory(outputRelative);
		const conflictPolicy = options.conflictPolicy ?? "fail";
		return await this.#withArchive(resolved.absolutePath, async (archive) => {
			const selection = options.selection ?? { mode: "all" as const };
			let selected: Array<{ id: string; entry: ArchiveEntry | undefined }>;
			if (selection.mode === "ids") {
				const ids = [...new Set(selection.entryIds)];
				selected = ids.map((id) => ({
					id,
					entry: archive.entries.find((entry) => entry.id === id),
				}));
			} else {
				const entries = filterArchiveEntries(archive.entries, {
					includeGlobs:
						selection.mode === "glob" ? selection.includeGlobs : ["**/*"],
					...(selection.excludeGlobs === undefined
						? {}
						: { excludeGlobs: selection.excludeGlobs }),
					...(selection.mode === "glob" && selection.caseSensitive !== undefined
						? { caseSensitive: selection.caseSensitive }
						: {}),
				});
				selected = entries.map((entry) => ({ id: entry.id, entry }));
			}
			if (selected.length > this.limits.maxBatchEntries)
				throw new GarbroError(
					"LIMIT_EXCEEDED",
					`Selection exceeds ${this.limits.maxBatchEntries} entries`,
				);
			const destinations = new Map<string, string[]>();
			const resolvedDestinations = new Map<string, string>();
			for (const candidate of selected) {
				if (!candidate.entry) continue;
				try {
					const destination = resolveEntryOutputPath(
						outputDirectory,
						candidate.entry.path,
					);
					resolvedDestinations.set(candidate.id, destination);
					const key =
						process.platform === "win32"
							? destination.toLowerCase()
							: destination;
					const ids = destinations.get(key) ?? [];
					ids.push(candidate.id);
					destinations.set(key, ids);
				} catch {
					// The preflight pass below preserves the precise path error.
				}
			}
			const duplicateIds = new Set(
				[...destinations.values()].filter((ids) => ids.length > 1).flat(),
			);
			type Preflight =
				| { action: "ready"; destination: string }
				| { action: "skip"; reason: string }
				| { action: "fail"; error: GarbroError };
			const preflight = new Map<string, Preflight>();
			// Resolve every destination and conflict before the first archive byte is written.
			for (const candidate of selected) {
				if (!candidate.entry) {
					preflight.set(candidate.id, {
						action: "fail",
						error: new GarbroError(
							"ENTRY_NOT_FOUND",
							`Archive entry not found: ${candidate.id}`,
						),
					});
					continue;
				}
				try {
					if (duplicateIds.has(candidate.id))
						throw new GarbroError(
							"UNSAFE_PATH",
							`Multiple entries resolve to the same output path: ${candidate.entry.path}`,
						);
					const destination =
						resolvedDestinations.get(candidate.id) ??
						resolveEntryOutputPath(outputDirectory, candidate.entry.path);
					const info = await pathInfo(destination);
					if (info && conflictPolicy === "skip") {
						preflight.set(candidate.id, {
							action: "skip",
							reason: "output exists",
						});
						continue;
					}
					if (info && conflictPolicy === "fail")
						throw new GarbroError(
							"OUTPUT_EXISTS",
							`Output already exists: ${destination}`,
						);
					if (
						info &&
						conflictPolicy === "overwrite" &&
						(info.isSymbolicLink() || !info.isFile())
					)
						throw new GarbroError(
							"UNSAFE_PATH",
							`Refusing to overwrite a non-regular file: ${destination}`,
						);
					preflight.set(candidate.id, { action: "ready", destination });
				} catch (error) {
					preflight.set(candidate.id, {
						action: "fail",
						error: asGarbroError(error),
					});
				}
			}
			const items: BatchExtractionItem[] = [];
			let bytesWritten = 0n;
			let extracted = 0;
			let skipped = 0;
			let failed = 0;
			for (const [index, candidate] of selected.entries()) {
				throwIfCancelled(control.signal);
				const entry = candidate.entry;
				try {
					const planned = preflight.get(candidate.id);
					if (!planned)
						throw new GarbroError(
							"IO_ERROR",
							"Missing extraction preflight result",
						);
					if (planned.action === "fail") throw planned.error;
					if (planned.action === "skip") {
						skipped += 1;
						items.push({
							entryId: candidate.id,
							...(entry === undefined ? {} : { entryPath: entry.path }),
							status: "skipped",
							reason: planned.reason,
						});
						continue;
					}
					if (!entry)
						throw new GarbroError(
							"ENTRY_NOT_FOUND",
							`Archive entry not found: ${candidate.id}`,
						);
					const result = await extractEntry(archive, entry.id, {
						outputDirectory,
						safetyRoot: this.workspace.outputRoot,
						overwrite: conflictPolicy === "overwrite",
						...(control.signal === undefined ? {} : { signal: control.signal }),
					});
					const artifactRelative = toPosix(
						relative(this.workspace.outputRoot, result.outputPath),
					);
					extracted += 1;
					bytesWritten += result.bytesWritten;
					items.push({
						entryId: entry.id,
						entryPath: entry.path,
						status: "extracted",
						artifact: {
							relativePath: artifactRelative,
							absolutePath: result.outputPath,
							bytesWritten: result.bytesWritten,
							sha256: result.sha256,
						},
					});
				} catch (error) {
					if (control.signal?.aborted)
						throw new GarbroError("CANCELLED", "Operation was cancelled", {
							cause: error,
						});
					failed += 1;
					items.push({
						entryId: candidate.id,
						...(entry === undefined ? {} : { entryPath: entry.path }),
						status: "failed",
						error: asGarbroError(error),
					});
				} finally {
					await control.onProgress?.({
						progress: index + 1,
						total: selected.length,
						message: entry?.path ?? candidate.id,
					});
				}
			}
			const status =
				failed === 0
					? "completed"
					: extracted > 0 || skipped > 0
						? "partial"
						: "failed";
			return {
				status,
				outputDirectory,
				selected: selected.length,
				extracted,
				skipped,
				failed,
				bytesWritten,
				items,
			};
		});
	}

	async #withArchive<T>(
		path: string,
		run: (archive: ArchiveHandle) => Promise<T>,
	): Promise<T> {
		const archive = await this.registry.openArchive(path);
		try {
			return await run(archive);
		} finally {
			await archive.close();
		}
	}
}
