import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("archive differential harness", () => {
	it("compares an archive with a GARbro reference directory", async () => {
		const reference = await mkdtemp(
			resolve(tmpdir(), "garbro-reference-test-"),
		);
		temporaryDirectories.push(reference);
		await mkdir(resolve(reference, "scripts"));
		await mkdir(resolve(reference, "画像"));
		await writeFile(resolve(reference, "hello.txt"), "hello xp3\n");
		await writeFile(
			resolve(reference, "scripts/startup.tjs"),
			"System.title = 'fixture';\n",
		);
		await writeFile(
			resolve(reference, "画像/サンプル.bin"),
			Buffer.from([0, 1, 2, 3, 0xfe, 0xff]),
		);

		const { stdout } = await run(process.execPath, [
			resolve("scripts/differential-archive.mjs"),
			"--archive",
			resolve("fixtures/xp3/basic.xp3"),
			"--reference",
			reference,
			"--expected-format",
			"xp3",
		]);
		expect(stdout).toContain("Matched 3 xp3 entries");
	});
});
