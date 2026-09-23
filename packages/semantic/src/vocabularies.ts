import { defineVocabulary } from "./vocabulary.js";
import { VocabularyRegistry } from "./vocabulary.js";

export const garbroVocabulary = defineVocabulary({
	namespace: "garbro",
	version: 1,
	entityTypes: {
		resource: { type: "garbro:resource" },
		alias: { type: "garbro:alias" },
	},
	predicates: {
		aliasOf: {
			predicate: "garbro:aliasOf",
			subjectTypes: ["garbro:alias"],
			objectTypes: ["garbro:resource"],
		},
	},
} as const);

export const visualNovelVocabulary = defineVocabulary({
	namespace: "vn",
	version: 1,
	entityTypes: {
		game: { type: "vn:game" },
		character: { type: "vn:character" },
		dialogue: { type: "vn:dialogue" },
		scene: { type: "vn:scene" },
	},
	predicates: {
		spokenBy: {
			predicate: "vn:spokenBy",
			subjectTypes: ["vn:dialogue"],
			objectTypes: ["vn:character"],
		},
		playsResource: {
			predicate: "vn:playsResource",
			subjectTypes: ["vn:dialogue", "vn:scene"],
			objectTypes: ["garbro:resource"],
		},
		appearsIn: {
			predicate: "vn:appearsIn",
			subjectTypes: ["vn:character"],
			objectTypes: ["vn:scene"],
		},
	},
} as const);

export function createDefaultVocabularyRegistry() {
	const registry = new VocabularyRegistry();
	registry.register(garbroVocabulary);
	registry.register(visualNovelVocabulary);
	return registry;
}
