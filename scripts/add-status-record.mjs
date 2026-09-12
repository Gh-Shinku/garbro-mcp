#!/usr/bin/env node
// Inserts one record into docs/support-status.json. Additive and idempotent.
//
// Usage:
//   node scripts/add-status-record.mjs --id alicesoft-alk --tag ALK --class AlkOpener \
//     --source ArcFormats/AliceSoft/ArcALK.cs --supported "a,b,c" [--unsupported "d,e"] \
//     [--verification synthetic-fixtures] [--remaining "real-game GARbro differential output"]
import { readFile, writeFile } from "node:fs/promises";

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
	options[process.argv[index].replace(/^--/, "")] = process.argv[index + 1];
}
for (const required of ["id", "tag", "class", "source", "supported"]) {
	if (!options[required]) {
		console.error(
			"Usage: node scripts/add-status-record.mjs --id <localId> --tag <GARbro tag> --class <class> --source <path> --supported 'a,b'",
		);
		process.exit(2);
	}
}

const split = (value, fallback) =>
	(value ?? fallback)
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

const list = (items, indent) =>
	items.map(
		(item, index) => `${indent}"${item}"${index + 1 < items.length ? "," : ""}`,
	);

const supported = split(options.supported, "");
const unsupported = split(options.unsupported, "archive creation");
const remaining = split(
	options.remaining,
	"real-game GARbro differential output",
);

const lines = [
	"\t\t{",
	'\t\t\t"reference": {',
	'\t\t\t\t"type": "archive",',
	`\t\t\t\t"tag": "${options.tag}",`,
	`\t\t\t\t"class": "${options.class}",`,
	`\t\t\t\t"source": "${options.source}"`,
	"\t\t\t},",
	`\t\t\t"localId": "${options.id}",`,
	'\t\t\t"status": "partial",',
	`\t\t\t"verification": "${options.verification ?? "synthetic-fixtures"}",`,
	'\t\t\t"supported": [',
	...list(supported, "\t\t\t\t"),
	"\t\t\t],",
	'\t\t\t"unsupported": [',
	...list(unsupported, "\t\t\t\t"),
	"\t\t\t],",
	`\t\t\t"remainingVerification": [${remaining.map((item) => `"${item}"`).join(", ")}]`,
	"\t\t},",
	"",
];

const path = "docs/support-status.json";
const text = await readFile(path, "utf8");
if (text.includes(`"localId": "${options.id}"`)) {
	console.log(`${options.id} already recorded`);
	process.exit(0);
}
const marker = '\t"implementations": [\n';
const position = text.indexOf(marker) + marker.length;
const updated =
	text.slice(0, position) + lines.join("\n") + text.slice(position);
JSON.parse(updated);
await writeFile(path, updated, "utf8");
console.log(`recorded ${options.id}`);
