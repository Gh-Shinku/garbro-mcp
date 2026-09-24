import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parse, resolve } from "node:path";
import { TemporaryWorkspaceManager } from "@garbro-mcp/core";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("TemporaryWorkspaceManager", () => {
	it("allocates isolated task directories and reports expiry", async () => {
		const parent = await mkdtemp(resolve(tmpdir(), "garbro-temp-test-"));
		temporaryDirectories.push(parent);
		const manager = new TemporaryWorkspaceManager({
			tempDirectory: resolve(parent, "garbro"),
			retentionMs: 60_000,
		});
		const task = await manager.allocate(
			"12345678-1234-4234-8234-123456789abc",
			1_000,
		);
		expect(task).toEqual({
			path: resolve(parent, "garbro/12345678-1234-4234-8234-123456789abc"),
			expiresAt: new Date(61_000).toISOString(),
		});
		await expect(stat(task.path)).resolves.toMatchObject({});
	});

	it("removes expired task directories but leaves unrelated entries", async () => {
		const parent = await mkdtemp(resolve(tmpdir(), "garbro-temp-test-"));
		temporaryDirectories.push(parent);
		const root = resolve(parent, "garbro");
		const stale = resolve(root, "12345678-1234-4234-8234-123456789abc");
		const unrelated = resolve(root, "keep-me");
		await mkdir(stale, { recursive: true });
		await writeFile(resolve(stale, "artifact"), "data");
		await mkdir(unrelated);
		await utimes(stale, new Date(0), new Date(0));
		const manager = new TemporaryWorkspaceManager({
			tempDirectory: root,
			retentionMs: 1_000,
		});
		await manager.prepare(10_000);
		await expect(stat(stale)).rejects.toMatchObject({ code: "ENOENT" });
		await expect(stat(unrelated)).resolves.toMatchObject({});
	});

	it("rejects the filesystem root as a temporary directory", () => {
		expect(
			() =>
				new TemporaryWorkspaceManager({
					tempDirectory: parse(process.cwd()).root,
				}),
		).toThrow("filesystem root");
	});
});
