import { createHash } from "node:crypto";
import {
	GarbroError,
	type InputReference,
	type WorkspacePolicy,
} from "@garbro-mcp/core";
import {
	type AnalyzerGraphPlan,
	type SemanticAnalysisBudgets,
	type SemanticAnalysisContext,
	type SemanticAnalyzerPlan,
	SemanticAnalyzerRegistry,
	type SemanticGoal,
} from "./analyzer.js";
import {
	type SemanticCatalogArtifact,
	writeSemanticCatalog,
} from "./catalog.js";
import { EngineAdapterRegistry, type EngineProbeResult } from "./engine.js";
import { siglusEngineAdapter } from "./engines/siglus.js";
import { canonicalJson } from "./identity.js";
import type {
	JsonValue,
	SemanticCatalogHeader,
	SemanticCatalogSummary,
	SemanticName,
	SemanticRecord,
} from "./model.js";
import { createDefaultVocabularyRegistry } from "./vocabularies.js";
import type { VocabularyRegistry } from "./vocabulary.js";

export interface SemanticAnalysisRequest {
	game: InputReference;
	goal: SemanticGoal;
	strategies: readonly (
		| "user-mapping"
		| "engine-parser"
		| "static-executable"
	)[];
	allowExecutableInspection: boolean;
	budgets: SemanticAnalysisBudgets;
}

export interface SemanticBudgetViolation {
	budget: "maxInputBytes" | "maxFacts";
	actual: string;
	limit: string;
}

export interface SemanticAnalysisPlanResult {
	status: "ready" | "unsupported" | "ambiguous";
	request: SemanticAnalysisRequest;
	engineMatches: readonly EngineProbeResult[];
	selectedEngine?: EngineProbeResult;
	graph?: AnalyzerGraphPlan;
	analyzerPlans: readonly SemanticAnalyzerPlan[];
	inputBytes: bigint | null;
	estimatedFacts: number | null;
	missingPredicates: readonly SemanticName[];
	availablePredicates: readonly SemanticName[];
	budgetViolations: readonly SemanticBudgetViolation[];
	planDigest: string;
	warnings: readonly string[];
}

export interface SemanticAnalysisExecutionResult {
	artifact: SemanticCatalogArtifact;
	summary: SemanticCatalogSummary;
	engine: EngineProbeResult;
	planDigest: string;
}

export interface SemanticServiceOptions {
	engineAdapters?: EngineAdapterRegistry;
	analyzers?: SemanticAnalyzerRegistry;
	vocabularies?: VocabularyRegistry;
	producer?: { name: string; version: string };
}

export function createDefaultEngineAdapterRegistry(): EngineAdapterRegistry {
	const registry = new EngineAdapterRegistry();
	registry.register(siglusEngineAdapter);
	return registry;
}

export function createDefaultSemanticAnalyzerRegistry(): SemanticAnalyzerRegistry {
	return new SemanticAnalyzerRegistry();
}

