import { AsyncJobManager, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";

describe("AsyncJobManager", () => {
	it("runs in the background and records progress", async () => {
		const manager = new AsyncJobManager<number>();
		const job = manager.start(
			async ({ onProgress }) => {
				await onProgress?.({
					progress: 1,
					total: 2,
					message: "first",
					phase: "working",
				});
				await new Promise((resolve) => setTimeout(resolve, 1));
				await onProgress?.({
					progress: 2,
					total: 2,
					message: "second",
					phase: "working",
				});
				return 42;
			},
			{ kind: "test" },
		);
		expect(job.state).toBe("queued");
		const waited = await manager.wait(job.jobId, {
			until: "terminal",
			timeoutMs: 1_000,
		});
		expect(waited).toMatchObject({
			outcome: "terminal",
			snapshot: {
				kind: "test",
				state: "completed",
				progress: 2,
				total: 2,
				message: "second",
				phase: "working",
				result: 42,
			},
		});
	});

	it("waits for a revision change without guessing a polling delay", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const manager = new AsyncJobManager<void>();
		const job = manager.start(async () => await gate);
		const changed = await manager.wait(job.jobId, {
			until: "change",
			afterRevision: job.revision,
			timeoutMs: 1_000,
		});
		expect(changed).toMatchObject({
			outcome: "changed",
			snapshot: { state: "running", revision: 1 },
		});
		release();
		await expect(
			manager.wait(job.jobId, { until: "terminal", timeoutMs: 1_000 }),
		).resolves.toMatchObject({ outcome: "terminal" });
	});

	it("returns the latest snapshot when a server-side wait times out", async () => {
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const manager = new AsyncJobManager<void>();
		const job = manager.start(async () => await gate);
		await expect(
			manager.wait(job.jobId, { until: "terminal", timeoutMs: 5 }),
		).resolves.toMatchObject({
			outcome: "timeout",
			snapshot: { state: "running" },
		});
		release();
		await manager.wait(job.jobId, { until: "terminal", timeoutMs: 1_000 });
	});

	it("cancels a running job through its AbortSignal", async () => {
		const manager = new AsyncJobManager<void>();
		const job = manager.start(async ({ signal }) => {
			await new Promise<void>((_resolve, reject) => {
				if (signal?.aborted)
					return reject(new GarbroError("CANCELLED", "cancelled"));
				signal?.addEventListener(
					"abort",
					() => reject(new GarbroError("CANCELLED", "cancelled")),
					{ once: true },
				);
			});
		});
		await manager.wait(job.jobId, {
			until: "change",
			afterRevision: job.revision,
			timeoutMs: 1_000,
		});
		manager.cancel(job.jobId);
		await expect(
			manager.wait(job.jobId, { until: "terminal", timeoutMs: 1_000 }),
		).resolves.toMatchObject({
			outcome: "terminal",
			snapshot: { state: "cancelled" },
		});
	});
});
