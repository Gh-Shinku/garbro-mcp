import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, open, stat, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { GarbroError, type WorkspacePolicy } from "@garbro-mcp/core";
import { canonicalJson } from "./identity.js";
import type {
	JsonValue,
	SemanticAssertionStatus,
	SemanticCatalogHeader,
	SemanticCatalogSummary,
	SemanticEvidence,
	SemanticName,
	SemanticNode,
	SemanticRecord,
	SemanticRelationAssertion,
} from "./model.js";
import type { ValidationIssue, VocabularyRegistry } from "./vocabulary.js";

const HASH = /^[0-9a-f]{64}$/;
const DEFAULT_MAX_CATALOG_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_RECORDS = 1_000_000;

export interface SemanticCatalogArtifact {
	outputRootId: string;
	relativePath: string;
	absolutePath: string;
	bytesWritten: string;
	sha256: string;
	summaryPath: string;
}

export interface LoadedSemanticCatalog {
	header: SemanticCatalogHeader;
	index: SemanticCatalogIndex;
	summary: SemanticCatalogSummary;
	absolutePath: string;
}

export interface SemanticQuery {
	entityType?: SemanticName;
	predicate?: SemanticName;
	query?: string;
	resourceType?: string;
	statuses?: readonly SemanticAssertionStatus[];
}

export interface SemanticQueryResult {
	nodes: readonly SemanticNode[];
	relations: readonly SemanticRelationAssertion[];
}

function emptyStatusCounts(): Record<SemanticAssertionStatus, number> {
	return {
		verified: 0,
		"user-confirmed": 0,
		candidate: 0,
		conflicted: 0,
		rejected: 0,
		unresolved: 0,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		throw new GarbroError("INVALID_ARGUMENT", `${label} must be a string`);
	return value;
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`${label} must be a string array`,
		);
	return [...value];
}

function jsonProperties(
	value: unknown,
	label: string,
): Readonly<Record<string, JsonValue>> {
	if (!isRecord(value))
		throw new GarbroError("INVALID_ARGUMENT", `${label} must be an object`);
	return value as Readonly<Record<string, JsonValue>>;
}

function parseInputReference(value: unknown, label: string) {
	if (!isRecord(value))
		throw new GarbroError("INVALID_ARGUMENT", `${label} is invalid`);
	return {
		rootId: nonEmptyString(value.rootId, `${label}.rootId`),
		path: nonEmptyString(value.path, `${label}.path`),
	};
}

function parseLocator(value: unknown, label: string) {
	if (!isRecord(value))
		throw new GarbroError("INVALID_ARGUMENT", `${label} is invalid`);
	return {
		source: parseInputReference(value.source, `${label}.source`),
		...(value.entryId === undefined
			? {}
			: { entryId: nonEmptyString(value.entryId, `${label}.entryId`) }),
	};
}

