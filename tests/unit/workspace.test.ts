import { GarbroError, WorkspacePolicy } from "@garbro-mcp/core";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-workspace-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("WorkspacePolicy", () => {
	it("resolves logical paths inside named roots", async () => {
		const directory = await temporaryDirectory();
		await mkdir(resolve(directory, "assets"));
		await writeFile(resolve(directory, "assets/game.xp3"), "fixture");
		const workspace = new WorkspacePolicy({
			inputRoots: { games: directory },
			outputRoot: resolve(directory, "results"),
		});
		await workspace.prepare();

		await expect(
			workspace.resolveInput(
				{ rootId: "games", path: "assets\\game.xp3" },
				"file",
			),
		).resolves.toMatchObject({
			absolutePath: resolve(directory, "assets/game.xp3"),
			relativePath: "assets/game.xp3",
		});
	});

	it.each(["../outside", "/absolute", "C:\\drive", "folder/../outside"])(
		"rejects unsafe input path %s",
		async (path) => {
			const directory = await temporaryDirectory();
			const workspace = new WorkspacePolicy({
				inputRoots: { games: directory },
			});
			await expect(
				workspace.resolveInput({ rootId: "games", path }),
			).rejects.toBeInstanceOf(GarbroError);
		},
	);

	it("rejects input symlinks that escape a configured root", async () => {
		const directory = await temporaryDirectory();
		const outside = await temporaryDirectory();
		await writeFile(resolve(outside, "secret.bin"), "secret");
		await symlink(outside, resolve(directory, "escape"));
		const workspace = new WorkspacePolicy({ inputRoots: { games: directory } });

		await expect(
			workspace.resolveInput(
				{ rootId: "games", path: "escape/secret.bin" },
				"file",
			),
		).rejects.toMatchObject({ code: "UNSAFE_PATH" });
	});

	it("rejects symlink components below the output root", async () => {
		const directory = await temporaryDirectory();
		const outside = await temporaryDirectory();
		const outputRoot = resolve(directory, "output");
		await mkdir(outputRoot);
		await symlink(outside, resolve(outputRoot, "escape"));
		const workspace = new WorkspacePolicy({
			inputRoots: { games: directory },
			outputRoot,
		});

		await expect(
			workspace.resolveOutputDirectory("escape/result"),
		).rejects.toMatchObject({
			code: "UNSAFE_PATH",
		});
	});
});
