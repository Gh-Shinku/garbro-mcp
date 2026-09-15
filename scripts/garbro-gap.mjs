// Gap report between GARbro's exported implementations and this project's tracked status.
// Usage: node scripts/garbro-gap.mjs [--type archive] [--limit 40] [--json] [--all]

import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = resolve(root, "docs/garbro-inventory.json");
const statusPath = resolve(root, "docs/support-status.json");
const garbroRoot = resolve(root, "GARbro");

function parseArguments(argv) {
	const options = { type: undefined, limit: 40, json: false, all: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--json") options.json = true;
		else if (argument === "--all") options.all = true;
		else if (argument === "--type") options.type = argv[++index];
		else if (argument === "--limit") options.limit = Number(argv[++index]);
		else throw new Error(`Unknown argument: ${argument}`);
	}
	return options;
}

function referenceKey(type, tag, source, className) {
	return `${type}\u0000${tag}\u0000${source}\u0000${className}`;
}

async function sourceLines(source) {
	try {
		const info = await stat(resolve(garbroRoot, source));
		return info.size;
	} catch {
		return undefined;
	}
}

const options = parseArguments(process.argv.slice(2));
const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
const status = JSON.parse(await readFile(statusPath, "utf8"));

const tracked = new Map();
for (const record of status.implementations) {
	const { type, tag, class: className, source } = record.reference;
	tracked.set(referenceKey(type, tag, source, className), record);
}

// The three Draft files are the reference's own templates for new formats rather than formats: their namespace
// and their class name carry question marks, the tag the inventory reads out of them is `xxx`, and none of them
// is reachable. They are left out of the report rather than counted as work that is not done.
const TEMPLATE_SOURCES = new Set([
	"ArcFormats/DraftArc.cs",
	"ArcFormats/DraftAudio.cs",
	"ArcFormats/DraftImage.cs",
]);

const rows = inventory.formats
	.filter((format) => !TEMPLATE_SOURCES.has(format.source))
	.map((format) => {
		const record = tracked.get(
			referenceKey(format.type, format.tag, format.source, format.class),
		);
		return { ...format, localId: record?.localId, status: record?.status };
	});

const filtered = options.type
	? rows.filter((row) => row.type === options.type)
	: rows;

const counts = new Map();
for (const row of filtered) {
	const state = row.status ?? "not-started";
	counts.set(state, (counts.get(state) ?? 0) + 1);
}

const pending = filtered.filter((row) => !row.status);
for (const row of pending) row.sourceBytes = await sourceLines(row.source);
pending.sort((left, right) => {
	const leftSize = left.sourceBytes ?? Number.MAX_SAFE_INTEGER;
	const rightSize = right.sourceBytes ?? Number.MAX_SAFE_INTEGER;
	return leftSize - rightSize || left.tag.localeCompare(right.tag);
});

if (options.json) {
	console.log(
		JSON.stringify(
			{
				counts: Object.fromEntries(
					[...counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
				),
				pending: (options.all ? pending : pending.slice(0, options.limit)).map(
					({
						type,
						tag,
						class: className,
						source,
						extensions,
						sourceBytes,
					}) => ({
						type,
						tag,
						class: className,
						source,
						extensions,
						sourceBytes,
					}),
				),
			},
			null,
			2,
		),
	);
} else {
	const total = filtered.length;
	console.log(`GARbro baseline: ${status.baselineCommit}`);
	console.log(
		`${options.type ?? "all"} implementations: ${total} total, ${
			counts.get("verified") ?? 0
		} verified, ${counts.get("partial") ?? 0} partial, ${
			counts.get("in-progress") ?? 0
		} in-progress, ${counts.get("not-started") ?? 0} not-started`,
	);
	console.log("");
	const shown = options.all ? pending : pending.slice(0, options.limit);
	for (const row of shown) {
		const size = row.sourceBytes
			? `${String(row.sourceBytes).padStart(6)}B`
			: "      ?";
		const extensions = row.extensions?.length
			? ` [${row.extensions.join(",")}]`
			: "";
		console.log(
			`${size}  ${row.type.padEnd(7)} ${row.tag.padEnd(24)} ${row.source}${extensions}`,
		);
	}
	if (!options.all && shown.length < pending.length) {
		console.log(`... ${pending.length - shown.length} more (use --all)`);
	}
}
