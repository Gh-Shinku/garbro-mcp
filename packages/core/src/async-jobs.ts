import { randomUUID } from "node:crypto";
import { asGarbroError, type GarbroError } from "./errors.js";
import type { AutomationControl } from "./automation.js";

export type AsyncJobState =
	| "queued"
	| "running"
	| "completed"
	| "partial"
	| "failed"
	| "cancelled";

export interface AsyncJobSnapshot<T> {
	jobId: string;
	state: AsyncJobState;
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	progress: number;
	total?: number;
	message?: string;
	result?: T;
	error?: GarbroError;
}

interface JobRecord<T> extends AsyncJobSnapshot<T> {
	controller: AbortController;
	run: (control: AutomationControl) => Promise<T>;
	stateFromResult?: (
		result: T,
	) => Exclude<AsyncJobState, "queued" | "running" | "cancelled">;
}

/** In-process background task manager with cancellation and progress snapshots. */
export class AsyncJobManager<T> {
	readonly #jobs = new Map<string, JobRecord<T>>();
	readonly #maxJobs: number;

	constructor(options: { maxJobs?: number } = {}) {
		this.#maxJobs = options.maxJobs ?? 128;
		if (!Number.isSafeInteger(this.#maxJobs) || this.#maxJobs <= 0)
			throw new Error("maxJobs must be a positive integer");
	}

	start(
		run: (control: AutomationControl) => Promise<T>,
		options: {
			stateFromResult?: (
				result: T,
			) => Exclude<AsyncJobState, "queued" | "running" | "cancelled">;
		} = {},
	): AsyncJobSnapshot<T> {
		this.#prune();
		const now = new Date().toISOString();
		const record: JobRecord<T> = {
			jobId: randomUUID(),
			state: "queued",
			createdAt: now,
			progress: 0,
			controller: new AbortController(),
			run,
			...(options.stateFromResult === undefined
				? {}
				: { stateFromResult: options.stateFromResult }),
		};
		this.#jobs.set(record.jobId, record);
		queueMicrotask(() => void this.#execute(record));
		return this.#snapshot(record);
	}

	get(jobId: string): AsyncJobSnapshot<T> | undefined {
		const record = this.#jobs.get(jobId);
		return record === undefined ? undefined : this.#snapshot(record);
	}

	cancel(jobId: string): AsyncJobSnapshot<T> | undefined {
		const record = this.#jobs.get(jobId);
		if (record === undefined) return undefined;
		if (record.state === "queued") {
			record.controller.abort();
			record.state = "cancelled";
			record.finishedAt = new Date().toISOString();
		} else if (record.state === "running") record.controller.abort();
		return this.#snapshot(record);
	}

	async #execute(record: JobRecord<T>): Promise<void> {
		if (record.state !== "queued") return;
		record.state = "running";
		record.startedAt = new Date().toISOString();
		try {
			const result = await record.run({
				signal: record.controller.signal,
				onProgress: ({ progress, total, message }) => {
					record.progress = progress;
					if (total === undefined) delete record.total;
					else record.total = total;
					if (message === undefined) delete record.message;
					else record.message = message;
				},
			});
			if (record.controller.signal.aborted) {
				record.state = "cancelled";
			} else {
				record.result = result;
				record.state = record.stateFromResult?.(result) ?? "completed";
			}
		} catch (error) {
			const converted = asGarbroError(error);
			record.error = converted;
			record.state =
				record.controller.signal.aborted || converted.code === "CANCELLED"
					? "cancelled"
					: "failed";
		} finally {
			record.finishedAt = new Date().toISOString();
		}
	}

	#snapshot(record: JobRecord<T>): AsyncJobSnapshot<T> {
		return {
			jobId: record.jobId,
			state: record.state,
			createdAt: record.createdAt,
			...(record.startedAt === undefined
				? {}
				: { startedAt: record.startedAt }),
			...(record.finishedAt === undefined
				? {}
				: { finishedAt: record.finishedAt }),
			progress: record.progress,
			...(record.total === undefined ? {} : { total: record.total }),
			...(record.message === undefined ? {} : { message: record.message }),
			...(record.result === undefined ? {} : { result: record.result }),
			...(record.error === undefined ? {} : { error: record.error }),
		};
	}

	#prune(): void {
		if (this.#jobs.size < this.#maxJobs) return;
		for (const [jobId, record] of this.#jobs) {
			if (record.state === "queued" || record.state === "running") continue;
			this.#jobs.delete(jobId);
			if (this.#jobs.size < this.#maxJobs) return;
		}
	}
}
