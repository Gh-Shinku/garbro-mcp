import { sync } from "cross-spawn";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
);
export const releaseDirectory = resolve(repositoryRoot, "dist/release");

export function run(command, args, options = {}) {
	const result = sync(command, args, { encoding: "utf8", ...options });
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`${command} failed (${result.status}):\n${result.stderr}\n${result.stdout}`,
		);
	return result.stdout;
}

export function validateVersion(version, prerelease = false) {
	const semver =
		/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;
	if (!semver.test(version) || (prerelease && !version.includes("-")))
		throw new Error(
			`Expected ${prerelease ? "a prerelease " : "a "}semver version, got: ${version}`,
		);
	return version;
}
