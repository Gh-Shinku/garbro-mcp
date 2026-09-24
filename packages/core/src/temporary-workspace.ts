import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, parse, resolve } from "node:path";
import { GarbroError } from "./errors.js";

const TASK_DIRECTORY =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface TemporaryWorkspaceOptions {
	tempDirectory?: string;
	retentionMs?: number;
}

export interface TemporaryTaskDirectory {
	path: string;
	expiresAt: string;
}

/** Owns isolated, expiring task directories below an OS or administrator-selected temp root. */
export class TemporaryWorkspaceManager {
	readonly tempDirectory: string;
	readonly retentionMs: number;

	constructor(options: TemporaryWorkspaceOptions = {}) {
		const configured = options.tempDirectory ?? join(tmpdir(), "garbro-mcp");
		if (!isAbsolute(configured))
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"The temporary directory must be an absolute path",
			);
		this.tempDirectory = resolve(configured);
		if (this.tempDirectory === parse(this.tempDirectory).root)
			throw new GarbroError(
				"UNSAFE_PATH",
				"The filesystem root cannot be used as the temporary directory",
			);
		this.retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
		if (!Number.isSafeInteger(this.retentionMs) || this.retentionMs <= 0)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"Temporary workspace retention must be a positive integer",
			);
	}

	async prepare(now = Date.now()): Promise<void> {
		await mkdir(this.tempDirectory, { recursive: true });
		const root = await lstat(this.tempDirectory);
		if (root.isSymbolicLink() || !root.isDirectory())
			throw new GarbroError(
				"UNSAFE_PATH",
				`Temporary workspace is not a real directory: ${this.tempDirectory}`,
			);
		for (const entry of await readdir(this.tempDirectory, {
			withFileTypes: true,
		})) {
			if (!TASK_DIRECTORY.test(entry.name)) continue;
			const path = join(this.tempDirectory, entry.name);
			const info = await lstat(path);
			if (now - info.mtimeMs < this.retentionMs) continue;
			await rm(path, { recursive: entry.isDirectory(), force: true });
		}
	}

	async allocate(
		taskId: string,
		now = Date.now(),
	): Promise<TemporaryTaskDirectory> {
		if (!TASK_DIRECTORY.test(taskId))
			throw new GarbroError("INVALID_ARGUMENT", `Invalid task ID: ${taskId}`);
		await this.prepare(now);
		const path = join(this.tempDirectory, taskId);
		await mkdir(path, { recursive: false });
		return {
			path,
			expiresAt: new Date(now + this.retentionMs).toISOString(),
		};
	}
}
