import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { planPublication, tagAtCommit } from "./publish-release.mjs";

const version = "0.1.0-beta.2";
const name = `garbro-mcp-${version}.tgz`;
const bytes = Buffer.from("tested tarball");
const files = new Map([
	[name, bytes],
	["checksums", Buffer.from("hashes")],
]);
const draft = { isDraft: true, assets: [] };
const asset = {
	name,
	digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
};
const published = {
	name: "garbro-mcp",
	version,
	dist: {
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
	},
};

test("selects only the workflow commit, including peeled annotated tags", () => {
	const tag = `v${version}`;
	const ref = `refs/tags/${tag}`;
	assert(tagAtCommit(`commit\t${ref}`, tag, "commit"));
	assert(tagAtCommit(`object\t${ref}\ncommit\t${ref}^{}`, tag, "commit"));
	assert(!tagAtCommit(`object\t${ref}\ncommit\t${ref}^{}`, tag, "object"));
	assert(!tagAtCommit("", tag, "commit"));
	assert(!tagAtCommit(`prior\t${ref}`, tag, "commit"));
});

test("publishes the tested archive and resumes partial uploads", () => {
	assert.deepEqual(planPublication(version, files, draft), {
		archive: name,
		missing: [name, "checksums"],
		publish: true,
	});
	assert.deepEqual(
		planPublication(version, files, { ...draft, assets: [asset] }, published),
		{
			archive: name,
			missing: ["checksums"],
			publish: false,
		},
	);
});

test("rejects conflicting npm or GitHub bytes and incomplete public releases", () => {
	assert.throws(
		() =>
			planPublication(version, files, draft, {
				...published,
				dist: { integrity: "other" },
			}),
		/npm tarball differs/,
	);
	assert.throws(
		() =>
			planPublication(version, files, {
				...draft,
				assets: [{ name, digest: "other" }],
			}),
		/GitHub asset differs/,
	);
	assert.throws(
		() =>
			planPublication(version, files, { ...draft, isDraft: false }, published),
		/incomplete/,
	);
});
