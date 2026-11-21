import { sync } from "cross-spawn";
import { execFileSync } from "node:child_process";

import { readFileSync } from "node:fs";

const plan = JSON.parse(readFileSync(process.env.CI_PLAN_FILE, "utf8"));
const suite = process.env.CI_SUITE;
const run = (...args) =>
	execFileSync(process.execPath, args, { stdio: "inherit" });
const pnpm = (...args) => {
	const result = sync("pnpm", args, { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
};
// Run through Node directly so a long selection also works with Windows command shims.
function batches(files, command) {
	for (let i = 0; i < files.length; i += 60) command(files.slice(i, i + 60));
}
if (suite === "linux") {
	batches(plan.lint, (files) => {
		for (const check of ["format", "lint"])
			pnpm("exec", "biome", check, "--no-errors-on-unmatched", "--", ...files);
	});
	if (plan.nodeTests)
		run(
			"--test",
			"scripts/publish-release.test.mjs",
			"scripts/ci/plan.test.mjs",
		);
	if (plan.catalog) pnpm("support:check");
	if (plan.typecheck) pnpm("typecheck");
} else if (plan[suite].length) pnpm("build");
const tests = plan[suite];
if (tests[0] === "*") pnpm("exec", "vitest", "run");
else
	batches(tests, (files) =>
		run("node_modules/vitest/vitest.mjs", "run", ...files),
	);
