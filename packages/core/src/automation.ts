import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, readdir, rmdir } from "node:fs/promises";
import { extname, matchesGlob, relative, resolve, sep } from "node:path";
import { asGarbroError, GarbroError } from "./errors.js";
import {
	extractEntry,
	extractionPathForEntry,
	resolveEntryOutputPath,
} from "./extract.js";
import type { FormatRegistry } from "./registry.js";
import { type EntryResourceType, entryResourceType } from "./resource-type.js";
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
	decodedResourceMaxBytes: number;
	scanPageMax: number;
	entryPageMax: number;
	maxBatchEntries: number;
	scanConcurrency: number;
}

export const DEFAULT_AUTOMATION_LIMITS: AutomationLimits = {
	decodedResourceMaxBytes: 256 * 1024 * 1024,
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
		phase?: string;
	}) => void | Promise<void>;
}

export interface EntryFilter {
	includeGlobs?: readonly string[];
	excludeGlobs?: readonly string[];
	caseSensitive?: boolean;
	compressed?: boolean;
	encrypted?: boolean;
	resourceTypes?: readonly EntryResourceType[];
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

export interface UnrecognizedFormatDiagnosis {
	kind:
		| "registered-extension-no-match"
		| "no-registered-format"
		| "unknown-format";
	extension: string | null;
	candidateFormatIds: readonly string[];
	message: string;
}

export interface UnrecognizedResource {
	source: InputReference;
	diagnosis: UnrecognizedFormatDiagnosis;
}

export interface UnrecognizedInspection extends UnrecognizedResource {
	recognized: false;
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
	unrecognized: UnrecognizedResource[];
	unrecognizedCount: number;
	failures: ScanFailure[];
	nextCursor: string | null;
	complete: boolean;
}

export type ExtractionSelection =
	| {
			mode: "all";
			excludeGlobs?: readonly string[];
			resourceTypes?: readonly EntryResourceType[];
	  }
	| {
			mode: "ids";
			entryIds: readonly string[];
			resourceTypes?: readonly EntryResourceType[];
	  }
	| {
			mode: "glob";
			includeGlobs: readonly string[];
			excludeGlobs?: readonly string[];
			caseSensitive?: boolean;
			resourceTypes?: readonly EntryResourceType[];
	  };

export type ConflictPolicy = "fail" | "skip" | "overwrite";

export interface ExtractionBudgets {
	maxResources?: number;
	maxInputBytes?: bigint;
	maxOutputBytes?: bigint;
	maxDecodedBytesPerResource?: bigint;
	timeoutMs?: number;
}

export interface ExtractionBudgetViolation {
	budget: keyof Omit<ExtractionBudgets, "timeoutMs">;
	actual: bigint;
	limit: bigint;
}

export interface ExtractionPlanItem {
	entryId: string;
	entryPath?: string;
	outputEntryPath?: string;
	packedBytes?: bigint;
	outputBytes?: bigint;
	decodedBytes?: bigint;
	status: "ready" | "skipped" | "failed";
	reason?: string;
	error?: GarbroError;
}

export interface ExtractionPlan {
	source: InputReference;
	formatId: string;
	outputRootId: string;
	outputDirectory: string;
	selected: number;
	ready: number;
	skipped: number;
	failed: number;
	inputBytes: bigint;
	outputBytes: bigint | null;
	unknownOutputSizes: number;
	budgetViolations: ExtractionBudgetViolation[];
	budgetUnknowns: Array<"maxOutputBytes" | "maxDecodedBytesPerResource">;
	items: ExtractionPlanItem[];
	planDigest: string;
}

export interface ExtractedArtifact {
	outputRootId: string;
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
			formatId: string;
			decoderId: string;
			error: GarbroError;
	  };

export interface BatchExtractionResult {
	status: "completed" | "partial" | "failed";
	hasFailures: boolean;
	outputRootId: string;
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
			(filter.encrypted === undefined ||
				entry.encrypted === filter.encrypted) &&
			(filter.resourceTypes === undefined ||
				filter.resourceTypes.includes(entryResourceType(entry))),
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

interface SelectedCandidate {
	id: string;
	entry: ArchiveEntry | undefined;
}

function selectCandidates(
	archive: ArchiveHandle,
	selection: ExtractionSelection,
): SelectedCandidate[] {
	if (selection.mode === "ids")
		return [...new Set(selection.entryIds)].flatMap((id) => {
			const entry = archive.entries.find((candidate) => candidate.id === id);
			if (
				entry !== undefined &&
				selection.resourceTypes !== undefined &&
				!selection.resourceTypes.includes(entryResourceType(entry))
			)
				return [];
			return [{ id, entry }];
		});
	const entries = filterArchiveEntries(archive.entries, {
		includeGlobs: selection.mode === "glob" ? selection.includeGlobs : ["**/*"],
		...(selection.excludeGlobs === undefined
			? {}
			: { excludeGlobs: selection.excludeGlobs }),
		...(selection.mode === "glob" && selection.caseSensitive !== undefined
			? { caseSensitive: selection.caseSensitive }
			: {}),
		...(selection.resourceTypes === undefined
			? {}
			: { resourceTypes: selection.resourceTypes }),
	});
	return entries.map((entry) => ({ id: entry.id, entry }));
}

function validateExtractionBudgets(budgets: ExtractionBudgets): void {
	if (
		budgets.maxResources !== undefined &&
		(!Number.isSafeInteger(budgets.maxResources) || budgets.maxResources <= 0)
	)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"maxResources must be a positive integer",
		);
	if (
		budgets.timeoutMs !== undefined &&
		(!Number.isSafeInteger(budgets.timeoutMs) || budgets.timeoutMs <= 0)
	)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"timeoutMs must be a positive integer",
		);
	for (const [name, value] of Object.entries(budgets)) {
		if (name === "maxResources" || name === "timeoutMs" || value === undefined)
			continue;
		if (typeof value !== "bigint" || value <= 0n)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`${name} must be a positive bigint`,
			);
	}
}

