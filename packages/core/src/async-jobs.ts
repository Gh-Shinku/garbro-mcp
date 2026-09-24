import { randomUUID } from "node:crypto";
import type { AutomationControl } from "./automation.js";
import { asGarbroError, GarbroError } from "./errors.js";

export type AsyncJobState =
	| "queued"
	| "running"
	| "completed"
	| "partial"
	| "failed"
	| "cancelled";

export interface AsyncJobSnapshot<T> {
	jobId: string;
	kind?: string;
	state: AsyncJobState;
	revision: number;
	createdAt: string;
	startedAt?: string;
	finishedAt?: string;
	progress: number;
	total?: number;
	message?: string;
	phase?: string;
	result?: T;
	error?: GarbroError;
}

export type AsyncJobWaitUntil = "change" | "terminal";
export type AsyncJobWaitOutcome = "changed" | "terminal" | "timeout";

export interface AsyncJobWaitResult<T> {
	snapshot: AsyncJobSnapshot<T>;
	outcome: AsyncJobWaitOutcome;
}

interface JobRecord<T> extends AsyncJobSnapshot<T> {
	controller: AbortController;
	run: (control: AutomationControl, jobId: string) => Promise<T>;
	stateFromResult?: (
		result: T,
	) => Exclude<AsyncJobState, "queued" | "running" | "cancelled">;
}

/** In-process background task manager with cancellation and progress snapshots. */
export class AsyncJobManager<T> {
	readonly #jobs = new Map<string, JobRecord<T>>();
	readonly #waiters = new Map<string, Set<() => void>>();
	readonly #maxJobs: number;

	constructor(options: { maxJobs?: number } = {}) {
		this.#maxJobs = options.maxJobs ?? 128;
		if (!Number.isSafeInteger(this.#maxJobs) || this.#maxJobs <= 0)
			throw new Error("maxJobs must be a positive integer");
	}

	start(
		run: (control: AutomationControl, jobId: string) => Promise<T>,
		options: {
			kind?: string;
			stateFromResult?: (
				result: T,
			) => Exclude<AsyncJobState, "queued" | "running" | "cancelled">;
		} = {},
	): AsyncJobSnapshot<T> {
		this.#prune();
		const now = new Date().toISOString();
		const record: JobRecord<T> = {
			jobId: randomUUID(),
			...(options.kind === undefined ? {} : { kind: options.kind }),
			state: "queued",
			revision: 0,
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

	async wait(
		jobId: string,
		options: {
			until: AsyncJobWaitUntil;
			afterRevision?: number;
			timeoutMs: number;
			signal?: AbortSignal;
		},
	): Promise<AsyncJobWaitResult<T> | undefined> {
		if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0)
			throw new Error("timeoutMs must be a non-negative integer");
		const initial = this.#jobs.get(jobId);
		if (initial === undefined) return undefined;
		const waitOptions = {
			...options,
			afterRevision: options.afterRevision ?? initial.revision,
		};
		const outcome = this.#waitOutcome(initial, waitOptions);
		if (outcome !== undefined)
			return { snapshot: this.#snapshot(initial), outcome };

		return await new Promise<AsyncJobWaitResult<T>>((resolve, reject) => {
			let settled = false;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			const waiters = this.#waiters.get(jobId) ?? new Set<() => void>();
			this.#waiters.set(jobId, waiters);
			const cleanup = () => {
				if (timeout !== undefined) clearTimeout(timeout);
				options.signal?.removeEventListener("abort", onAbort);
				waiters.delete(onChange);
				if (waiters.size === 0) this.#waiters.delete(jobId);
			};
			const finish = (result: AsyncJobWaitResult<T>) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(result);
			};
			const onChange = () => {
				const record = this.#jobs.get(jobId);
				if (record === undefined) return;
				const nextOutcome = this.#waitOutcome(record, waitOptions);
				if (nextOutcome !== undefined)
					finish({ snapshot: this.#snapshot(record), outcome: nextOutcome });
			};
			const onAbort = () => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(new GarbroError("CANCELLED", "Task status wait was cancelled"));
			};
			waiters.add(onChange);
			if (options.signal?.aborted) return onAbort();
			options.signal?.addEventListener("abort", onAbort, { once: true });
			timeout = setTimeout(() => {
				const record = this.#jobs.get(jobId);
				if (record !== undefined)
					finish({ snapshot: this.#snapshot(record), outcome: "timeout" });
			}, options.timeoutMs);
			onChange();
		});
	}

	cancel(jobId: string): AsyncJobSnapshot<T> | undefined {
		const record = this.#jobs.get(jobId);
		if (record === undefined) return undefined;
		if (record.state === "queued") {
			record.controller.abort();
			record.state = "cancelled";
			record.finishedAt = new Date().toISOString();
			this.#changed(record);
		} else if (record.state === "running") record.controller.abort();
		return this.#snapshot(record);
	}

	async #execute(record: JobRecord<T>): Promise<void> {
		if (record.state !== "queued") return;
		record.state = "running";
		record.startedAt = new Date().toISOString();
		this.#changed(record);
		try {
			const result = await record.run(
				{
					signal: record.controller.signal,
					onProgress: ({ progress, total, message, phase }) => {
						record.progress = progress;
						if (total === undefined) delete record.total;
						else record.total = total;
						if (message === undefined) delete record.message;
						else record.message = message;
						if (phase === undefined) delete record.phase;
						else record.phase = phase;
						this.#changed(record);
					},
				},
				record.jobId,
			);
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
			this.#changed(record);
		}
	}

	#changed(record: JobRecord<T>): void {
		record.revision += 1;
		for (const notify of [...(this.#waiters.get(record.jobId) ?? [])]) notify();
	}

	#waitOutcome(
		record: JobRecord<T>,
		options: { until: AsyncJobWaitUntil; afterRevision?: number },
	): Exclude<AsyncJobWaitOutcome, "timeout"> | undefined {
		if (isTerminal(record.state)) return "terminal";
		if (
			options.until === "change" &&
			options.afterRevision !== undefined &&
			record.revision > options.afterRevision
		)
			return "changed";
		return undefined;
	}

	#snapshot(record: JobRecord<T>): AsyncJobSnapshot<T> {
		return {
			jobId: record.jobId,
			...(record.kind === undefined ? {} : { kind: record.kind }),
			state: record.state,
			revision: record.revision,
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
			...(record.phase === undefined ? {} : { phase: record.phase }),
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

function isTerminal(state: AsyncJobState): boolean {
	return !["queued", "running"].includes(state);
}
