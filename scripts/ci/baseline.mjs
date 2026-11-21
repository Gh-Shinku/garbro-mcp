import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

const env = process.env;
const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
const exec = (command, args) =>
	execFileSync(command, args, { encoding: "utf8" }).trim();
const git = (...args) => exec("git", args);
const api = (path) =>
	JSON.parse(exec("gh", ["api", `repos/${env.GITHUB_REPOSITORY}/${path}`]));
const head = git("rev-parse", "HEAD");
const tree = git("rev-parse", "HEAD^{tree}");
const sha = /^[0-9a-f]{40}$/;

function previousCheck() {
	let pr = event.pull_request;
	if (!pr) {
		const prs = api(`commits/${head}/pulls`);
		pr =
			prs.find(
				(p) =>
					p.merged_at && p.merge_commit_sha === head && p.base.ref === "main",
			) ?? prs.find((p) => !p.merged_at && p.head.sha === head);
	}
	if (!pr) return;
	const branch = encodeURIComponent(pr.head.ref);
	const { workflow_runs } = api(
		`actions/workflows/check.yml/runs?event=pull_request&status=success&branch=${branch}&per_page=30`,
	);
	for (const run of workflow_runs) {
		if (
			run.id === Number(env.GITHUB_RUN_ID) ||
			run.head_repository?.id !== pr.head.repo?.id ||
			!run.pull_requests.some(
				(p) =>
					p.number === pr.number &&
					p.base.repo.id === pr.base.repo.id &&
					p.base.ref === pr.base.ref,
			)
		)
			continue;
		const { jobs } = api(`actions/runs/${run.id}/jobs?per_page=100`);
		const name = jobs.find(
			(j) => j.conclusion === "success" && /^Plan [0-9a-f]{40}$/.test(j.name),
		)?.name;
		if (
			!name ||
			!jobs.some((j) => j.name === "Verified" && j.conclusion === "success")
		)
			continue;
		const commit = name.slice(5);
		try {
			git("cat-file", "-e", commit);
		} catch {
			git("fetch", "--no-tags", "origin", commit);
		}
		if (tree === git("rev-parse", `${commit}^{tree}`))
			return { base: head, reason: `identical tree verified in run ${run.id}` };
		if (event.pull_request)
			return {
				base: commit,
				reason: `changes since successful PR run ${run.id}`,
			};
	}
}

let base;
let reason;
if (env.CI_FULL !== "true") {
	try {
		({ base, reason } = previousCheck() ?? {});
	} catch (error) {
		console.warn("Could not reuse check history:", error.message);
	}
	if (!base) {
		if (event.pull_request) base = git("rev-parse", "HEAD^1");
		else if (
			event.before &&
			sha.test(event.before) &&
			!/^0+$/.test(event.before)
		)
			base = event.before;
		else if (env.GITHUB_REF !== "refs/heads/main")
			base = git("merge-base", "origin/main", head);
		reason = "changes against base";
	}
}
if (base) {
	try {
		git("cat-file", "-e", `${base}^{tree}`);
	} catch {
		base = undefined;
	}
}
const paths = base
	? git("diff", "--name-only", "--no-renames", "-z", base, head).split("\0")
	: [];
const graph = paths.some((p) => /^(packages|tests)\/.*\.ts$/.test(p));
appendFileSync(env.GITHUB_OUTPUT, `base=${base ?? ""}\ngraph=${graph}\n`);
console.log(base ? `${reason}: ${base} → ${head}` : "Full verification");
