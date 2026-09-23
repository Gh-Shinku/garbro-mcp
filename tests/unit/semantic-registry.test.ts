import type { WorkspacePolicy } from "@garbro-mcp/core";
import {
	EngineAdapterRegistry,
	type SemanticAnalyzer,
	SemanticAnalyzerRegistry,
	type SemanticName,
} from "@garbro-mcp/semantic";
import { describe, expect, it } from "vitest";

function analyzer(
	id: string,
	produces: SemanticName[],
	requires: SemanticName[] = [],
): SemanticAnalyzer {
	return {
		descriptor: {
			id,
			version: "1",
			engineIds: ["siglus"],
			requires: { predicates: requires },
			produces: {
				entityTypes: [],
				predicates: produces,
				evidenceKinds: [],
			},
		},
		async plan() {
			return {
				analyzerId: id,
				analyzerVersion: "1",
				inputBytes: 0n,
				estimatedFacts: 0,
				configuration: {},
			};
		},
		async *analyze() {},
	};
}

describe("semantic analyzer registry", () => {
	it("builds deterministic stages from declared predicate dependencies", () => {
		const registry = new SemanticAnalyzerRegistry();
		registry.register(
			analyzer("siglus.bind-voice", ["vn:playsResource"], ["siglus:voiceRef"]),
		);
		registry.register(
			analyzer("siglus.voice-ref", ["siglus:voiceRef"], ["vn:spokenBy"]),
		);
		registry.register(analyzer("siglus.dialogue", ["vn:spokenBy"]));

		const plan = registry.planGraph("siglus", {
			predicate: "vn:playsResource",
		});
		expect(plan.missingPredicates).toEqual([]);
		expect(plan.stages.map((stage) => stage.map((item) => item.id))).toEqual([
			["siglus.dialogue"],
			["siglus.voice-ref"],
			["siglus.bind-voice"],
		]);
	});

	it("reports missing facts and rejects dependency cycles", () => {
		const missing = new SemanticAnalyzerRegistry();
		missing.register(
			analyzer("siglus.voice", ["vn:playsResource"], ["siglus:voiceRef"]),
		);
		expect(
			missing.planGraph("siglus", { predicate: "vn:playsResource" })
				.missingPredicates,
		).toEqual(["siglus:voiceRef"]);

		const cyclic = new SemanticAnalyzerRegistry();
		cyclic.register(analyzer("siglus.left", ["siglus:left"], ["siglus:right"]));
		cyclic.register(
			analyzer("siglus.right", ["siglus:right"], ["siglus:left"]),
		);
		expect(() =>
			cyclic.planGraph("siglus", { predicate: "siglus:left" }),
		).toThrow("dependency cycle");
	});

	it("allows several analyzers to corroborate one predicate", () => {
		const registry = new SemanticAnalyzerRegistry();
		registry.register(analyzer("siglus.dialogue", ["vn:spokenBy"]));
		registry.register(analyzer("user.character-map", ["vn:spokenBy"]));
		const plan = registry.planGraph("siglus", { predicate: "vn:spokenBy" });
		expect(plan.analyzers.map((item) => item.id).sort()).toEqual([
			"siglus.dialogue",
			"user.character-map",
		]);
	});
});

describe("engine adapter registry", () => {
	it("orders structural matches before candidates", async () => {
		const registry = new EngineAdapterRegistry();
		for (const [id, status, confidence] of [
			["candidate", "candidate", "medium"],
			["matched", "matched", "high"],
		] as const)
			registry.register({
				descriptor: {
					id,
					version: "1",
					displayName: id,
					supportedProfiles: [],
					analyzerIds: [],
				},
				async probe() {
					return {
						engineId: id,
						adapterVersion: "1",
						status,
						confidence,
						bytesRead: 0n,
						evidence: [],
						requiredInputs: [],
						capabilities: [],
						warnings: [],
					};
				},
			});
		const results = await registry.probe({
			workspace: {} as WorkspacePolicy,
			game: { rootId: "games", path: "." },
			allowExecutableInspection: false,
			maxInputBytes: 1024n,
			signal: new AbortController().signal,
		});
		expect(results.map((item) => item.engineId)).toEqual([
			"matched",
			"candidate",
		]);
	});
});
