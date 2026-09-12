import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const cliPath = resolve("packages/cli/dist/index.js");
const fixture = resolve("fixtures/xp3/basic.xp3");
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("CLI", () => {
	it("lists formats as JSON", async () => {
		const { stdout } = await run(process.execPath, [
			cliPath,
			"formats",
			"--json",
		]);
		expect(JSON.parse(stdout)).toMatchObject({
			formats: [
				{ id: "xp3" },
				{ id: "adpack32" },
				{ id: "afs" },
				{ id: "cpk" },
				{ id: "ami" },
				{ id: "bgi-arc" },
				{ id: "buriko-arc" },
				{ id: "drs" },
				{ id: "ikura-gdl" },
				{ id: "escude-bin" },
				{ id: "gsp" },
				{ id: "cat-system-int" },
				{ id: "packdat" },
				{ id: "kcap" },
				{ id: "hypack" },
				{ id: "nexton-lst" },
				{ id: "majiro-arc" },
				{ id: "nekopack-2" },
				{ id: "nekopack-1" },
				{ id: "favorite-acpx" },
				{ id: "favorite-bin" },
			],
		});
	});

	it("detects an XP3 archive", async () => {
		const { stdout } = await run(process.execPath, [
			cliPath,
			"detect",
			fixture,
			"--json",
		]);
		expect(JSON.parse(stdout)).toMatchObject({
			detected: true,
			format: { id: "xp3" },
		});
	});

	it("lists and extracts one entry", async () => {
		const outputDirectory = await mkdtemp(
			resolve(tmpdir(), "garbro-cli-entry-"),
		);
		temporaryDirectories.push(outputDirectory);
		const listed = await run(process.execPath, [
			cliPath,
			"list",
			fixture,
			"--json",
		]);
		const listedOutput = JSON.parse(listed.stdout);
		expect(listedOutput.entries[0]).toMatchObject({
			id: "0",
			path: "hello.txt",
		});

		const extracted = await run(process.execPath, [
			cliPath,
			"extract-entry",
			fixture,
			"0",
			"--output",
			outputDirectory,
			"--json",
		]);
		expect(JSON.parse(extracted.stdout)).toMatchObject({ bytesWritten: "10" });
		expect(await readFile(resolve(outputDirectory, "hello.txt"), "utf8")).toBe(
			"hello xp3\n",
		);
	});

	it("extracts a complete archive", async () => {
		const outputDirectory = await mkdtemp(
			resolve(tmpdir(), "garbro-cli-archive-"),
		);
		temporaryDirectories.push(outputDirectory);
		const { stdout } = await run(process.execPath, [
			cliPath,
			"extract-archive",
			fixture,
			"--output",
			outputDirectory,
			"--json",
		]);
		expect(JSON.parse(stdout)).toMatchObject({
			extractedEntries: 3,
			bytesWritten: "42",
		});
	});
});
