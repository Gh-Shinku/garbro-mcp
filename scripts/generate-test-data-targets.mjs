import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(
	root,
	process.argv[2] ?? "GARbro/docs/supported.html",
);
const outputPath = resolve(root, "docs/test-data-targets.md");
const baselineCommit = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
const expectedRowCount = 472;
const fallbackRepresentatives = new Map([
	[
		"RPG Maker",
		"Knight Blade -Howling of Kerberos- (official sample; not GARbro-tested)",
	],
]);

function decodeEntities(value) {
	return value
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&apos;", "'")
		.replaceAll("&nbsp;", " ")
		.replace(/&#(\d+);/g, (_match, codePoint) =>
			String.fromCodePoint(Number(codePoint)),
		)
		.replace(/&#x([0-9a-f]+);/gi, (_match, codePoint) =>
			String.fromCodePoint(Number.parseInt(codePoint, 16)),
		);
}

function cellLines(value) {
	return decodeEntities(
		value
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p\s*>/gi, "\n")
			.replace(/<[^>]+>/g, ""),
	)
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function parseCell(match) {
	const rowSpan = match[2].match(/rowspan\s*=\s*["']?(\d+)/i);
	return {
		lines: cellLines(match[3]),
		rowSpan: rowSpan ? Number(rowSpan[1]) : 1,
	};
}

function parseRows(html) {
	const repairedHtml = html
		.replace(/<\/tt>\s*<\/br>\s*<td/gi, "</tt></td><td")
		.replace(/<\/td><\/td>\s*(?=<tr)/gi, "</td></tr>\n")
		.replace(/(<br\s*\/?>)\s*(?=<tr)/gi, "$1\n</td></tr>\n");
	const pending = Array.from({ length: 5 }, () => undefined);
	const rows = [];
	for (const rowMatch of repairedHtml.matchAll(
		/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi,
	)) {
		const rawCells = [
			...rowMatch[1].matchAll(/<t([dh])([^>]*)>([\s\S]*?)<\/t\1>/gi),
		];
		if (rawCells.length === 0 || rawCells[0][1].toLowerCase() === "h") continue;
		const cells = rawCells.map(parseCell);
		const columns = [];
		let cellIndex = 0;
		for (let column = 0; column < 5; column += 1) {
			const carried = pending[column];
			if (carried) {
				columns.push(carried.lines);
				carried.remaining -= 1;
				if (carried.remaining === 0) pending[column] = undefined;
				continue;
			}
			const cell = cells[cellIndex++];
			if (!cell) {
				columns.push([]);
				continue;
			}
			columns.push(cell.lines);
			if (cell.rowSpan > 1) {
				pending[column] = {
					lines: cell.lines,
					remaining: cell.rowSpan - 1,
				};
			}
		}
		if (cellIndex !== cells.length) {
			throw new Error(
				`Supported-format row has ${cells.length - cellIndex} unexpected cells`,
			);
		}
		rows.push({
			files: columns[0],
			signatures: columns[1],
			brand: columns[3],
			titles: columns[4],
		});
	}
	if (pending.some(Boolean)) {
		throw new Error("Supported-format table ends inside a rowspan");
	}
	return rows;
}

function escapeMarkdown(value) {
	return value.replaceAll("|", "\\|");
}

function textCell(lines, fallback = "-") {
	return lines.length === 0 ? fallback : lines.map(escapeMarkdown).join("<br>");
}

function codeCell(lines) {
	if (lines.length === 0) return "-";
	return lines
		.map((line) => (line === "-" ? line : `\`${line.replaceAll("`", "\\`")}\``))
		.join("<br>");
}

function sampleStatus(row) {
	if (row.brand.includes("Favorite") && row.files.includes("*.bin")) {
		return "`data/favorite/se_sys.bin` (local-only)";
	}
	return "Pending";
}

const rows = parseRows(await readFile(sourcePath, "utf8"));
if (rows.length !== expectedRowCount) {
	throw new Error(
		`Expected ${expectedRowCount} supported-format rows, found ${rows.length}`,
	);
}

const output = [
	"# Representative game test-data targets",
	"",
	`This checklist is generated from GARbro's official \`docs/supported.html\` at commit \`${baselineCommit}\`.`,
	"GARbro describes the Titles column as tested titles, so each row uses the first listed title as a",
	"representative acquisition target. Rows joined by HTML `rowspan` inherit the same brand and game.",
	"This user-facing table groups implementation variants, so its row count differs from the lower-level",
	"export inventory in `garbro-inventory.json`.",
	"",
	"A representative game demonstrates a known sample source; it does not prove that every release,",
	"regional edition, or encrypted variant uses the same resource format. The sole row without a",
	"GARbro-tested title, RPG Maker RGSSAD, uses the freely available official Knight Blade sample and",
	"labels it as an external selection rather than a GARbro-tested title.",
	"",
	"External selection source: [RPG Maker downloads](https://www.rpgmakerweb.com/downloads).",
	"",
	"Only use lawfully obtained game data. Keep copyrighted archives and GARbro output under",
	"`fixtures/private/`, which is excluded from version control. Record hashes and provenance rather",
	"than committing redistributable copies without permission.",
	"",
	`Total format rows: **${rows.length}**.`,
	"",
	"| # | Files | Signature | Brand / engine | Representative game | Sample |",
	"| ---: | --- | --- | --- | --- | --- |",
];

for (const [index, row] of rows.entries()) {
	const representative =
		row.titles.find((title) => title !== "-") ??
		fallbackRepresentatives.get(row.brand.join(" / ")) ??
		"Generic format / no tested title listed";
	output.push(
		`| ${index + 1} | ${codeCell(row.files)} | ${codeCell(row.signatures)} | ${textCell(row.brand)} | ${escapeMarkdown(representative)} | ${sampleStatus(row)} |`,
	);
}

output.push(
	"",
	"## Recording acquired samples",
	"",
	"After obtaining a target, replace `Pending` with a short private fixture identifier. Add a",
	"differential manifest containing the detected format, entry metadata, and SHA-256 values; do not",
	"add the original copyrighted archive to Git.",
);

await writeFile(outputPath, `${output.join("\n")}\n`);
console.log(`Wrote ${rows.length} test-data targets to ${outputPath}`);
