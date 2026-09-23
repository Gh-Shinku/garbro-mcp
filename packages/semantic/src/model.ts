import type { InputReference } from "@garbro-mcp/core";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
	| JsonPrimitive
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export type SemanticName = `${string}:${string}`;
export type SemanticId = string;

export interface SemanticEntity {
	kind: "entity";
	id: SemanticId;
	type: SemanticName;
	properties: Readonly<Record<string, JsonValue>>;
}

export interface SemanticResource {
	kind: "resource";
	id: SemanticId;
	type: "garbro:resource";
	resourceType: string;
	locator: {
		source: InputReference;
		entryId?: string;
	};
	properties: Readonly<Record<string, JsonValue>>;
}

export type SemanticObject =
	| { kind: "entity"; id: SemanticId }
	| { kind: "literal"; value: JsonValue };

export type SemanticAssertionStatus =
	| "verified"
	| "user-confirmed"
	| "candidate"
	| "conflicted"
	| "rejected"
	| "unresolved";

export interface SemanticRelationAssertion {
	kind: "relation";
	id: SemanticId;
	subject: SemanticId;
	predicate: SemanticName;
	object: SemanticObject;
	qualifiers?: Readonly<Record<string, JsonValue>>;
	evidenceIds: readonly SemanticId[];
	status: SemanticAssertionStatus;
}

export interface SemanticEvidence {
	kind: "evidence";
	id: SemanticId;
	type: SemanticName;
	source: {
		locator: InputReference;
		entryId?: string;
		byteOffset?: string;
		byteLength?: string;
		scene?: string;
		instructionOffset?: string;
		sha256: string;
	};
	producer: {
		analyzerId: string;
		analyzerVersion: string;
		profile?: string;
	};
	method: "deterministic" | "user-assertion" | "heuristic";
	properties?: Readonly<Record<string, JsonValue>>;
}

export interface SemanticDiagnostic {
	kind: "diagnostic";
	id: SemanticId;
	severity: "info" | "warning" | "error";
	code: string;
	message: string;
	relatedIds?: readonly SemanticId[];
}

export type SemanticNode = SemanticEntity | SemanticResource;
export type SemanticRecord =
	| SemanticNode
	| SemanticRelationAssertion
	| SemanticEvidence
	| SemanticDiagnostic;

export interface SemanticCatalogHeader {
	kind: "header";
	schemaVersion: 1;
	game: {
		fingerprint: string;
		rootId?: string;
		basePath: string;
	};
	vocabularies: Readonly<Record<string, number>>;
	createdBy: {
		name: string;
		version: string;
	};
}

export interface SemanticCatalogSummary {
	manifestSha256: string;
	records: number;
	entities: number;
	resources: number;
	relations: number;
	evidence: number;
	diagnostics: number;
	statuses: Readonly<Record<SemanticAssertionStatus, number>>;
}
