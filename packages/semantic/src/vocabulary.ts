import type {
	JsonValue,
	SemanticName,
	SemanticNode,
	SemanticRelationAssertion,
} from "./model.js";

const SEMANTIC_NAME = /^[a-z][a-z0-9_-]*:[A-Za-z][A-Za-z0-9_-]*$/;

export interface ValidationIssue {
	path: string;
	message: string;
}

export type PropertiesValidator = (
	properties: Readonly<Record<string, JsonValue>>,
) => readonly ValidationIssue[];

export interface EntityTypeDefinition {
	type: SemanticName;
	validateProperties?: PropertiesValidator;
}

export interface PredicateDefinition {
	predicate: SemanticName;
	subjectTypes: readonly SemanticName[];
	objectTypes?: readonly SemanticName[];
	allowLiteral?: boolean;
	validateQualifiers?: PropertiesValidator;
}

export interface SemanticVocabulary {
	namespace: string;
	version: number;
	entityTypes: Readonly<Record<string, EntityTypeDefinition>>;
	predicates: Readonly<Record<string, PredicateDefinition>>;
}

export function defineVocabulary<const T extends SemanticVocabulary>(
	vocabulary: T,
): T {
	return vocabulary;
}

function namespaceOf(name: SemanticName): string {
	return name.slice(0, name.indexOf(":"));
}

function assertSemanticName(name: string, label: string): void {
	if (!SEMANTIC_NAME.test(name)) throw new Error(`Invalid ${label}: ${name}`);
}

export class VocabularyRegistry {
	readonly #vocabularies = new Map<string, SemanticVocabulary>();
	readonly #entityTypes = new Map<SemanticName, EntityTypeDefinition>();
	readonly #predicates = new Map<SemanticName, PredicateDefinition>();

	register(vocabulary: SemanticVocabulary): void {
		if (!/^[a-z][a-z0-9_-]*$/.test(vocabulary.namespace))
			throw new Error(`Invalid vocabulary namespace: ${vocabulary.namespace}`);
		if (!Number.isSafeInteger(vocabulary.version) || vocabulary.version <= 0)
			throw new Error(
				`Invalid vocabulary version: ${vocabulary.namespace}@${vocabulary.version}`,
			);
		if (this.#vocabularies.has(vocabulary.namespace))
			throw new Error(`Vocabulary already registered: ${vocabulary.namespace}`);

		for (const definition of Object.values(vocabulary.entityTypes)) {
			assertSemanticName(definition.type, "entity type");
			if (namespaceOf(definition.type) !== vocabulary.namespace)
				throw new Error(
					`Entity type ${definition.type} is outside vocabulary ${vocabulary.namespace}`,
				);
			if (this.#entityTypes.has(definition.type))
				throw new Error(`Entity type already registered: ${definition.type}`);
		}
		for (const definition of Object.values(vocabulary.predicates)) {
			assertSemanticName(definition.predicate, "predicate");
			if (namespaceOf(definition.predicate) !== vocabulary.namespace)
				throw new Error(
					`Predicate ${definition.predicate} is outside vocabulary ${vocabulary.namespace}`,
				);
			if (this.#predicates.has(definition.predicate))
				throw new Error(
					`Predicate already registered: ${definition.predicate}`,
				);
		}

		this.#vocabularies.set(vocabulary.namespace, vocabulary);
		for (const definition of Object.values(vocabulary.entityTypes))
			this.#entityTypes.set(definition.type, definition);
		for (const definition of Object.values(vocabulary.predicates))
			this.#predicates.set(definition.predicate, definition);
	}

	list(): readonly SemanticVocabulary[] {
		return [...this.#vocabularies.values()].sort((left, right) =>
			left.namespace.localeCompare(right.namespace),
		);
	}

	versions(): Readonly<Record<string, number>> {
		return Object.fromEntries(
			this.list().map((vocabulary) => [
				vocabulary.namespace,
				vocabulary.version,
			]),
		);
	}

	entityType(type: SemanticName): EntityTypeDefinition | undefined {
		return this.#entityTypes.get(type);
	}

	predicate(predicate: SemanticName): PredicateDefinition | undefined {
		return this.#predicates.get(predicate);
	}

	validateNode(node: SemanticNode): ValidationIssue[] {
		const definition = this.#entityTypes.get(node.type);
		if (!definition) return [];
		return [...(definition.validateProperties?.(node.properties) ?? [])];
	}

	validateRelation(
		relation: SemanticRelationAssertion,
		nodes: ReadonlyMap<string, SemanticNode>,
	): ValidationIssue[] {
		const definition = this.#predicates.get(relation.predicate);
		if (!definition) return [];
		const issues: ValidationIssue[] = [];
		const subject = nodes.get(relation.subject);
		if (!subject)
			issues.push({ path: "subject", message: "Subject entity is missing" });
		else if (!definition.subjectTypes.includes(subject.type))
			issues.push({
				path: "subject",
				message: `Predicate ${relation.predicate} does not accept ${subject.type}`,
			});
		if (relation.object.kind === "literal") {
			if (definition.allowLiteral !== true)
				issues.push({
					path: "object",
					message: `Predicate ${relation.predicate} does not accept literals`,
				});
		} else {
			const object = nodes.get(relation.object.id);
			if (!object)
				issues.push({ path: "object", message: "Object entity is missing" });
			else if (
				definition.objectTypes !== undefined &&
				!definition.objectTypes.includes(object.type)
			)
				issues.push({
					path: "object",
					message: `Predicate ${relation.predicate} does not accept ${object.type}`,
				});
		}
		if (relation.qualifiers !== undefined)
			issues.push(
				...(definition.validateQualifiers?.(relation.qualifiers) ?? []),
			);
		return issues;
	}
}
