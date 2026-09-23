import {
	createDefaultVocabularyRegistry,
	defineVocabulary,
	type SemanticNode,
	VocabularyRegistry,
} from "@garbro-mcp/semantic";
import { describe, expect, it } from "vitest";

describe("semantic vocabularies", () => {
	it("adds future appearance concepts without changing the core model", () => {
		const registry = createDefaultVocabularyRegistry();
		registry.register(
			defineVocabulary({
				namespace: "appearance",
				version: 1,
				entityTypes: {
					appearance: { type: "appearance:appearance" },
				},
				predicates: {
					depictedBy: {
						predicate: "appearance:depictedBy",
						subjectTypes: ["vn:character"],
						objectTypes: ["garbro:resource"],
					},
				},
			}),
		);

		const nodes = new Map<string, SemanticNode>([
			[
				"character:kagari",
				{
					kind: "entity",
					id: "character:kagari",
					type: "vn:character",
					properties: { name: "篝" },
				},
			],
			[
				"resource:kagari-smile",
				{
					kind: "resource",
					id: "resource:kagari-smile",
					type: "garbro:resource",
					resourceType: "image",
					locator: { source: { rootId: "games", path: "g00/123.g00" } },
					properties: {},
				},
			],
		]);
		expect(
			registry.validateRelation(
				{
					kind: "relation",
					id: "relation:1",
					subject: "character:kagari",
					predicate: "appearance:depictedBy",
					object: { kind: "entity", id: "resource:kagari-smile" },
					evidenceIds: [],
					status: "verified",
				},
				nodes,
			),
		).toEqual([]);
	});

	it("preserves unknown vocabulary records without treating them as known", () => {
		const registry = new VocabularyRegistry();
		const unknown: SemanticNode = {
			kind: "entity",
			id: "future:1",
			type: "future:concept",
			properties: { arbitrary: [1, true, null] },
		};
		expect(registry.entityType(unknown.type)).toBeUndefined();
		expect(registry.validateNode(unknown)).toEqual([]);
	});

	it("rejects duplicate namespaces and definitions outside their namespace", () => {
		const registry = new VocabularyRegistry();
		registry.register({
			namespace: "sample",
			version: 1,
			entityTypes: { item: { type: "sample:item" } },
			predicates: {},
		});
		expect(() =>
			registry.register({
				namespace: "sample",
				version: 2,
				entityTypes: {},
				predicates: {},
			}),
		).toThrow("Vocabulary already registered");
		expect(() =>
			new VocabularyRegistry().register({
				namespace: "sample",
				version: 1,
				entityTypes: { bad: { type: "other:item" } },
				predicates: {},
			}),
		).toThrow("outside vocabulary");
	});
});
