import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const VALUE_OPTIONS = new Set([
	"--archive",
	"--reference",
	"--expected-format",
	"--manifest",
]);

function parseArguments(argv) {
	const result = {};
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!VALUE_OPTIONS.has(key) || !value) {
			throw new Error(
				"Usage: pnpm test:differential -- --archive <file> --reference <garbro-output-dir> [--expected-format <id>] [--manifest <reference.json>]",
			);
		}
		result[key.slice(2).replaceAll("-", "_")] = value;
	}
	if (!result.archive || !result.reference) {
		throw new Error("Both --archive and --reference are required");
	}
	return result;
}

async function hashFile(path) {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest("hex");
}

async function fileManifest(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = resolve(directory, entry.name);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) {
				files.push({
					path: relative(root, path).replaceAll("\\", "/"),
					size: String((await stat(path)).size),
					sha256: await hashFile(path),
				});
			}
		}
	}
	await visit(root);
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

function run(command, args) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("exit", (code) => {
			if (code === 0) resolvePromise(stdout);
			else
				reject(
					new Error(
						`${command} exited with code ${code}${stderr ? `\n${stderr.trim()}` : ""}`,
					),
				);
		});
	});
}

function assertEqual(label, actual, expected) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`${label} mismatch\nExpected: ${JSON.stringify(expected, null, 2)}\nActual: ${JSON.stringify(actual, null, 2)}`,
		);
	}
}

function validateReferenceManifest(reference, detectedFormat, listedEntries) {
	if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
		throw new Error("Reference manifest must be a JSON object");
	}
	if (reference.format !== undefined && reference.format !== detectedFormat) {
		throw new Error(
			`Reference manifest expects format ${reference.format}, detected ${detectedFormat}`,
		);
	}
	if (!Array.isArray(reference.entries)) {
		throw new Error("Reference manifest must contain an entries array");
	}

	const actualByPath = new Map(
		listedEntries.map((entry) => [entry.path, entry]),
	);
	const expectedPaths = reference.entries
		.map((entry) => entry.path)
		.sort((left, right) => left.localeCompare(right));
	const actualPaths = [...actualByPath.keys()].sort((left, right) =>
		left.localeCompare(right),
	);
	assertEqual("Entry paths", actualPaths, expectedPaths);

	for (const expected of reference.entries) {
		const actual = actualByPath.get(expected.path);
		for (const field of [
			"size",
			"packedSize",
			"compressed",
			"encrypted",
			"checksum",
		]) {
			if (expected[field] !== undefined)
				assertEqual(
					`${expected.path} ${field}`,
					actual[field],
					expected[field],
				);
		}
	}
}

const options = parseArguments(process.argv.slice(2));
const archive = resolve(options.archive);
const referenceDirectory = resolve(options.reference);
const temporary = await mkdtemp(resolve(tmpdir(), "garbro-mcp-differential-"));
const cli = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../packages/cli/dist/index.js",
);

try {
	const detected = JSON.parse(
		await run(process.execPath, [cli, "detect", archive, "--json"]),
	);
	if (!detected.detected) throw new Error("The archive was not detected");
	if (
		options.expected_format &&
		detected.format.id !== options.expected_format
	) {
		throw new Error(
			`Expected format ${options.expected_format}, detected ${detected.format.id}`,
		);
	}

	const listing = JSON.parse(
		await run(process.execPath, [cli, "list", archive, "--json"]),
	);
	if (options.manifest) {
		const referenceManifest = JSON.parse(
			await readFile(resolve(options.manifest), "utf8"),
		);
		validateReferenceManifest(
			referenceManifest,
			detected.format.id,
			listing.entries,
		);
	}

	await run(process.execPath, [
		cli,
		"extract-archive",
		archive,
		"--output",
		temporary,
	]);
	const actualFiles = await fileManifest(temporary);
	const expectedFiles = await fileManifest(referenceDirectory);
	assertEqual("Extracted files", actualFiles, expectedFiles);

	const listedFiles = listing.entries
		.map((entry) => ({ path: entry.path, size: entry.size }))
		.sort((left, right) => left.path.localeCompare(right.path));
	const extractedFiles = actualFiles.map(({ path, size }) => ({ path, size }));
	assertEqual("Listed entries", listedFiles, extractedFiles);

	console.log(
		`Matched ${actualFiles.length} ${detected.format.id} entries by metadata, path, size, and SHA-256.`,
	);
} finally {
	await rm(temporary, { recursive: true, force: true });
}
