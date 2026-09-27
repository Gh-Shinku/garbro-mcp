#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const READ_STATUSES = new Set(["complete", "partial", "blocked"]);
const DISPOSITIONS = new Set([
	"planned",
	"external",
	"out-of-scope",
	"verification",
]);

export function validateSupportStatus(status, taxonomy) {
	const errors = [];
	if (status.schemaVersion !== 2)
		errors.push("support status schemaVersion must be 2");
	if (taxonomy.schemaVersion !== 1)
		errors.push("support gap taxonomy schemaVersion must be 1");
	const definitions = new Map();
	for (const definition of taxonomy.codes ?? []) {
		if (definitions.has(definition.code))
			errors.push(`duplicate support gap code: ${definition.code}`);
		definitions.set(definition.code, definition);
	}
	const ids = new Set();
	for (const record of status.implementations ?? []) {
		if (ids.has(record.localId))
			errors.push(`duplicate support localId: ${record.localId}`);
		ids.add(record.localId);
		if (record.readStatus === undefined && record.gaps !== undefined)
			errors.push(`${record.localId}: gaps require readStatus`);
		if (record.readStatus === undefined) continue;
		if (!READ_STATUSES.has(record.readStatus))
			errors.push(`${record.localId}: invalid readStatus ${record.readStatus}`);
		if (!Array.isArray(record.gaps)) {
			errors.push(`${record.localId}: readStatus requires a gaps array`);
			continue;
		}
		const seen = new Set();
		for (const gap of record.gaps) {
			const definition = definitions.get(gap.code);
			if (!definition)
				errors.push(`${record.localId}: unknown gap ${gap.code}`);
			if (!DISPOSITIONS.has(gap.disposition))
				errors.push(
					`${record.localId}: invalid disposition ${gap.disposition}`,
				);
			if (definition && definition.disposition !== gap.disposition)
				errors.push(
					`${record.localId}: ${gap.code} must use ${definition.disposition}`,
				);
			if (seen.has(gap.code))
				errors.push(`${record.localId}: duplicate gap ${gap.code}`);
			seen.add(gap.code);
		}
		const dispositions = new Set(record.gaps.map((gap) => gap.disposition));
		if (record.readStatus === "complete" && dispositions.has("planned"))
			errors.push(
				`${record.localId}: complete readers cannot have planned gaps`,
			);
		if (record.readStatus === "complete" && dispositions.has("external"))
			errors.push(
				`${record.localId}: complete readers cannot have external gaps`,
			);
		if (record.readStatus === "partial" && !dispositions.has("planned"))
			errors.push(`${record.localId}: partial readers require a planned gap`);
		if (record.readStatus === "blocked" && !dispositions.has("external"))
			errors.push(`${record.localId}: blocked readers require an external gap`);
	}
	if (errors.length > 0) throw new Error(errors.join("\n"));
}

export async function validateSupportStatusFiles(root = resolve(".")) {
	const [status, taxonomy] = await Promise.all([
		readFile(resolve(root, "docs/support-status.json"), "utf8").then(
			JSON.parse,
		),
		readFile(resolve(root, "docs/support-gap-codes.json"), "utf8").then(
			JSON.parse,
		),
	]);
	validateSupportStatus(status, taxonomy);
	return {
		records: status.implementations.length,
		migrated: status.implementations.filter(
			(record) => record.readStatus !== undefined,
		).length,
	};
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
	const result = await validateSupportStatusFiles();
	console.log(
		`validated ${result.records} support records (${result.migrated} with structured read status)`,
	);
}