function digestPayload(
	plan: Omit<SemanticAnalysisPlanResult, "planDigest">,
): JsonValue {
	return {
		status: plan.status,
		request: {
			game: { ...plan.request.game },
			goal: plan.request.goal as unknown as JsonValue,
			strategies: [...plan.request.strategies],
			allowExecutableInspection: plan.request.allowExecutableInspection,
			budgets: {
				...(plan.request.budgets.maxInputBytes === undefined
					? {}
					: { maxInputBytes: plan.request.budgets.maxInputBytes.toString() }),
				...(plan.request.budgets.maxFacts === undefined
					? {}
					: { maxFacts: plan.request.budgets.maxFacts }),
				...(plan.request.budgets.timeoutMs === undefined
					? {}
					: { timeoutMs: plan.request.budgets.timeoutMs }),
			},
		},
		engineMatches: plan.engineMatches.map((match) => ({
			engineId: match.engineId,
			adapterVersion: match.adapterVersion,
			status: match.status,
			confidence: match.confidence,
			profile: match.profile ?? null,
			fingerprint: match.fingerprint?.value ?? null,
			bytesRead: match.bytesRead.toString(),
		})),
		selectedEngine: plan.selectedEngine?.engineId ?? null,
		graph: plan.graph
			? {
					stages: plan.graph.stages.map((stage) =>
						stage.map((analyzer) => `${analyzer.id}@${analyzer.version}`),
					),
					missingPredicates: [...plan.graph.missingPredicates],
				}
			: null,
		analyzerPlans: plan.analyzerPlans.map((item) => ({
			analyzerId: item.analyzerId,
			analyzerVersion: item.analyzerVersion,
			inputBytes: item.inputBytes?.toString() ?? null,
			estimatedFacts: item.estimatedFacts,
			configuration: item.configuration as JsonValue,
		})),
		inputBytes: plan.inputBytes?.toString() ?? null,
		estimatedFacts: plan.estimatedFacts,
		missingPredicates: [...plan.missingPredicates],
		availablePredicates: [...plan.availablePredicates],
		budgetViolations: plan.budgetViolations.map((item) => ({ ...item })),
		warnings: [...plan.warnings],
	};
}

function planDigest(
	plan: Omit<SemanticAnalysisPlanResult, "planDigest">,
): string {
	return createHash("sha256")
		.update(canonicalJson(digestPayload(plan)))
		.digest("hex");
}

