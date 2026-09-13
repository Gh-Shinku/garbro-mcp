// Screens every ported format for the rule stated in docs/formats/system21-tex-image.md: a format whose
// detection is gated by a signature must re-check that signature itself, because the registry gate is a filter
// for the dispatcher and a format's `detect` can be called directly.
//
// The screen is deliberately coarse: it reports files that register a non-empty signature whose code never
// mentions a signature-like constant. A hit needs a look at the detection path rather than a mechanical fix.
// The first run found four, all of them re-checking under another name: `emon/eme` compares the literal
// `RREDATA `, `riddle/pac` compares `SIG`, `sceneplayer/pmx` compares a first byte through `ZLIB_FIRST_BYTE`,
// and `reallive/g00` gates on a `g00` extension, which is stricter than the single byte signature involved.

import fs from "node:fs";
import path from "node:path";

const ROOT = "packages/formats/src";
/** Tokens that count as a signature check when they appear in a file. */
const RECHECK_TOKENS = /SIGNATURE|signature|MAGIC|TAG_BYTES|MARKER/;

/** Formats whose detection is a content probe with no signature to re-check are not the screen's business. */
const SKIP = new Set(["index.ts", "support.generated.ts"]);

const flagged = [];

function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "shared") walk(full);
			continue;
		}
		if (!full.endsWith(".ts") || SKIP.has(entry.name)) continue;
		const text = fs.readFileSync(full, "utf8");
		const detection = text.match(
			/detection:\s*\{\s*signatures:\s*\[([\s\S]*?)\]\s*\}/,
		);
		if (!detection) continue;
		if (detection[1].trim().length === 0) continue;
		// Everything outside the detection block counts, because the check usually lives in a layout reader.
		const rest = text.replace(detection[0], "");
		if (!RECHECK_TOKENS.test(rest)) flagged.push(full);
	}
}

walk(ROOT);
console.log(
	`${flagged.length} file(s) register a signature with no signature-like constant elsewhere:`,
);
for (const file of flagged) console.log(`  ${file}`);
console.log(
	"\nInspect each detection path by hand: a marker constant under another name or an extension gate " +
		"that is stricter than the signature both satisfy the rule.",
);
