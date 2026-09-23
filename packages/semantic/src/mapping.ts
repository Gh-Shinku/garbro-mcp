import { createHash } from "node:crypto";
import {
	GarbroError,
	type InputReference,
	normalizeWorkspaceRelativePath,
	type ResourceAlias,
} from "@garbro-mcp/core";
import { stableSemanticId } from "./identity.js";
import type { JsonValue, SemanticName, SemanticRecord } from "./model.js";

const SEMANTIC_NAME = /^[a-z][a-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*$/;

export interface SemanticMapRow {
	subjectType: SemanticName;
	subjectKey: string;
	subjectName?: string;
	subjectProperties?: Readonly<Record<string, JsonValue>>;
	predicate: SemanticName;
	resourceType: string;
	rootId?: string;
	resourcePath: string;
	entryId?: string;
	resourceProperties?: Readonly<Record<string, JsonValue>>;
	override?: boolean;
}

export interface SemanticMapDocument {
	schemaVersion: 1;
	mappings: readonly SemanticMapRow[];
}

export interface SemanticMapImport {
	sha256: string;
	records: readonly SemanticRecord[];
	rows: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new GarbroError("INVALID_ARGUMENT", `${label} must be an object`);
	return value as Record<string, unknown>;
}

function required(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`${label} must be a non-empty string`,
		);
	return value;
}

function semanticName(value: unknown, label: string): SemanticName {
	const name = required(value, label);
	if (!SEMANTIC_NAME.test(name))
		throw new GarbroError("INVALID_ARGUMENT", `${label} is not namespaced`);
	return name as SemanticName;
}

function optional(value: unknown, label: string): string | undefined {
	return value === undefined || value === ""
		? undefined
		: required(value, label);
}

function properties(
	value: unknown,
	label: string,
): Readonly<Record<string, JsonValue>> | undefined {
	if (value === undefined) return undefined;
	return record(value, label) as Readonly<Record<string, JsonValue>>;
}

function parseJsonMap(value: unknown): SemanticMapRow[] {
	const document = record(value, "Semantic map");
	if (document.schemaVersion !== 1 || !Array.isArray(document.mappings))
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Semantic map must use schemaVersion 1 and contain mappings",
		);
	return document.mappings.map((value, index) => {
		const row = record(value, `mappings[${index}]`);
		if (row.override !== undefined && typeof row.override !== "boolean")
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`mappings[${index}].override must be boolean`,
			);
		return {
			subjectType: semanticName(
				row.subjectType,
				`mappings[${index}].subjectType`,
			),
			subjectKey: required(row.subjectKey, `mappings[${index}].subjectKey`),
			...(optional(row.subjectName, `mappings[${index}].subjectName`) ===
			undefined
				? {}
				: { subjectName: String(row.subjectName) }),
			...(properties(
				row.subjectProperties,
				`mappings[${index}].subjectProperties`,
			) === undefined
				? {}
				: {
						subjectProperties: properties(
							row.subjectProperties,
							`mappings[${index}].subjectProperties`,
						),
					}),
			predicate: semanticName(row.predicate, `mappings[${index}].predicate`),
			resourceType: required(
				row.resourceType,
				`mappings[${index}].resourceType`,
			),
			...(optional(row.rootId, `mappings[${index}].rootId`) === undefined
				? {}
				: { rootId: String(row.rootId) }),
			resourcePath: required(
				row.resourcePath,
				`mappings[${index}].resourcePath`,
			),
			...(optional(row.entryId, `mappings[${index}].entryId`) === undefined
				? {}
				: { entryId: String(row.entryId) }),
			...(properties(
				row.resourceProperties,
				`mappings[${index}].resourceProperties`,
			) === undefined
				? {}
				: {
						resourceProperties: properties(
							row.resourceProperties,
							`mappings[${index}].resourceProperties`,
						),
					}),
			...(row.override === undefined ? {} : { override: row.override }),
		} as SemanticMapRow;
	});
}

function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index] ?? "";
		if (quoted) {
			if (character === '"' && text[index + 1] === '"') {
				field += '"';
				index += 1;
			} else if (character === '"') quoted = false;
			else field += character;
			continue;
		}
		if (character === '"' && field.length === 0) quoted = true;
		else if (character === ",") {
			row.push(field);
			field = "";
		} else if (character === "\n" || character === "\r") {
			if (character === "\r" && text[index + 1] === "\n") index += 1;
			row.push(field);
			if (row.some((item) => item.length > 0)) rows.push(row);
			row = [];
			field = "";
		} else field += character;
	}
	if (quoted)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Semantic map CSV has an unterminated quote",
		);
	row.push(field);
	if (row.some((item) => item.length > 0)) rows.push(row);
	return rows;
}

