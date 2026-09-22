import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import {
	isAbsolute,
	join,
	parse,
	relative,
	resolve,
	sep,
	win32,
} from "node:path";
import { GarbroError } from "./errors.js";

const ROOT_ID = /^[a-z][a-z0-9_-]{0,31}$/;

export interface InputReference {
	rootId: string;
	path: string;
}

export interface WorkspacePolicyOptions {
	inputRoots?: Readonly<Record<string, string>>;
	outputRoot?: string;
	outputRoots?: Readonly<Record<string, string>>;
	workingDirectory?: string;
}

export interface WorkspaceRootInfo {
	id: string;
	path: string;
}

function isWithin(root: string, candidate: string): boolean {
	const relation = relative(root, candidate);
	return (
		relation === "" ||
		(relation !== ".." &&
			!relation.startsWith(`..${sep}`) &&
			!isAbsolute(relation))
	);
}

export function normalizeWorkspaceRelativePath(
	value: string,
	allowRoot = false,
): string {
	if (value.includes("\0") || isAbsolute(value) || win32.isAbsolute(value)) {
		throw new GarbroError("UNSAFE_PATH", `Unsafe workspace path: ${value}`);
	}
	const normalized = value.replaceAll("\\", "/");
	if (allowRoot && (normalized === "" || normalized === ".")) return ".";
	const segments = normalized.split("/");
	if (
		segments.length === 0 ||
		segments.some(
			(segment) =>
				segment === "" ||
				segment === "." ||
				segment === ".." ||
				segment.includes(":"),
		)
	) {
		throw new GarbroError("UNSAFE_PATH", `Unsafe workspace path: ${value}`);
	}
	return segments.join("/");
}

