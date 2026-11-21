import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const run = (command, args) =>
	execFileSync(command, args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	}).trim();

export function tagAtCommit(refs, tag, sha) {
	const rows = new Map(
		refs.split("\n").map((row) => row.split("\t").reverse()),
	);
	const ref = `refs/tags/${tag}`;
	return (rows.get(`${ref}^{}`) ?? rows.get(ref)) === sha;
}

export function planPublication(version, files, release, published) {
	const archive = `garbro-mcp-${version}.tgz`;
	if (published) {
		assert.equal(published.name, "garbro-mcp");
		assert.equal(published.version, version);
		const digest = createHash("sha512")
			.update(files.get(archive))
			.digest("base64");
		assert.equal(
			published.dist.integrity,
			`sha512-${digest}`,
			"npm tarball differs",
		);
	}
	const missing = [];
	for (const [name, bytes] of files) {
		const asset = release.assets.find((item) => item.name === name);
		if (asset) {
			const digest = createHash("sha256").update(bytes).digest("hex");
			assert.equal(
				asset.digest,
				`sha256:${digest}`,
				`GitHub asset differs: ${name}`,
			);
		} else {
			missing.push(name);
		}
	}
	if (!release.isDraft) {
		assert(published && missing.length === 0, "Public release is incomplete");
	}
	return { archive, missing, publish: !published };
}

async function main(mode) {
	assert(["plan", "publish"].includes(mode));
	assert.equal(process.env.GITHUB_REF, "refs/heads/main");
	const sha = process.env.GITHUB_SHA;
	assert.equal(run("git", ["rev-parse", "HEAD"]), sha);
	const version = (await json(".release-please-manifest.json"))["."];
	// Release Please uses 0.0.0 until the first version PR lands.
	if (mode === "plan" && version === "0.0.0") return;
	assert.match(version, /^0\.1\.(0|[1-9]\d*)$/);
	const tag = `v${version}`;
	const ref = `refs/tags/${tag}`;
	const refs = run("git", ["ls-remote", "--tags", "origin", ref, `${ref}^{}`]);
	if (!tagAtCommit(refs, tag, sha)) {
		assert.equal(mode, "plan", `Tag ${tag} does not point at ${sha}`);
		return;
	}

	const release = JSON.parse(
		run("gh", ["release", "view", tag, "--json", "tagName,isDraft,assets"]),
	);
	assert.equal(release.tagName, tag);
	if (mode === "plan" && !release.isDraft) return;
	assert.equal((await json("distribution/package.json")).version, version);
	if (mode === "plan") {
		await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
		return;
	}

	process.chdir("dist/release");
	const prefix = `garbro-mcp-${version}`;
	const build = await json(`${prefix}-build.json`);
	assert.equal(build.commit, sha);
	assert.equal(build.version, version);
	assert.equal(build.dirty, false);
	const names = [
		`${prefix}.tgz`,
		`${prefix}-portable.zip`,
		`${prefix}-build.json`,
		`${prefix}-SHA256SUMS`,
	];
	const files = new Map(
		await Promise.all(names.map(async (name) => [name, await readFile(name)])),
	);
	const registry = "https://registry.npmjs.org";
	const response = await fetch(`${registry}/garbro-mcp/${version}`);
	assert(
		response.ok || response.status === 404,
		`npm lookup failed: ${response.status}`,
	);
	const published = response.ok ? await response.json() : undefined;
	const plan = planPublication(version, files, release, published);
	if (plan.missing.length)
		run("gh", ["release", "upload", tag, ...plan.missing]);
	if (plan.publish) {
		run("npm", [
			"publish",
			plan.archive,
			"--registry",
			registry,
			"--access",
			"public",
			"--tag",
			"latest",
			"--provenance",
			"--ignore-scripts",
		]);
	}
	if (release.isDraft) run("gh", ["release", "edit", tag, "--draft=false"]);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	await main(process.argv[2]);
