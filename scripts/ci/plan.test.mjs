import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const planner = fileURLToPath(new URL("./plan.mjs", import.meta.url));
test("selects independent formats, shared readers, platform regressions and release metadata", (t) => {
	const cwd = mkdtempSync(join(tmpdir(), "garbro-ci-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const git = (...args) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	git("init", "--quiet");
	git("config", "user.name", "CI test");
	git("config", "user.email", "ci@example.invalid");
	function write(path, content) {
		mkdirSync(join(cwd, dirname(path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}
	function commit() {
		git("add", ".");
		git("commit", "-qm", "fixture");
		return git("rev-parse", "HEAD");
	}
	function plan(base) {
		return JSON.parse(
			execFileSync(process.execPath, [planner, base], {
				cwd,
				encoding: "utf8",
				env: { ...process.env, GITHUB_OUTPUT: "", CI_DEFER_PACKAGES: "false" },
			}),
		);
	}
	function manifests(v) {
		for (const p of ["package.json", "distribution/package.json"])
			write(p, JSON.stringify({ version: v }));
		write(".release-please-manifest.json", JSON.stringify({ ".": v }));
	}
	manifests("0.1.0");
	const dir = "packages/formats/src";
	write(`${dir}/shared.ts`, "export const value=1");
	for (const id of ["one", "two"]) {
		write(
			`${dir}/${id}.ts`,
			`import {value} from "./shared.js"; export const ${id}=value;`,
		);
		write(
			`tests/formats/${id}.test.ts`,
			`import {${id}} from "@garbro-mcp/formats"; void ${id};`,
		);
	}
	write(
		`${dir}/index.ts`,
		'export * from "./one.js"; export * from "./two.js";',
	);
	write(
		"packages/core/src/workspace.ts",
		'import {mkdir} from "node:fs/promises"; export const workspace=mkdir;',
	);
	write(
		"tests/integration/mcp.test.ts",
		'import {workspace} from "../../packages/core/src/workspace.js"; void workspace;',
	);
	const start = commit();
	write(
		`${dir}/one.ts`,
		'import {value} from "./shared.js"; export const one=value+1;',
	);
	const format = commit();
	assert.deepEqual(plan(start).linux, ["tests/formats/one.test.ts"]);
	assert.deepEqual(plan(start).desktop, []);
	write(`${dir}/shared.ts`, "export const value=2");
	const shared = commit();
	assert.deepEqual(plan(format).linux, [
		"tests/formats/one.test.ts",
		"tests/formats/two.test.ts",
	]);
	write(
		"packages/core/src/workspace.ts",
		'import {mkdir} from "node:fs/promises"; export const workspace=()=>mkdir("dir");',
	);
	const core = commit();
	assert.deepEqual(plan(shared).desktop, ["tests/integration/mcp.test.ts"]);
	manifests("0.1.10000000000");
	const release = commit();
	assert.deepEqual(plan(core).linux, []);
	assert.equal(plan(core).packaging, false);
	assert.deepEqual(plan(release).lint, []);
	write("distribution/README.md", "installed package");
	const packaging = commit();
	assert.equal(plan(release).packaging, true);
	assert.deepEqual(plan(release).linux, []);
	write("vitest.config.ts", "export default {}");
	commit();
	assert.deepEqual(plan(packaging).linux, ["*"]);
});
