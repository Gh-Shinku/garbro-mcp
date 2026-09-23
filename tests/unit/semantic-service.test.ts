import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { WorkspacePolicy } from "@garbro-mcp/core";
import {
	createDefaultEngineAdapterRegistry,
	createDefaultSemanticAnalyzerRegistry,
	EngineAdapterRegistry,
	type SemanticAnalyzer,
	SemanticAnalyzerRegistry,
	SemanticAnalysisService,
} from "@garbro-mcp/semantic";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function serviceFixture(analyzers: SemanticAnalyzer[] = []) {
	const input = await mkdtemp(
		resolve(tmpdir(), "garbro-semantic-service-input-"),
	);
	const output = await mkdtemp(
		resolve(tmpdir(), "garbro-semantic-service-output-"),
	);
	temporaryDirectories.push(input, output);
	await writeFile(resolve(input, "game.bin"), "fixture");
	const workspace = new WorkspacePolicy({
		inputRoots: { games: input },
		outputRoot: output,
	});
	const engines = new EngineAdapterRegistry();
	engines.register({
		descriptor: {
			id: "fixture",
			version: "1",
			displayName: "Fixture",
			supportedProfiles: ["1"],
			analyzerIds: analyzers.map((item) => item.descriptor.id),
		},
		async probe() {
			return {
				engineId: "fixture",
				adapterVersion: "1",
				status: "matched",
				confidence: "high",
				profile: "1",
				fingerprint: { algorithm: "sha256", value: "a".repeat(64), files: [] },
				bytesRead: 0n,
				evidence: [],
				requiredInputs: [],
				capabilities: [],
				warnings: [],
			};
		},
	});
	const registry = new SemanticAnalyzerRegistry();
	for (const analyzer of analyzers) registry.register(analyzer);
	return new SemanticAnalysisService(workspace, {
		engineAdapters: engines,
		analyzers: registry,
	});
}

describe("semantic analysis service", () => {
	it("exposes compile-time default registries for descriptor catalogs", () => {
		expect(
			createDefaultEngineAdapterRegistry()
				.list()
				.map((adapter) => adapter.descriptor.id),
		).toEqual(["siglus"]);
		expect(createDefaultSemanticAnalyzerRegistry().list()).toEqual([]);
	});

	it("plans and executes a deterministic analyzer graph", async () => {
		const analyzer: SemanticAnalyzer = {
			descriptor: {
				id: "fixture.character",
				version: "1",
				engineIds: ["fixture"],
				requires: {},
				produces: {
					entityTypes: ["vn:character"],
					predicates: ["vn:voiceResource"],
					evidenceKinds: [],
				},
			},
			async plan() {
				return {
					analyzerId: "fixture.character",
					analyzerVersion: "1",
					inputBytes: 7n,
					estimatedFacts: 0,
					configuration: {},
				};
			},
			async *analyze() {},
		};
		const service = await serviceFixture([analyzer]);
		const request = {
			game: { rootId: "games", path: "." },
			goal: { predicate: "vn:voiceResource" as const },
			strategies: ["engine-parser" as const],
			allowExecutableInspection: false,
			budgets: { maxInputBytes: 1024n, maxFacts: 10 },
		};
		const plan = await service.plan(request);
		expect(plan).toMatchObject({
			status: "ready",
			inputBytes: 7n,
			missingPredicates: [],
		});
		const executed = await service.execute(plan, plan.planDigest, []);
		expect(executed.summary.records).toBe(0);
	});

	it("reports missing semantic producers instead of guessing", async () => {
		const service = await serviceFixture();
		const plan = await service.plan({
			game: { rootId: "games", path: "." },
			goal: { predicate: "vn:spokenBy" },
			strategies: ["engine-parser"],
			allowExecutableInspection: false,
			budgets: { maxInputBytes: 1024n },
		});
		expect(plan).toMatchObject({
			status: "unsupported",
			missingPredicates: ["vn:spokenBy"],
		});
		await expect(
			service.execute(plan, plan.planDigest, []),
		).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
	});

	it("rejects execution under a different plan digest", async () => {
		const service = await serviceFixture();
		const plan = await service.plan({
			game: { rootId: "games", path: "." },
			goal: {},
			strategies: ["user-mapping"],
			allowExecutableInspection: false,
			budgets: { maxInputBytes: 1024n },
		});
		await expect(
			service.execute(plan, "0".repeat(64), []),
		).rejects.toMatchObject({ code: "PLAN_CHANGED" });
	});
});