function parseCsvMap(text: string): SemanticMapRow[] {
	const rows = parseCsvRows(text);
	const header = rows.shift();
	if (!header)
		throw new GarbroError("INVALID_ARGUMENT", "Semantic map CSV is empty");
	const columns = new Map(header.map((name, index) => [name.trim(), index]));
	const requiredColumns = [
		"subject_type",
		"subject_key",
		"predicate",
		"resource_type",
		"resource_path",
	];
	for (const column of requiredColumns)
		if (!columns.has(column))
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Semantic map CSV is missing ${column}`,
			);
	const get = (row: string[], name: string) =>
		row[columns.get(name) ?? -1]?.trim() ?? "";
	return rows.map((row, index) => {
		const override = get(row, "override");
		if (override !== "" && override !== "true" && override !== "false")
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Semantic map CSV row ${index + 2} has an invalid override`,
			);
		return {
			subjectType: semanticName(
				get(row, "subject_type"),
				`CSV row ${index + 2} subject_type`,
			),
			subjectKey: required(
				get(row, "subject_key"),
				`CSV row ${index + 2} subject_key`,
			),
			...(get(row, "subject_name") === ""
				? {}
				: { subjectName: get(row, "subject_name") }),
			predicate: semanticName(
				get(row, "predicate"),
				`CSV row ${index + 2} predicate`,
			),
			resourceType: required(
				get(row, "resource_type"),
				`CSV row ${index + 2} resource_type`,
			),
			...(get(row, "root_id") === "" ? {} : { rootId: get(row, "root_id") }),
			resourcePath: required(
				get(row, "resource_path"),
				`CSV row ${index + 2} resource_path`,
			),
			...(get(row, "entry_id") === "" ? {} : { entryId: get(row, "entry_id") }),
			...(override === "" ? {} : { override: override === "true" }),
		};
	});
}

function mapRowsToRecords(
	rows: readonly SemanticMapRow[],
	source: InputReference,
	sha256: string,
	defaultResourceRootId = source.rootId,
): SemanticRecord[] {
	const records = new Map<string, SemanticRecord>();
	for (const [index, row] of rows.entries()) {
		const rootId = row.rootId ?? defaultResourceRootId;
		const resourcePath = normalizeWorkspaceRelativePath(row.resourcePath);
		const subjectId = stableSemanticId("entity", {
			type: row.subjectType,
			key: row.subjectKey,
		});
		const resourceId = stableSemanticId("resource", {
			rootId,
			path: resourcePath,
			entryId: row.entryId ?? null,
		});
		const evidenceId = stableSemanticId("evidence", {
			source: { rootId: source.rootId, path: source.path },
			sha256,
			row: index + 1,
		});
		const relationId = stableSemanticId("relation", {
			subjectId,
			predicate: row.predicate,
			resourceId,
			evidenceId,
		});
		records.set(subjectId, {
			kind: "entity",
			id: subjectId,
			type: row.subjectType,
			properties: {
				key: row.subjectKey,
				...(row.subjectName === undefined ? {} : { name: row.subjectName }),
				...(row.subjectProperties ?? {}),
			},
		});
		records.set(resourceId, {
			kind: "resource",
			id: resourceId,
			type: "garbro:resource",
			resourceType: row.resourceType,
			locator: {
				source: { rootId, path: resourcePath },
				...(row.entryId === undefined ? {} : { entryId: row.entryId }),
			},
			properties: row.resourceProperties ?? {},
		});
		records.set(evidenceId, {
			kind: "evidence",
			id: evidenceId,
			type: "garbro:userMapping",
			source: { locator: source, sha256 },
			producer: { analyzerId: "user.mapping", analyzerVersion: "1" },
			method: "user-assertion",
			properties: { row: index + 1 },
		});
		records.set(relationId, {
			kind: "relation",
			id: relationId,
			subject: subjectId,
			predicate: row.predicate,
			object: { kind: "entity", id: resourceId },
			...(row.override === true ? { qualifiers: { userOverride: true } } : {}),
			evidenceIds: [evidenceId],
			status: "user-confirmed",
		});
	}
	return [...records.values()].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
}

export function parseSemanticMap(
	bytes: Uint8Array,
	format: "json" | "csv",
	source: InputReference,
	options: { defaultResourceRootId?: string } = {},
): SemanticMapImport {
	const buffer = Buffer.from(bytes);
	const sha256 = createHash("sha256").update(buffer).digest("hex");
	const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
	let rows: SemanticMapRow[];
	try {
		rows =
			format === "json"
				? parseJsonMap(JSON.parse(text) as unknown)
				: parseCsvMap(text);
	} catch (error) {
		if (error instanceof GarbroError) throw error;
		throw new GarbroError("INVALID_ARGUMENT", "Unable to parse semantic map", {
			cause: error,
		});
	}
	return {
		sha256,
		rows: rows.length,
		records: mapRowsToRecords(
			rows,
			source,
			sha256,
			options.defaultResourceRootId ?? source.rootId,
		),
	};
}

export function resourceAliasesToSemanticRecords(
	aliases: readonly ResourceAlias[],
	source: InputReference,
	sha256: string,
): SemanticRecord[] {
	if (!/^[0-9a-f]{64}$/i.test(sha256))
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Resource catalog hash is invalid",
		);
	const rows: SemanticMapRow[] = [];
	for (const resource of aliases)
		for (const alias of resource.aliases)
			rows.push({
				subjectType: "garbro:alias",
				subjectKey: `${resource.locale ?? ""}\0${alias}`,
				subjectName: alias,
				subjectProperties: {
					...(resource.locale === undefined ? {} : { locale: resource.locale }),
				},
				predicate: "garbro:aliasOf",
				resourceType: "unknown",
				rootId: resource.locator.source.rootId,
				resourcePath: resource.locator.source.path,
				...(resource.locator.entryId === undefined
					? {}
					: { entryId: resource.locator.entryId }),
				resourceProperties: {
					...(resource.metadata ?? {}),
					...(resource.expected ?? {}),
				},
			});
	return mapRowsToRecords(rows, source, sha256);
}