function decodedEntryBytes(entry: ArchiveEntry): bigint | undefined {
	const value = entry.metadata?.decodedBytes;
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
		return BigInt(value);
	if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
	return entry.sizeKnown === false ? undefined : entry.size;
}

async function removeEmptyDirectoryTree(path: string): Promise<boolean> {
	let children: Dirent[];
	try {
		children = await readdir(path, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
		throw error;
	}
	for (const child of children) {
		if (child.isSymbolicLink() || !child.isDirectory()) return false;
		if (!(await removeEmptyDirectoryTree(resolve(path, child.name))))
			return false;
	}
	try {
		await rmdir(path);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT") return true;
		if (code === "ENOTEMPTY" || code === "EEXIST") return false;
		throw error;
	}
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
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
	): Promise<ArchiveInspection | UnrecognizedInspection> {
		const resolved = await this.workspace.resolveInput(source, "file");
		const normalizedSource = {
			rootId: source.rootId,
			path: resolved.relativePath,
		};
		const detection = await this.registry.detectArchive(resolved.absolutePath);
		if (!detection)
			return {
				recognized: false,
				source: normalizedSource,
				diagnosis: this.#diagnoseUnrecognized(resolved.relativePath),
			};
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
		const unrecognized: UnrecognizedResource[] = [];
		let unrecognizedCount = 0;
		for (const [index, result] of inspected.entries()) {
			const file = page[index];
			if (!file) continue;
			const source = { rootId, path: file.rootRelative };
			if (result instanceof GarbroError)
				failures.push({ source, error: result });
			else if (!result) {
				unrecognizedCount += 1;
				if (options.includeUnrecognized)
					unrecognized.push({
						source,
						diagnosis: this.#diagnoseUnrecognized(file.rootRelative),
					});
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
		// Kept below planExtraction so callers can always preflight the same selection.
		source: InputReference,
		options: {
			selection?: ExtractionSelection;
			outputRootId?: string;
			outputSubdirectory?: string;
			conflictPolicy?: ConflictPolicy;
			budgets?: ExtractionBudgets;
			expectedPlanDigest?: string;
		},
		control: AutomationControl = {},
	): Promise<BatchExtractionResult> {
		const timeoutSignal =
			options.budgets?.timeoutMs === undefined
				? undefined
				: AbortSignal.timeout(options.budgets.timeoutMs);
		const operationSignal =
			control.signal === undefined
				? timeoutSignal
				: timeoutSignal === undefined
					? control.signal
					: AbortSignal.any([control.signal, timeoutSignal]);
		const operationControl = {
			...control,
			...(operationSignal === undefined ? {} : { signal: operationSignal }),
		};
		if (
			options.budgets !== undefined ||
			options.expectedPlanDigest !== undefined
		) {
			const plan = await this.planExtraction(
				source,
				{
					...(options.selection === undefined
						? {}
						: { selection: options.selection }),
					...(options.outputRootId === undefined
						? {}
						: { outputRootId: options.outputRootId }),
					...(options.outputSubdirectory === undefined
						? {}
						: { outputSubdirectory: options.outputSubdirectory }),
					...(options.conflictPolicy === undefined
						? {}
						: { conflictPolicy: options.conflictPolicy }),
					...(options.budgets === undefined
						? {}
						: { budgets: options.budgets }),
				},
				operationControl,
			);
			if (
				options.expectedPlanDigest !== undefined &&
				options.expectedPlanDigest !== plan.planDigest
			)
				throw new GarbroError(
					"PLAN_CHANGED",
					"Extraction inputs or destinations changed after planning",
					{
						details: {
							expectedPlanDigest: options.expectedPlanDigest,
							actualPlanDigest: plan.planDigest,
						},
					},
				);
			if (plan.budgetViolations.length > 0 || plan.budgetUnknowns.length > 0)
				throw new GarbroError(
					"LIMIT_EXCEEDED",
					"Extraction plan exceeds or cannot prove the requested budgets",
					{
						details: {
							violations: plan.budgetViolations.map((violation) => ({
								...violation,
								actual: violation.actual.toString(),
								limit: violation.limit.toString(),
							})),
							unknowns: plan.budgetUnknowns,
						},
					},
				);
		}
		const resolved = await this.workspace.resolveInput(source, "file");
		const defaultOutput = `${source.rootId}/${resolved.relativePath}.extracted`;
		const outputRelative = options.outputSubdirectory ?? defaultOutput;
		const outputRootId =
			options.outputRootId ?? this.workspace.outputRoots[0]?.id ?? "default";
		const outputRoot = this.workspace.resolveOutputRoot(outputRootId);
		const normalizedOutput = normalizeWorkspaceRelativePath(
			outputRelative,
			true,
		);
		const intendedOutputDirectory =
			normalizedOutput === "."
				? outputRoot
				: resolve(outputRoot, ...normalizedOutput.split("/"));
		const outputExisted =
			(await pathInfo(intendedOutputDirectory)) !== undefined;
		const outputDirectory = await this.workspace.resolveOutputDirectory(
			outputRelative,
			outputRootId,
		);
		const conflictPolicy = options.conflictPolicy ?? "fail";
		return await this.#withArchive(resolved.absolutePath, async (archive) => {
			const selection = options.selection ?? { mode: "all" as const };
			const selected = selectCandidates(archive, selection);
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
						extractionPathForEntry(candidate.entry),
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
						resolveEntryOutputPath(
							outputDirectory,
							extractionPathForEntry(candidate.entry),
						);
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
				throwIfCancelled(operationControl.signal);
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
						safetyRoot: outputRoot,
						overwrite: conflictPolicy === "overwrite",
						...(operationControl.signal === undefined
							? {}
							: { signal: operationControl.signal }),
					});
					const artifactRelative = toPosix(
						relative(outputRoot, result.outputPath),
					);
					extracted += 1;
					bytesWritten += result.bytesWritten;
					items.push({
						entryId: entry.id,
						entryPath: entry.path,
						status: "extracted",
						artifact: {
							outputRootId,
							relativePath: artifactRelative,
							absolutePath: result.outputPath,
							bytesWritten: result.bytesWritten,
							sha256: result.sha256,
						},
					});
				} catch (error) {
					if (operationControl.signal?.aborted)
						throw new GarbroError("CANCELLED", "Operation was cancelled", {
							cause: error,
						});
					failed += 1;
					items.push({
						entryId: candidate.id,
						...(entry === undefined ? {} : { entryPath: entry.path }),
						status: "failed",
						formatId: archive.format.id,
						decoderId:
							typeof entry?.metadata?.decoderId === "string"
								? entry.metadata.decoderId
								: archive.format.id,
						error: asGarbroError(error),
					});
				} finally {
					await operationControl.onProgress?.({
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
			if (status === "failed" && !outputExisted)
				await removeEmptyDirectoryTree(outputDirectory);
			return {
				status,
				hasFailures: failed > 0,
				outputRootId,
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

	async planExtraction(
		source: InputReference,
		options: {
			selection?: ExtractionSelection;
			outputRootId?: string;
			outputSubdirectory?: string;
			conflictPolicy?: ConflictPolicy;
			budgets?: ExtractionBudgets;
		},
		control: AutomationControl = {},
	): Promise<ExtractionPlan> {
		validateExtractionBudgets(options.budgets ?? {});
		const resolved = await this.workspace.resolveInput(source, "file");
		const sourceInfo = await lstat(resolved.absolutePath);
		const defaultOutput = `${source.rootId}/${resolved.relativePath}.extracted`;
		const outputRelative = options.outputSubdirectory ?? defaultOutput;
		const outputRootId =
			options.outputRootId ?? this.workspace.outputRoots[0]?.id ?? "default";
		const { absolute: outputDirectory } = this.workspace.resolveOutputPath(
			outputRelative,
			outputRootId,
		);
		const conflictPolicy = options.conflictPolicy ?? "fail";
		return await this.#withArchive(resolved.absolutePath, async (archive) => {
			const selection = options.selection ?? { mode: "all" as const };
			const selected = selectCandidates(archive, selection);
			if (selected.length > this.limits.maxBatchEntries)
				throw new GarbroError(
					"LIMIT_EXCEEDED",
					`Selection exceeds ${this.limits.maxBatchEntries} entries`,
				);
			const destinations = new Map<string, string[]>();
			for (const candidate of selected) {
				if (!candidate.entry) continue;
				try {
					const destination = resolveEntryOutputPath(
						outputDirectory,
						extractionPathForEntry(candidate.entry),
					);
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
			const items: ExtractionPlanItem[] = [];
			let inputBytes = 0n;
			let outputBytes = 0n;
			let unknownOutputSizes = 0;
			let ready = 0;
			let skipped = 0;
			let failed = 0;
			for (const candidate of selected) {
				throwIfCancelled(control.signal);
				if (!candidate.entry) {
					const error = new GarbroError(
						"ENTRY_NOT_FOUND",
						`Archive entry not found: ${candidate.id}`,
					);
					items.push({
						entryId: candidate.id,
						status: "failed",
						error,
					});
					failed += 1;
					continue;
				}
				const entry = candidate.entry;
				const decodedBytes = decodedEntryBytes(entry);
				const common = {
					entryId: candidate.id,
					entryPath: entry.path,
					packedBytes: entry.packedSize,
					...(entry.sizeKnown === false ? {} : { outputBytes: entry.size }),
					...(decodedBytes === undefined ? {} : { decodedBytes }),
				};
				try {
					const outputEntryPath = extractionPathForEntry(entry);
					const base = { ...common, outputEntryPath };
					if (duplicateIds.has(candidate.id))
						throw new GarbroError(
							"UNSAFE_PATH",
							`Multiple entries resolve to the same output path: ${entry.path}`,
						);
					const destination = resolveEntryOutputPath(
						outputDirectory,
						outputEntryPath,
					);
					const info = await pathInfo(destination);
					if (info && conflictPolicy === "skip") {
						items.push({ ...base, status: "skipped", reason: "output exists" });
						skipped += 1;
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
					items.push({ ...base, status: "ready" });
					ready += 1;
					inputBytes += entry.packedSize;
					if (entry.sizeKnown === false) unknownOutputSizes += 1;
					else outputBytes += entry.size;
				} catch (error) {
					items.push({
						...common,
						status: "failed",
						error: asGarbroError(error),
					});
					failed += 1;
				}
			}
			const budgets = options.budgets ?? {};
			const budgetViolations: ExtractionBudgetViolation[] = [];
			if (budgets.maxResources !== undefined && ready > budgets.maxResources)
				budgetViolations.push({
					budget: "maxResources",
					actual: BigInt(ready),
					limit: BigInt(budgets.maxResources),
				});
			if (
				budgets.maxInputBytes !== undefined &&
				inputBytes > budgets.maxInputBytes
			)
				budgetViolations.push({
					budget: "maxInputBytes",
					actual: inputBytes,
					limit: budgets.maxInputBytes,
				});
			if (
				budgets.maxOutputBytes !== undefined &&
				unknownOutputSizes === 0 &&
				outputBytes > budgets.maxOutputBytes
			)
				budgetViolations.push({
					budget: "maxOutputBytes",
					actual: outputBytes,
					limit: budgets.maxOutputBytes,
				});
			if (budgets.maxDecodedBytesPerResource !== undefined)
				for (const item of items) {
					if (
						item.status === "ready" &&
						item.decodedBytes !== undefined &&
						item.decodedBytes > budgets.maxDecodedBytesPerResource
					)
						budgetViolations.push({
							budget: "maxDecodedBytesPerResource",
							actual: item.decodedBytes,
							limit: budgets.maxDecodedBytesPerResource,
						});
				}
			const budgetUnknowns: ExtractionPlan["budgetUnknowns"] = [];
			if (budgets.maxOutputBytes !== undefined && unknownOutputSizes > 0)
				budgetUnknowns.push("maxOutputBytes");
			if (
				budgets.maxDecodedBytesPerResource !== undefined &&
				items.some(
					(item) => item.status === "ready" && item.decodedBytes === undefined,
				)
			)
				budgetUnknowns.push("maxDecodedBytesPerResource");
			const digestValue = JSON.stringify({
				source: { rootId: source.rootId, path: resolved.relativePath },
				sourceSize: sourceInfo.size,
				sourceMtimeMs: sourceInfo.mtimeMs,
				formatId: archive.format.id,
				outputRootId,
				outputDirectory,
				conflictPolicy,
				items: items.map((item) => ({
					...item,
					packedBytes: item.packedBytes?.toString(),
					outputBytes: item.outputBytes?.toString(),
					decodedBytes: item.decodedBytes?.toString(),
					error:
						item.error === undefined
							? undefined
							: { code: item.error.code, message: item.error.message },
				})),
			});
			return {
				source: { rootId: source.rootId, path: resolved.relativePath },
				formatId: archive.format.id,
				outputRootId,
				outputDirectory,
				selected: selected.length,
				ready,
				skipped,
				failed,
				inputBytes,
				outputBytes: unknownOutputSizes === 0 ? outputBytes : null,
				unknownOutputSizes,
				budgetViolations,
				budgetUnknowns,
				items,
				planDigest: createHash("sha256").update(digestValue).digest("hex"),
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

	#diagnoseUnrecognized(path: string): UnrecognizedFormatDiagnosis {
		const extension = extname(path).slice(1).toLowerCase();
		if (extension.length === 0)
			return {
				kind: "unknown-format",
				extension: null,
				candidateFormatIds: [],
				message:
					"No supported format matched and the file has no extension to identify a known family.",
			};
		const candidates = this.registry.listFormatsForExtension(extension);
		if (candidates.length > 0) {
			const candidateFormatIds = candidates.map((format) => format.id);
			return {
				kind: "registered-extension-no-match",
				extension,
				candidateFormatIds,
				message: `Registered formats for .${extension} did not match this file; it may be an unsupported variant. Candidates: ${candidateFormatIds.join(", ")}.`,
			};
		}
		return {
			kind: "no-registered-format",
			extension,
			candidateFormatIds: [],
			message: `No registered format supports the .${extension} extension.`,
		};
	}
}
