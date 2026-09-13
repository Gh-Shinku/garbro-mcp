// Appends a `export * from "./<module>.js";` line to a format directory index when it is missing.
// Directory indexes must never be rewritten wholesale: several directories already export other
// modules, and truncating one silently drops their registrations.
//
// Usage: node scripts/add-dir-export.mjs --dir <dir> --file <module-file>

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		if (!key?.startsWith("--")) throw new Error(`Unexpected argument ${key}`);
		options[key.slice(2)] = argv[index + 1];
	}
	return options;
}

const { dir, file } = parseArgs(process.argv.slice(2));
if (!dir || !file) {
	throw new Error(
		"Usage: node scripts/add-dir-export.mjs --dir <dir> --file <module-file>",
	);
}

const moduleName = file.replace(/\.ts$/, "");
const statement = `export * from "./${moduleName}.js";`;
const indexPath = join(repoRoot, "packages", "formats", "src", dir, "index.ts");

let content;
try {
	content = await readFile(indexPath, "utf8");
} catch {
	throw new Error(`Missing directory index ${indexPath}`);
}
if (content.includes(statement)) {
	console.log(`already exported: ${statement}`);
	process.exit(0);
}

const lines = content.split("\n").filter((line) => line.trim().length > 0);
lines.push(statement);
lines.sort((left, right) => left.localeCompare(right));
await writeFile(indexPath, `${lines.join("\n")}\n`, "utf8");
console.log(`added to ${dir}/index.ts: ${statement}`);
