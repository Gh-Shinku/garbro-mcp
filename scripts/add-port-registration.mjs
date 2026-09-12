#!/usr/bin/env node
// Registers one archive port in packages/formats/src/index.ts.
// Additive and idempotent: existing registrations are never removed.
//
// Usage:
//   node scripts/add-port-registration.mjs \
//     --key alicesoft-alk --symbol alkFormat --module ./alicesoft/alk.js --dir alicesoft
import { readFile, writeFile } from "node:fs/promises";

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
	options[process.argv[index].replace(/^--/, "")] = process.argv[index + 1];
}
for (const required of ["key", "symbol", "module", "dir"]) {
	if (!options[required]) {
		console.error(
			"Usage: node scripts/add-port-registration.mjs --key <id> --symbol <export> --module <specifier> --dir <directory>",
		);
		process.exit(2);
	}
}

const index = "packages/formats/src/index.ts";
const importLine = `import { ${options.symbol} } from "${options.module}";`;
const exportLine = `export * from "./${options.dir}/index.js";`;
const registerLine = `${options.symbol},`;
const registerIndented = `\t\t${registerLine}`;

const lines = (await readFile(index, "utf8")).split("\n");
if (!lines.includes(importLine)) {
	const lastImport = lines.findLastIndex((line) => line.startsWith("import "));
	lines.splice(lastImport + 1, 0, importLine);
}
if (!lines.includes(exportLine)) {
	const lastExport = lines.findLastIndex((line) => line.startsWith("export *"));
	lines.splice(lastExport + 1, 0, exportLine);
}
if (!lines.includes(registerIndented)) {
	const close = lines.findIndex((line) => line.trimEnd() === "\t]);");
	lines.splice(close, 0, registerIndented);
}
await writeFile(index, lines.join("\n"), "utf8");
console.log(`registered ${options.key}`);