function parseHeader(value: unknown): SemanticCatalogHeader {
	if (!isRecord(value) || value.kind !== "header" || value.schemaVersion !== 1)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Semantic catalog must begin with a schemaVersion 1 header",
		);
	const game = value.game;
	const createdBy = value.createdBy;
	const vocabularies = value.vocabularies;
	if (!isRecord(game) || !isRecord(createdBy) || !isRecord(vocabularies))
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Invalid semantic catalog header",
		);
	const versions: Record<string, number> = {};
	for (const [namespace, version] of Object.entries(vocabularies)) {
		if (!Number.isSafeInteger(version) || Number(version) <= 0)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Invalid vocabulary version: ${namespace}`,
			);
		versions[namespace] = Number(version);
	}
	return {
		kind: "header",
		schemaVersion: 1,
		game: {
			fingerprint: nonEmptyString(game.fingerprint, "game.fingerprint"),
			...(game.rootId === undefined
				? {}
				: { rootId: nonEmptyString(game.rootId, "game.rootId") }),
			basePath: nonEmptyString(game.basePath, "game.basePath"),
		},
		vocabularies: versions,
		createdBy: {
			name: nonEmptyString(createdBy.name, "createdBy.name"),
			version: nonEmptyString(createdBy.version, "createdBy.version"),
		},
	};
}

function parseRecord(value: unknown): SemanticRecord {
	if (!isRecord(value))
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Semantic record must be an object",
		);
	const kind = value.kind;
	const id = nonEmptyString(value.id, "record.id");
	if (
		kind !== "entity" &&
		kind !== "resource" &&
		kind !== "relation" &&
		kind !== "evidence" &&
		kind !== "diagnostic"
	)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			`Unknown semantic record kind: ${String(kind)}`,
		);
	if (kind === "entity")
		return {
			kind,
			id,
			type: nonEmptyString(value.type, "entity.type") as SemanticName,
			properties: jsonProperties(value.properties, "entity.properties"),
		};
	if (kind === "resource") {
		if (value.type !== "garbro:resource")
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"Semantic resources must use type garbro:resource",
			);
		return {
			kind,
			id,
			type: "garbro:resource",
			resourceType: nonEmptyString(value.resourceType, "resource.resourceType"),
			locator: parseLocator(value.locator, "resource.locator"),
			properties: jsonProperties(value.properties, "resource.properties"),
		};
	}
	if (kind === "relation") {
		if (!isRecord(value.object))
			throw new GarbroError("INVALID_ARGUMENT", "relation.object is invalid");
		const object =
			value.object.kind === "entity"
				? {
						kind: "entity" as const,
						id: nonEmptyString(value.object.id, "relation.object.id"),
					}
				: value.object.kind === "literal" && "value" in value.object
					? {
							kind: "literal" as const,
							value: value.object.value as JsonValue,
						}
					: undefined;
		if (object === undefined)
			throw new GarbroError("INVALID_ARGUMENT", "relation.object is invalid");
		const statuses: SemanticAssertionStatus[] = [
			"verified",
			"user-confirmed",
			"candidate",
			"conflicted",
			"rejected",
			"unresolved",
		];
		if (!statuses.includes(value.status as SemanticAssertionStatus))
			throw new GarbroError("INVALID_ARGUMENT", "relation.status is invalid");
		return {
			kind,
			id,
			subject: nonEmptyString(value.subject, "relation.subject"),
			predicate: nonEmptyString(
				value.predicate,
				"relation.predicate",
			) as SemanticName,
			object,
			...(value.qualifiers === undefined
				? {}
				: {
						qualifiers: jsonProperties(value.qualifiers, "relation.qualifiers"),
					}),
			evidenceIds: stringArray(value.evidenceIds, "relation.evidenceIds"),
			status: value.status as SemanticAssertionStatus,
		};
	}
	if (kind === "evidence") {
		if (!isRecord(value.source) || !isRecord(value.producer))
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"evidence source or producer is invalid",
			);
		const method = value.method;
		if (
			method !== "deterministic" &&
			method !== "user-assertion" &&
			method !== "heuristic"
		)
			throw new GarbroError("INVALID_ARGUMENT", "evidence.method is invalid");
		const sha256 = nonEmptyString(
			value.source.sha256,
			"evidence.source.sha256",
		);
		if (!HASH.test(sha256))
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"evidence source hash is invalid",
			);
		return {
			kind,
			id,
			type: nonEmptyString(value.type, "evidence.type") as SemanticName,
			source: {
				locator: parseInputReference(
					value.source.locator,
					"evidence.source.locator",
				),
				...(value.source.entryId === undefined
					? {}
					: {
							entryId: nonEmptyString(
								value.source.entryId,
								"evidence.source.entryId",
							),
						}),
				...(value.source.byteOffset === undefined
					? {}
					: {
							byteOffset: nonEmptyString(
								value.source.byteOffset,
								"evidence.source.byteOffset",
							),
						}),
				...(value.source.byteLength === undefined
					? {}
					: {
							byteLength: nonEmptyString(
								value.source.byteLength,
								"evidence.source.byteLength",
							),
						}),
				...(value.source.scene === undefined
					? {}
					: {
							scene: nonEmptyString(
								value.source.scene,
								"evidence.source.scene",
							),
						}),
				...(value.source.instructionOffset === undefined
					? {}
					: {
							instructionOffset: nonEmptyString(
								value.source.instructionOffset,
								"evidence.source.instructionOffset",
							),
						}),
				sha256,
			},
			producer: {
				analyzerId: nonEmptyString(
					value.producer.analyzerId,
					"evidence.producer.analyzerId",
				),
				analyzerVersion: nonEmptyString(
					value.producer.analyzerVersion,
					"evidence.producer.analyzerVersion",
				),
				...(value.producer.profile === undefined
					? {}
					: {
							profile: nonEmptyString(
								value.producer.profile,
								"evidence.producer.profile",
							),
						}),
			},
			method,
			...(value.properties === undefined
				? {}
				: {
						properties: jsonProperties(value.properties, "evidence.properties"),
					}),
		};
	}
	const severity = value.severity;
	if (severity !== "info" && severity !== "warning" && severity !== "error")
		throw new GarbroError("INVALID_ARGUMENT", "diagnostic.severity is invalid");
	return {
		kind: "diagnostic",
		id,
		severity,
		code: nonEmptyString(value.code, "diagnostic.code"),
		message: nonEmptyString(value.message, "diagnostic.message"),
		...(value.relatedIds === undefined
			? {}
			: { relatedIds: stringArray(value.relatedIds, "diagnostic.relatedIds") }),
	};
}

function recordJson(record: SemanticRecord | SemanticCatalogHeader): JsonValue {
	return record as unknown as JsonValue;
}

export class SemanticCatalogIndex {
	readonly nodes = new Map<string, SemanticNode>();
	readonly relations = new Map<string, SemanticRelationAssertion>();
	readonly evidence = new Map<string, SemanticEvidence>();
	readonly diagnostics: SemanticRecord[] = [];
	readonly #ids = new Set<string>();

	add(record: SemanticRecord): void {
		if (this.#ids.has(record.id))
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Duplicate semantic record ID: ${record.id}`,
			);
		this.#ids.add(record.id);
		if (record.kind === "entity" || record.kind === "resource")
			this.nodes.set(record.id, record);
		else if (record.kind === "relation") this.relations.set(record.id, record);
		else if (record.kind === "evidence") this.evidence.set(record.id, record);
		else this.diagnostics.push(record);
	}

	validate(vocabularies: VocabularyRegistry): ValidationIssue[] {
		const issues: ValidationIssue[] = [];
		for (const node of this.nodes.values()) {
			issues.push(
				...vocabularies
					.validateNode(node)
					.map((issue) => ({ ...issue, path: `${node.id}.${issue.path}` })),
			);
			if (node.kind === "resource") {
				if (node.resourceType.length === 0)
					issues.push({
						path: `${node.id}.resourceType`,
						message: "Resource type is empty",
					});
				if (
					node.locator.source.rootId.length === 0 ||
					node.locator.source.path.length === 0
				)
					issues.push({
						path: `${node.id}.locator`,
						message: "Resource locator is incomplete",
					});
			}
		}
		for (const relation of this.relations.values()) {
			issues.push(
				...vocabularies.validateRelation(relation, this.nodes).map((issue) => ({
					...issue,
					path: `${relation.id}.${issue.path}`,
				})),
			);
			for (const evidenceId of relation.evidenceIds)
				if (!this.evidence.has(evidenceId))
					issues.push({
						path: `${relation.id}.evidenceIds`,
						message: `Evidence is missing: ${evidenceId}`,
					});
		}
		return issues;
	}

	query(
		query: SemanticQuery,
		vocabularies: VocabularyRegistry,
	): SemanticQueryResult {
		const normalized = query.query?.trim().toLocaleLowerCase();
		const statuses = new Set(
			query.statuses ?? (["verified", "user-confirmed"] as const),
		);
		const nodes = [...this.nodes.values()].filter((node) => {
			if (query.entityType !== undefined && node.type !== query.entityType)
				return false;
			if (
				query.resourceType !== undefined &&
				(node.kind !== "resource" || node.resourceType !== query.resourceType)
			)
				return false;
			if (normalized === undefined || normalized.length === 0) return true;
			return canonicalJson(node.properties)
				.toLocaleLowerCase()
				.includes(normalized);
		});
		const matchingIds = new Set(nodes.map((node) => node.id));
		const relations = [...this.relations.values()].filter((relation) => {
			if (!statuses.has(relation.status)) return false;
			if (
				query.predicate !== undefined &&
				relation.predicate !== query.predicate
			)
				return false;
			if (!vocabularies.predicate(relation.predicate)) return false;
			if (query.entityType !== undefined || normalized !== undefined)
				return (
					matchingIds.has(relation.subject) ||
					(relation.object.kind === "entity" &&
						matchingIds.has(relation.object.id))
				);
			return true;
		});
		return { nodes, relations };
	}
}