async function ensureDirectoryTree(path: string): Promise<void> {
	const absolute = resolve(path);
	const root = parse(absolute).root;
	let current = root;
	for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
		current = join(current, segment);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink() || !info.isDirectory()) {
				throw new GarbroError(
					"UNSAFE_PATH",
					`Workspace output path is not a real directory: ${current}`,
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

export class WorkspacePolicy {
	readonly inputRoots: readonly WorkspaceRootInfo[];
	readonly outputRoots: readonly WorkspaceRootInfo[];
	readonly #rootMap: ReadonlyMap<string, string>;
	readonly #outputRootMap: ReadonlyMap<string, string>;

	constructor(options: WorkspacePolicyOptions = {}) {
		const cwd = resolve(options.workingDirectory ?? process.cwd());
		const configured = options.inputRoots ?? { workspace: cwd };
		const roots: WorkspaceRootInfo[] = [];
		const rootMap = new Map<string, string>();
		for (const [id, path] of Object.entries(configured)) {
			if (!ROOT_ID.test(id))
				throw new GarbroError(
					"INVALID_ARGUMENT",
					`Invalid input root ID: ${id}`,
				);
			if (rootMap.has(id))
				throw new GarbroError(
					"INVALID_ARGUMENT",
					`Duplicate input root ID: ${id}`,
				);
			const absolute = resolve(cwd, path);
			rootMap.set(id, absolute);
			roots.push({ id, path: absolute });
		}
		if (roots.length === 0)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"At least one input root is required",
			);
		this.inputRoots = roots;
		this.#rootMap = rootMap;
		if (options.outputRoot !== undefined && options.outputRoots !== undefined)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"Configure outputRoot or outputRoots, not both",
			);
		const configuredOutputs = options.outputRoots ?? {
			default: options.outputRoot ?? "garbro-output",
		};
		const outputRoots: WorkspaceRootInfo[] = [];
		const outputRootMap = new Map<string, string>();
		for (const [id, path] of Object.entries(configuredOutputs)) {
			if (!ROOT_ID.test(id))
				throw new GarbroError(
					"INVALID_ARGUMENT",
					`Invalid output root ID: ${id}`,
				);
			const absolute = resolve(cwd, path);
			outputRootMap.set(id, absolute);
			outputRoots.push({ id, path: absolute });
		}
		if (outputRoots.length === 0)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"At least one output root is required",
			);
		this.outputRoots = outputRoots;
		this.#outputRootMap = outputRootMap;
	}

	/** The legacy default output root. Prefer resolveOutputRoot for new code. */
	get outputRoot(): string {
		return this.outputRoots[0]?.path ?? "";
	}

	resolveOutputRoot(rootId?: string): string {
		const resolvedRootId = rootId ?? this.outputRoots[0]?.id ?? "default";
		const configuredRoot = this.#outputRootMap.get(resolvedRootId);
		if (configuredRoot !== undefined) return configuredRoot;
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`Unknown output root: ${resolvedRootId}`,
			{
				details: {
					allowedRoots: this.outputRoots.map((root) => root.id),
				},
			},
		);
	}

	async prepare(options: { createOutput?: boolean } = {}): Promise<void> {
		for (const root of this.inputRoots) {
			const info = await stat(root.path);
			if (!info.isDirectory())
				throw new GarbroError(
					"INVALID_ARGUMENT",
					`Input root is not a directory: ${root.path}`,
				);
		}
		if (options.createOutput ?? true)
			for (const root of this.outputRoots) await ensureDirectoryTree(root.path);
	}

	async resolveInput(
		reference: InputReference,
		kind: "file" | "directory" | "either" = "either",
	): Promise<{ absolutePath: string; relativePath: string }> {
		const configuredRoot = this.#rootMap.get(reference.rootId);
		if (!configuredRoot)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Unknown input root: ${reference.rootId}`,
			);
		const relativePath = normalizeWorkspaceRelativePath(reference.path, true);
		const canonicalRoot = await realpath(configuredRoot);
		const candidate =
			relativePath === "."
				? configuredRoot
				: resolve(configuredRoot, ...relativePath.split("/"));
		const absolutePath = await realpath(candidate);
		if (!isWithin(canonicalRoot, absolutePath))
			throw new GarbroError(
				"UNSAFE_PATH",
				`Input path escapes root ${reference.rootId}: ${reference.path}`,
			);
		const info = await stat(absolutePath);
		if (kind === "file" && !info.isFile())
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Input is not a file: ${reference.path}`,
			);
		if (kind === "directory" && !info.isDirectory())
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Input is not a directory: ${reference.path}`,
			);
		return { absolutePath, relativePath };
	}

	async resolveOutputDirectory(path: string, rootId?: string): Promise<string> {
		const { outputRoot, absolute } = this.resolveOutputPath(path, rootId);
		await ensureDirectoryTree(outputRoot);
		await ensureDirectoryTree(absolute);
		return absolute;
	}

	async resolveOutputArtifact(
		path: string,
		rootId?: string,
	): Promise<{
		outputRootId: string;
		relativePath: string;
		absolutePath: string;
	}> {
		const relativePath = normalizeWorkspaceRelativePath(path);
		const outputRootId = rootId ?? this.outputRoots[0]?.id ?? "default";
		const outputRoot = this.resolveOutputRoot(outputRootId);
		const canonicalRoot = await realpath(outputRoot);
		const candidate = resolve(outputRoot, ...relativePath.split("/"));
		const absolutePath = await realpath(candidate);
		if (!isWithin(canonicalRoot, absolutePath))
			throw new GarbroError(
				"UNSAFE_PATH",
				`Output artifact escapes root ${outputRootId}: ${path}`,
			);
		const info = await lstat(absolutePath);
		if (info.isSymbolicLink() || !info.isFile())
			throw new GarbroError(
				"UNSAFE_PATH",
				`Output artifact is not a regular file: ${path}`,
			);
		return { outputRootId, relativePath, absolutePath };
	}

	resolveOutputPath(
		path: string,
		rootId?: string,
	): { outputRootId: string; outputRoot: string; absolute: string } {
		const relativePath = normalizeWorkspaceRelativePath(path, true);
		const outputRootId = rootId ?? this.outputRoots[0]?.id ?? "default";
		const outputRoot = this.resolveOutputRoot(outputRootId);
		const absolute =
			relativePath === "."
				? outputRoot
				: resolve(outputRoot, ...relativePath.split("/"));
		if (!isWithin(outputRoot, absolute))
			throw new GarbroError(
				"UNSAFE_PATH",
				`Output path escapes root: ${path}`,
				{
					details: {
						allowedRoots: this.outputRoots.map((root) => root.id),
						outputRootId: rootId ?? this.outputRoots[0]?.id,
					},
				},
			);
		return { outputRootId, outputRoot, absolute };
	}

	isOutputPath(path: string): boolean {
		const absolute = resolve(path);
		return this.outputRoots.some((root) => isWithin(root.path, absolute));
	}
}
