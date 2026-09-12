import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";

function parseArguments(argv) {
	const result = {};
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if ((key !== "--archive" && key !== "--reference") || !value) {
			throw new Error(
				"Usage: pnpm test:differential -- --archive <sample.xp3> --reference <garbro-output-dir>",
			);
		}
		result[key.slice(2)] = value;
	}
	if (!result.archive || !result.reference) {
		throw new Error("Both --archive and --reference are required");
	}
	return result;
}

async function fileManifest(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) {
				const contents = await readFile(path);
				files.push({
					path: relative(root, path).replaceAll("\\", "/"),
					size: String((await stat(path)).size),
					sha256: createHash("sha256").update(contents).digest("hex"),
				});
			}
		}
	}
	await visit(root);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function run(command, args) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolvePromise();
			else reject(new Error(`${command} exited with code ${code}`));
		});
	});
}

const options = parseArguments(process.argv.slice(2));
const temporary = await mkdtemp(resolve(tmpdir(), "garbro-mcp-differential-"));
try {
	const cli = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../packages/cli/dist/index.js",
	);
	await run(process.execPath, [
		cli,
		"extract-archive",
		resolve(options.archive),
		"--output",
		temporary,
	]);
	const actual = await fileManifest(temporary);
	const expected = await fileManifest(resolve(options.reference));
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		console.error("Expected (GARbro):", expected);
		console.error("Actual:", actual);
		process.exitCode = 1;
	} else {
		console.log(`Matched ${actual.length} files by path, size, and SHA-256.`);
	}
} finally {
	await rm(temporary, { recursive: true, force: true });
}
