import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";

const git = (...args) =>
	execFileSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const paths = (...args) =>
	git(...args, "-z")
		.split("\0")
		.filter(Boolean);
const base = process.argv[2];
const files = paths("ls-files");
const changed = base
	? git("diff", "--name-only", "--no-renames", "-z", base, "HEAD")
			.split("\0")
			.filter(Boolean)
	: [];
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const version = read("distribution/package.json").version;
const platformSuites = [
	"tests/integration/cli.test.ts",
	"tests/integration/mcp.test.ts",
	"tests/integration/differential.test.ts",
	...[
		"workspace",
		"temporary-workspace",
		"automation",
		"extract",
		"verification",
	].map((n) => `tests/unit/${n}.test.ts`),
];
let full = !base;
let packaging = false;
let catalog = false;
let nodeTests = false;
let versions = false;
const source = [];
const tests = new Set();
const cross = new Set();
const lint = changed.filter(
	(p) =>
		files.includes(p) &&
		/\.(ts|mjs|json|jsonc)$/.test(p) &&
		p !== "docs/garbro-inventory.json",
);
for (const path of changed) {
	if (["package.json", "distribution/package.json"].includes(path)) {
		versions = true;
		const current = read(path);
		const previous = JSON.parse(git("show", `${base}:${path}`));
		delete current.version;
		delete previous.version;
		try {
			assert.deepEqual(current, previous);
			continue;
		} catch {
			/* substantive manifest change */
		}
	}
	if (path === ".release-please-manifest.json") {
		versions = true;
		continue;
	}
	if (
		path.startsWith("distribution/") ||
		["LICENSE", "THIRD_PARTY_NOTICES.md"].includes(path) ||
		/^scripts\/(build-release|test-release|release-common)\.mjs$/.test(path)
	) {
		packaging = true;
		continue;
	}
	if (/\.md$/i.test(path)) continue;
	if (/^scripts\/ci\/|^\.github\/workflows\/check\.yml$/.test(path)) {
		nodeTests = true;
		continue;
	}
	if (
		path.startsWith(".github/workflows/") ||
		/^(scripts\/publish-release.*|release-please-config\.json)$/.test(path)
	) {
		nodeTests = true;
		packaging = true;
		continue;
	}
	if (
		/^(docs\/(support-status|garbro-inventory|support-gap-codes)\.json|packages\/formats\/src\/support\.generated\.ts|scripts\/(generate-format-support|validate-support-status)\.mjs)$/.test(
			path,
		)
	) {
		catalog = true;
		tests.add("tests/unit/catalog.test.ts");
		tests.add("tests/unit/support-status.test.ts");
		continue;
	}
	if (path === "scripts/differential-archive.mjs") {
		tests.add("tests/integration/differential.test.ts");
		cross.add("tests/integration/differential.test.ts");
		continue;
	}
	if (path.startsWith("fixtures/")) {
		const prefix = posix.dirname(path);
		const consumers = files.filter(
			(p) => p.endsWith(".test.ts") && readFileSync(p, "utf8").includes(prefix),
		);
		if (consumers.length) {
			for (const p of consumers) tests.add(p);
			continue;
		}
	}
	if (
		path.startsWith("tests/") &&
		path.endsWith(".test.ts") &&
		!files.includes(path)
	)
		continue;
	if (/^(packages|tests)\/.*\.ts$/.test(path) && files.includes(path))
		source.push(path);
	else full = true;
}
if (versions || full) {
	assert.match(version, /^0\.1\.(0|[1-9]\d*)$/);
	assert.equal(read("package.json").version, version);
	assert.equal(read(".release-please-manifest.json")["."], version);
}
if (!full && source.length) {
	try {
		const { affectedTests } = await import("./dependencies.mjs");
		const previousFiles = new Set(
			git("ls-tree", "-r", "--name-only", "-z", base).split("\0"),
		);
		const result = affectedTests(files, source, (p) =>
			previousFiles.has(p) ? git("show", `${base}:${p}`) : undefined,
		);
		for (const [input, impact] of result) {
			if (!impact.tests.length) full = true;
			for (const p of impact.tests) {
				tests.add(p);
				if (
					impact.platformSensitive &&
					(platformSuites.includes(p) ||
						input === p ||
						(input.startsWith("packages/formats/") &&
							p.startsWith("tests/formats/")))
				)
					cross.add(p);
			}
		}
	} catch (error) {
		console.warn("Falling back to broad checks:", error.message);
		full = true;
	}
}
if (full) {
	for (const p of platformSuites) cross.add(p);
}
const plan = {
	linux: full ? ["*"] : [...tests].sort(),
	desktop: [...cross].sort(),
	typecheck: full || source.length > 0 || tests.size > 0,
	lint: full ? ["."] : lint,
	catalog: full || catalog,
	nodeTests: full || nodeTests,
	packaging: process.env.CI_DEFER_PACKAGES !== "true" && (full || packaging),
	version,
};
const include = [];
if (
	plan.linux.length ||
	plan.typecheck ||
	plan.lint.length ||
	plan.catalog ||
	plan.nodeTests
)
	include.push({ os: "ubuntu-latest", suite: "linux" });
if (cross.size)
	for (const os of ["windows-latest", "macos-latest"])
		include.push({ os, suite: "desktop" });
console.log(JSON.stringify(plan, null, 2));
if (process.env.GITHUB_OUTPUT)
	writeFileSync("ci-plan.json", JSON.stringify(plan));
if (process.env.GITHUB_OUTPUT)
	appendFileSync(
		process.env.GITHUB_OUTPUT,
		`matrix=${JSON.stringify({ include })}\nwork=${!!include.length}\npackaging=${plan.packaging}\nversion=${version}\n`,
	);
