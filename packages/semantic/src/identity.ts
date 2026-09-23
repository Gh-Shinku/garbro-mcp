import { createHash } from "node:crypto";
import type { JsonValue } from "./model.js";

function canonical(value: JsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const entries = Object.entries(value).sort(([left], [right]) =>
		left.localeCompare(right),
	);
	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
		.join(",")}}`;
}

export function canonicalJson(value: JsonValue): string {
	return canonical(value);
}

export function stableSemanticId(prefix: string, identity: JsonValue): string {
	if (!/^[a-z][a-z0-9-]*$/.test(prefix))
		throw new Error(`Invalid semantic ID prefix: ${prefix}`);
	return `${prefix}:${createHash("sha256").update(canonical(identity)).digest("hex")}`;
}