function combineSignal(signal: AbortSignal, timeoutMs?: number): AbortSignal {
	return timeoutMs === undefined
		? signal
		: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

export class SemanticAnalysisService {
	readonly engineAdapters: EngineAdapterRegistry;
	readonly analyzers: SemanticAnalyzerRegistry;
	readonly vocabularies: VocabularyRegistry;
	readonly producer: { name: string; version: string };
	readonly #workspace: WorkspacePolicy;

	constructor(
		workspace: WorkspacePolicy,
		options: SemanticServiceOptions = {},
	) {
		this.#workspace = workspace;
		this.engineAdapters =
			options.engineAdapters ?? createDefaultEngineAdapterRegistry();
		this.analyzers =
			options.analyzers ?? createDefaultSemanticAnalyzerRegistry();
		this.vocabularies =
			options.vocabularies ?? createDefaultVocabularyRegistry();
		this.producer = options.producer ?? {
			name: "garbro-mcp",
			version: "development",
		};
	}

	async inspect(
		game: InputReference,
		options: {
			allowExecutableInspection?: boolean;
			maxInputBytes?: bigint;
			signal?: AbortSignal;
		} = {},
	): Promise<EngineProbeResult[]> {
		return this.engineAdapters.probe({
			workspace: this.#workspace,
			game,
			allowExecutableInspection: options.allowExecutableInspection ?? false,
			maxInputBytes: options.maxInputBytes ?? 64n * 1024n * 1024n,
			signal: options.signal ?? new AbortController().signal,
		});
	}

	async plan(
		request: SemanticAnalysisRequest,
		options: {
			availablePredicates?: readonly SemanticName[];
			signal?: AbortSignal;
		} = {},
	): Promise<SemanticAnalysisPlanResult> {
		const signal = combineSignal(
			options.signal ?? new AbortController().signal,
			request.budgets.timeoutMs,
		);
		const engineParsingAllowed = request.strategies.includes("engine-parser");
		const executableInspectionAllowed =
			request.allowExecutableInspection &&
			request.strategies.includes("static-executable");
		const engineMatches = await this.inspect(request.game, {
			allowExecutableInspection: executableInspectionAllowed,
			maxInputBytes: request.budgets.maxInputBytes ?? 64n * 1024n * 1024n,
			signal,
		});
		const matched = engineMatches.filter((match) => match.status === "matched");
		const warnings = engineMatches.flatMap((match) => match.warnings);
		if (
			request.allowExecutableInspection &&
			!request.strategies.includes("static-executable")
		)
			warnings.push(
				"Executable inspection permission was ignored because static-executable is not an allowed strategy.",
			);
		const availablePredicates = [...(options.availablePredicates ?? [])].sort();
		let status: SemanticAnalysisPlanResult["status"] = "unsupported";
		let selectedEngine: EngineProbeResult | undefined;
		let graph: AnalyzerGraphPlan | undefined;
		const analyzerPlans: SemanticAnalyzerPlan[] = [];
		let missingPredicates: readonly SemanticName[] =
			request.goal.predicate === undefined ? [] : [request.goal.predicate];

		if (matched.length > 1) status = "ambiguous";
		else if (matched.length === 1) {
			selectedEngine = matched[0];
			if (!selectedEngine)
				throw new GarbroError("IO_ERROR", "Selected engine disappeared");
			graph = engineParsingAllowed
				? this.analyzers.planGraph(
						selectedEngine.engineId,
						request.goal,
						availablePredicates,
					)
				: {
						engineId: selectedEngine.engineId,
						goal: request.goal,
						stages: [],
						analyzers: [],
						missingPredicates:
							request.goal.predicate === undefined ||
							availablePredicates.includes(request.goal.predicate)
								? []
								: [request.goal.predicate],
					};
			missingPredicates = graph.missingPredicates;
			for (const descriptor of graph.analyzers) {
				const analyzer = this.analyzers.get(descriptor.id);
				if (!analyzer)
					throw new GarbroError(
						"IO_ERROR",
						`Analyzer disappeared: ${descriptor.id}`,
					);
				analyzerPlans.push(
					await analyzer.plan(
						{
							workspace: this.#workspace,
							game: request.game,
							engineId: selectedEngine.engineId,
							...(selectedEngine.profile === undefined
								? {}
								: { profile: selectedEngine.profile }),
							budgets: request.budgets,
							signal,
						},
						request.goal,
					),
				);
			}
			status = missingPredicates.length === 0 ? "ready" : "unsupported";
		}

		const knownInputBytes = analyzerPlans.every(
			(item) => item.inputBytes !== null,
		);
		const inputBytes = knownInputBytes
			? (selectedEngine?.bytesRead ?? 0n) +
				analyzerPlans.reduce(
					(total, item) => total + (item.inputBytes ?? 0n),
					0n,
				)
			: null;
		const knownFacts = analyzerPlans.every(
			(item) => item.estimatedFacts !== null,
		);
		const estimatedFacts = knownFacts
			? analyzerPlans.reduce(
					(total, item) => total + (item.estimatedFacts ?? 0),
					0,
				)
			: null;
		const budgetViolations: SemanticBudgetViolation[] = [];
		if (
			inputBytes !== null &&
			request.budgets.maxInputBytes !== undefined &&
			inputBytes > request.budgets.maxInputBytes
		)
			budgetViolations.push({
				budget: "maxInputBytes",
				actual: inputBytes.toString(),
				limit: request.budgets.maxInputBytes.toString(),
			});
		if (
			estimatedFacts !== null &&
			request.budgets.maxFacts !== undefined &&
			estimatedFacts > request.budgets.maxFacts
		)
			budgetViolations.push({
				budget: "maxFacts",
				actual: estimatedFacts.toString(),
				limit: request.budgets.maxFacts.toString(),
			});
		if (budgetViolations.length > 0) status = "unsupported";
		const partial = {
			status,
			request,
			engineMatches,
			...(selectedEngine === undefined ? {} : { selectedEngine }),
			...(graph === undefined ? {} : { graph }),
			analyzerPlans,
			inputBytes,
			estimatedFacts,
			missingPredicates,
			availablePredicates,
			budgetViolations,
			warnings,
		} satisfies Omit<SemanticAnalysisPlanResult, "planDigest">;
		return { ...partial, planDigest: planDigest(partial) };
	}

	async execute(
		plan: SemanticAnalysisPlanResult,
		expectedPlanDigest: string,
		initialRecords: readonly SemanticRecord[],
		options: { outputRootId?: string; signal?: AbortSignal } = {},
	): Promise<SemanticAnalysisExecutionResult> {
		if (plan.planDigest !== expectedPlanDigest)
			throw new GarbroError(
				"PLAN_CHANGED",
				"Semantic analysis plan digest does not match",
			);
		const freshPlan = await this.plan(plan.request, {
			availablePredicates: plan.availablePredicates,
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		if (freshPlan.planDigest !== expectedPlanDigest)
			throw new GarbroError(
				"PLAN_CHANGED",
				"Semantic analysis inputs or analyzers changed after planning",
			);
		plan = freshPlan;
		if (
			plan.status !== "ready" ||
			!plan.selectedEngine?.fingerprint ||
			!plan.graph
		)
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"Semantic analysis plan is not executable",
				{ details: { missingPredicates: plan.missingPredicates } },
			);
		const signal = combineSignal(
			options.signal ?? new AbortController().signal,
			plan.request.budgets.timeoutMs,
		);
		const records = new Map<string, SemanticRecord>();
		const append = (record: SemanticRecord) => {
			const existing = records.get(record.id);
			if (
				existing &&
				canonicalJson(existing as unknown as JsonValue) !==
					canonicalJson(record as unknown as JsonValue)
			)
				throw new GarbroError(
					"INVALID_ARGUMENT",
					`Conflicting semantic record ID: ${record.id}`,
				);
			records.set(record.id, record);
			if (records.size > (plan.request.budgets.maxFacts ?? 1_000_000))
				throw new GarbroError(
					"LIMIT_EXCEEDED",
					"Semantic fact budget exceeded",
				);
		};
		for (const record of initialRecords) append(record);
		const analyzerPlanById = new Map(
			plan.analyzerPlans.map((item) => [item.analyzerId, item]),
		);
		for (const stage of plan.graph.stages)
			for (const descriptor of stage) {
				const analyzer = this.analyzers.get(descriptor.id);
				const analyzerPlan = analyzerPlanById.get(descriptor.id);
				if (!analyzer || !analyzerPlan)
					throw new GarbroError(
						"PLAN_CHANGED",
						`Analyzer is unavailable: ${descriptor.id}`,
					);
				const context: SemanticAnalysisContext = {
					workspace: this.#workspace,
					game: plan.request.game,
					engineId: plan.selectedEngine.engineId,
					...(plan.selectedEngine.profile === undefined
						? {}
						: { profile: plan.selectedEngine.profile }),
					budgets: plan.request.budgets,
					signal,
					async *readFacts(predicate: SemanticName) {
						for (const record of records.values())
							if (record.kind === "relation" && record.predicate === predicate)
								yield record;
					},
					async reportProgress() {},
				};
				for await (const record of analyzer.analyze(context, analyzerPlan)) {
					if (signal.aborted)
						throw new GarbroError("CANCELLED", "Semantic analysis cancelled");
					append(record);
				}
			}

		const header: SemanticCatalogHeader = {
			kind: "header",
			schemaVersion: 1,
			game: {
				fingerprint: plan.selectedEngine.fingerprint.value,
				rootId: plan.request.game.rootId,
				basePath: plan.request.game.path,
			},
			vocabularies: this.vocabularies.versions(),
			createdBy: this.producer,
		};
		const output = await writeSemanticCatalog(
			this.#workspace,
			header,
			[...records.values()].sort((left, right) =>
				left.id.localeCompare(right.id),
			),
			this.vocabularies,
			{
				...(options.outputRootId === undefined
					? {}
					: { outputRootId: options.outputRootId }),
				...(plan.request.budgets.maxFacts === undefined
					? {}
					: { maxRecords: plan.request.budgets.maxFacts }),
				signal,
			},
		);
		return {
			...output,
			engine: plan.selectedEngine,
			planDigest: plan.planDigest,
		};
	}
}
