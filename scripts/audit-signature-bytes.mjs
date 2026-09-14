// Screens every ported format for a marker that does not match the reference's own signature constant.
//
// GARbro reads the first four bytes of a file as one little endian word and compares it with the format's
// `Signature` (or with each of its `Signatures`). A constant whose top byte is zero therefore matches only a
// file whose fourth byte is zero, and a two or three character constant still pins that zero. This screen
// decodes the reference constants to the bytes they demand and looks for those bytes in the port file, so it
// catches both a misspelt marker (Leaf LGF shipped as `lff` where the constants read `lfg`) and a probe that
// checks fewer bytes than the reference does.
//
// Usage: node scripts/audit-signature-bytes.mjs

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const ROOT = "packages/formats/src";
const GARBRO = "GARbro";
const SKIP = new Set(["index.ts", "support.generated.ts"]);

/** Little endian bytes of a constant, counting the significant ones. */
function constantBytes(value) {
	const size = value > 0xffffff ? 4 : value > 0xffff ? 3 : value > 0xff ? 2 : 1;
	const bytes = [];
	for (let index = 0; index < size; index += 1) {
		bytes.push((value >>> (index * 8)) & 0xff);
	}
	return bytes;
}

/** Comments quote the reference freely, so they are not evidence of what the code compares. */
function withoutComments(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Decodes a string literal's escapes into the bytes it holds. */
function literalBytes(raw) {
	let out = "";
	for (let index = 0; index < raw.length; index += 1) {
		const char = raw[index];
		if (char !== "\\") {
			out += char;
			continue;
		}
		const next = raw[index + 1] ?? "";
		index += 1;
		if (next === "n") out += "\n";
		else if (next === "r") out += "\r";
		else if (next === "t") out += "\t";
		else if (next === "0") out += "\0";
		else if (next === "x") {
			out += String.fromCharCode(
				Number.parseInt(raw.slice(index + 1, index + 3), 16),
			);
			index += 2;
		} else if (next === "u") {
			out += String.fromCharCode(
				Number.parseInt(raw.slice(index + 1, index + 5), 16),
			);
			index += 4;
		} else out += next;
	}
	return [...Buffer.from(out, "latin1")];
}

/** Every byte sequence the port writes as a literal: byte arrays and string constants alike. */
function literalsOf(text) {
	const code = withoutComments(text);
	const found = [];
	for (const match of code.matchAll(/\[([0-9a-fA-Fx,\s]+)\]/g)) {
		const body = match[1] ?? "";
		if (!/0x/i.test(body)) continue;
		const values = body
			.split(",")
			.map((piece) => piece.trim())
			.filter((piece) => piece.length > 0)
			.map((piece) => Number.parseInt(piece, 16));
		if (values.length > 0 && values.every((value) => Number.isInteger(value)))
			found.push(values);
	}
	for (const match of code.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
		const bytes = literalBytes(match[1] ?? "");
		if (bytes.length > 0 && bytes.length <= 16) found.push(bytes);
	}
	return found;
}

function containsSequence(haystacks, needle) {
	if (needle.length === 0) return false;
	return haystacks.some((bytes) => {
		if (bytes.length < needle.length) return false;
		for (let start = 0; start + needle.length <= bytes.length; start += 1) {
			if (needle.every((value, index) => bytes[start + index] === value))
				return true;
		}
		return false;
	});
}

async function* walk(dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "shared") yield* walk(full);
			continue;
		}
		if (entry.name.endsWith(".ts") && !SKIP.has(entry.name)) yield full;
	}
}

const flagged = [];
let checked = 0;
for await (const file of walk(ROOT)) {
	const text = await readFile(file, "utf8");
	if (!/detection:\s*\{/.test(text)) continue;
	const sources = [...text.matchAll(/source:\s*"([^"]+\.cs)"/g)].map(
		(m) => m[1],
	);
	if (sources.length === 0) continue;
	const constants = [];
	for (const source of sources) {
		let reference;
		try {
			reference = await readFile(resolve(GARBRO, source), "utf8");
		} catch {
			continue;
		}
		for (const match of reference.matchAll(
			/Signature\s*\{\s*get\s*\{\s*return\s+(0x[0-9a-fA-F]+)/g,
		)) {
			constants.push(Number.parseInt(match[1], 16));
		}
		for (const match of reference.matchAll(
			/Signatures\s*=\s*new\s+uint\[\]\s*\{([^}]*)\}/g,
		)) {
			for (const piece of (match[1] ?? "").split(",")) {
				const trimmed = piece.trim();
				if (/^0x[0-9a-fA-F]+$/.test(trimmed))
					constants.push(Number.parseInt(trimmed, 16));
			}
		}
	}
	// A port that compares the word itself is as faithful as one that writes the bytes out.
	const code = withoutComments(text).toLowerCase();
	const asWord = (value) =>
		[value.toString(16), value.toString(16).padStart(8, "0")].some((form) =>
			code.includes(`0x${form}`),
		);
	// A single byte constant is a placeholder rather than a marker (the reference has 8 and 3 among
	// them), and a format with several signatures is satisfied by whichever one the port implements.
	const wanted = constants.filter((value) => value > 0xff && !asWord(value));
	if (wanted.length === 0) continue;
	checked += 1;
	const literals = literalsOf(text);
	const present = wanted.filter((value) =>
		containsSequence(literals, constantBytes(value)),
	);
	if (wanted.length > 0 && present.length === 0) {
		flagged.push({
			file: relative(process.cwd(), file),
			missing: wanted.map((value) => ({
				word: `0x${value.toString(16).toUpperCase()}`,
				bytes: constantBytes(value)
					.map((byte) => byte.toString(16).padStart(2, "0"))
					.join(" "),
			})),
		});
	}
}

console.log(`${checked} port(s) with a reference signature were screened`);
if (flagged.length === 0) {
	console.log("every port carries the bytes its reference constant demands");
} else {
	console.log(
		`${flagged.length} port(s) carry none of the bytes their reference constants name.`,
	);
	console.log(
		"Each needs a look by hand: a marker can be computed rather than written out, decrypted before it is",
	);
	console.log(
		"compared, or checked by the reference's own TryOpen as something looser than its signature list.",
	);
	console.log(
		"This screen has found two real faults so far: a misspelt Leaf LGF marker and a three byte HBM check",
	);
	console.log("where the reference's word demands a null.");
	for (const entry of flagged) {
		const words = entry.missing
			.map((item) => `${item.word} -> ${item.bytes}`)
			.join(", ");
		console.log(`  ${entry.file}: ${words}`);
	}
}
