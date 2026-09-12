import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const archive = resolve("data/favorite/se_sys.bin");
const reference = resolve("data/favorite/se_sys");
const localFixtureAvailable = existsSync(archive) && existsSync(reference);

describe("Favorite BIN local differential fixture", () => {
	it.skipIf(!localFixtureAvailable)(
		"matches the local GARbro extraction",
		async () => {
			const { stdout } = await run(process.execPath, [
				resolve("scripts/differential-archive.mjs"),
				"--archive",
				archive,
				"--reference",
				reference,
				"--expected-format",
				"favorite-bin",
			]);
			expect(stdout).toContain("Matched 13 favorite-bin entries");
		},
	);
});
