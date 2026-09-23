import { AsyncJobManager, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";

describe("AsyncJobManager", () => {
	it("runs in the background and records progress", async () => {
		const manager = new AsyncJobManager<number>();
		const job = manager.start(async ({ onProgress }) => {
			await onProgress?.({ progress: 1, total: 2, message: "first" });
			await new Promise((resolve) => setTimeout(resolve, 1));
			await onProgress?.({ progress: 2, total: 2, message: "second" });
			return 42;
		});
		expect(job.state).toBe("queued");
		for (;;) {
			const current = manager.get(job.jobId);
			if (current?.state === "completed") {
				expect(current).toMatchObject({
					progress: 2,
					total: 2,
					message: "second",
					result: 42,
				});
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
	});

	it("cancels a running job through its AbortSignal", async () => {
		const manager = new AsyncJobManager<void>();
		const job = manager.start(async ({ signal }) => {
			await new Promise<void>((resolve, reject) => {
				if (signal?.aborted)
					return reject(new GarbroError("CANCELLED", "cancelled"));
				signal?.addEventListener(
					"abort",
					() => reject(new GarbroError("CANCELLED", "cancelled")),
					{ once: true },
				);
			});
		});
		for (;;) {
			const current = manager.get(job.jobId);
			if (current?.state === "running") break;
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		manager.cancel(job.jobId);
		for (;;) {
			const current = manager.get(job.jobId);
			if (current?.state === "cancelled") break;
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		expect(manager.get(job.jobId)?.state).toBe("cancelled");
	});
});