function summarize(
	index: SemanticCatalogIndex,
	manifestSha256: string,
): SemanticCatalogSummary {
	const statuses = emptyStatusCounts();
	for (const relation of index.relations.values())
		statuses[relation.status] += 1;
	let resources = 0;
	for (const node of index.nodes.values())
		if (node.kind === "resource") resources += 1;
	return {
		manifestSha256,
		records:
			index.nodes.size +
			index.relations.size +
			index.evidence.size +
			index.diagnostics.length,
		entities: index.nodes.size - resources,
		resources,
		relations: index.relations.size,
		evidence: index.evidence.size,
		diagnostics: index.diagnostics.length,
		statuses,
	};
}

export async function writeSemanticCatalog(
	workspace: WorkspacePolicy,
	header: SemanticCatalogHeader,
	records: AsyncIterable<SemanticRecord> | Iterable<SemanticRecord>,
	vocabularies: VocabularyRegistry,
	options: {
		outputRootId?: string;
		maxRecords?: number;
		signal?: AbortSignal;
	} = {},
): Promise<{
	artifact: SemanticCatalogArtifact;
	summary: SemanticCatalogSummary;
}> {
	if (!HASH.test(header.game.fingerprint))
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Game fingerprint must be SHA-256",
		);
	const relativeDirectory = `.garbro-semantic/${header.game.fingerprint}`;
	const directory = await workspace.resolveOutputDirectory(
		relativeDirectory,
		options.outputRootId,
	);
	const tempPath = resolve(directory, `.${randomUUID()}.tmp`);
	const file = await open(tempPath, "wx", 0o600);
	const hash = createHash("sha256");
	const index = new SemanticCatalogIndex();
	let bytesWritten = 0;
	const writeLine = async (value: SemanticCatalogHeader | SemanticRecord) => {
		const bytes = Buffer.from(`${canonicalJson(recordJson(value))}\n`);
		await file.write(bytes);
		hash.update(bytes);
		bytesWritten += bytes.length;
	};
	try {
		await writeLine(header);
		for await (const record of records) {
			if (options.signal?.aborted)
				throw new GarbroError(
					"CANCELLED",
					"Semantic catalog writing cancelled",
				);
			if (
				index.nodes.size +
					index.relations.size +
					index.evidence.size +
					index.diagnostics.length >=
				(options.maxRecords ?? DEFAULT_MAX_RECORDS)
			)
				throw new GarbroError(
					"LIMIT_EXCEEDED",
					"Semantic catalog record limit exceeded",
				);
			index.add(record);
			await writeLine(record);
		}
		const issues = index.validate(vocabularies);
		if (issues.length > 0)
			throw new GarbroError(
				"INVALID_ARGUMENT",
				"Semantic catalog validation failed",
				{
					details: { issues: issues.slice(0, 100) },
				},
			);
	} catch (error) {
		await file.close();
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
	await file.close();
	const sha256 = hash.digest("hex");
	const name = `${sha256}.jsonl`;
	const absolutePath = resolve(directory, name);
	try {
		await link(tempPath, absolutePath);
	} catch (error) {
		const code =
			error instanceof Error && "code" in error ? error.code : undefined;
		if (code !== "EEXIST") {
			await unlink(tempPath).catch(() => undefined);
			throw error;
		}
	}
	await unlink(tempPath).catch(() => undefined);
	const summary = summarize(index, sha256);
	const summaryName = `${sha256}.summary.json`;
	const summaryPath = resolve(directory, summaryName);
	await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	}).catch(async (error) => {
		const code =
			error instanceof Error && "code" in error ? error.code : undefined;
		if (code !== "EEXIST") throw error;
		const info = await lstat(summaryPath);
		if (!info.isFile() || info.isSymbolicLink())
			throw new GarbroError(
				"UNSAFE_PATH",
				"Semantic summary is not a regular file",
			);
	});
	const outputRootId =
		options.outputRootId ?? workspace.outputRoots[0]?.id ?? "default";
	return {
		artifact: {
			outputRootId,
			relativePath: `${relativeDirectory}/${name}`,
			absolutePath,
			bytesWritten: bytesWritten.toString(),
			sha256,
			summaryPath: `${relativeDirectory}/${summaryName}`,
		},
		summary,
	};
}

