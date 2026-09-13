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
	readonly outputRoot: string;
	readonly inputRoots: readonly WorkspaceRootInfo[];
	readonly #rootMap: ReadonlyMap<string, string>;

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
		this.outputRoot = resolve(cwd, options.outputRoot ?? "garbro-output");
	}

	async prepare(): Promise<void> {
		for (const root of this.inputRoots) {
			const info = await stat(root.path);
			if (!info.isDirectory())
				throw new GarbroError(
					"INVALID_ARGUMENT",
					`Input root is not a directory: ${root.path}`,
				);
		}
		await ensureDirectoryTree(this.outputRoot);
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

	async resolveOutputDirectory(path: string): Promise<string> {
		const relativePath = normalizeWorkspaceRelativePath(path, true);
		await ensureDirectoryTree(this.outputRoot);
		const absolute =
			relativePath === "."
				? this.outputRoot
				: resolve(this.outputRoot, ...relativePath.split("/"));
		if (!isWithin(this.outputRoot, absolute))
			throw new GarbroError("UNSAFE_PATH", `Output path escapes root: ${path}`);
		await ensureDirectoryTree(absolute);
		return absolute;
	}

	isOutputPath(path: string): boolean {
		return isWithin(this.outputRoot, resolve(path));
	}
}