export async function readSemanticCatalog(
	absolutePath: string,
	vocabularies: VocabularyRegistry,
	options: { maxBytes?: number; maxRecords?: number } = {},
): Promise<LoadedSemanticCatalog> {
	const info = await stat(absolutePath);
	if (
		!info.isFile() ||
		info.size > (options.maxBytes ?? DEFAULT_MAX_CATALOG_BYTES)
	)
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			"Semantic catalog is not a bounded regular file",
		);
	const hash = createHash("sha256");
	const stream = createReadStream(absolutePath);
	stream.on("data", (chunk) => hash.update(chunk));
	const lines = createInterface({
		input: stream,
		crlfDelay: Number.POSITIVE_INFINITY,
	});
	let header: SemanticCatalogHeader | undefined;
	const index = new SemanticCatalogIndex();
	let lineNumber = 0;
	for await (const line of lines) {
		lineNumber += 1;
		if (line.length === 0) continue;
		let value: unknown;
		try {
			value = JSON.parse(line) as unknown;
		} catch (error) {
			throw new GarbroError(
				"INVALID_ARGUMENT",
				`Invalid catalog JSON on line ${lineNumber}`,
				{ cause: error },
			);
		}
		if (header === undefined) {
			header = parseHeader(value);
			continue;
		}
		if (
			index.nodes.size +
				index.relations.size +
				index.evidence.size +
				index.diagnostics.length >=
			(options.maxRecords ?? DEFAULT_MAX_RECORDS)
		)
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				"Semantic catalog record limit exceeded",
			);
		index.add(parseRecord(value));
	}
	if (header === undefined)
		throw new GarbroError("INVALID_ARGUMENT", "Semantic catalog is empty");
	const issues = index.validate(vocabularies);
	if (issues.length > 0)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"Semantic catalog validation failed",
			{
				details: { issues: issues.slice(0, 100) },
			},
		);
	const sha256 = hash.digest("hex");
	return {
		header,
		index,
		summary: summarize(index, sha256),
		absolutePath,
	};
}

export function semanticCatalogName(path: string): string {
	return basename(path, ".jsonl");
}
